import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "../src/prompts";
import { buildJudgePrompt } from "../src/prompts";
import {
  buildDebatePrompt,
  buildPromptContext,
  limitAgentHistory,
} from "../src/prompt";
import { createDebateState } from "../src/state";
import { DebatePhase, type DebateConfig, type DebateTurn } from "../src/types";

function turn(side: "A" | "B", content: string): DebateTurn {
  return {
    id: `${side}-${content}`,
    agentId: side,
    side,
    phase: DebatePhase.OPENING_A,
    content,
    model: "m",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const TURNS = [turn("A", "AAA"), turn("B", "BBBB"), turn("A", "CC")];
// Rendered history lines: "A: AAA" (6), "B: BBBB" (7), "A: CC" (5).

function configWith(overrides: Partial<DebateConfig>): DebateConfig {
  return {
    topic: "Topic",
    agents: { A: { id: "A", name: "Agent A" }, B: { id: "B", name: "Agent B" } },
    ...overrides,
  };
}

describe("agent context limits (F9-15)", () => {
  it("drops the oldest whole turns first when over the char cap", () => {
    const kept = limitAgentHistory(TURNS, { historyTurns: 10, maxContextCharsPerSide: 12 });
    expect(kept.map((entry) => entry.content)).toEqual(["BBBB", "CC"]);
  });

  it("keeps dropping until the remainder fits", () => {
    const kept = limitAgentHistory(TURNS, { historyTurns: 10, maxContextCharsPerSide: 11 });
    expect(kept.map((entry) => entry.content)).toEqual(["CC"]);
  });

  it("applies the turn-count window before the char cap", () => {
    const kept = limitAgentHistory(TURNS, { historyTurns: 1, maxContextCharsPerSide: 10_000 });
    expect(kept.map((entry) => entry.content)).toEqual(["CC"]);
  });

  it("keeps everything when inside both caps, and handles empty history", () => {
    expect(limitAgentHistory(TURNS, { historyTurns: 6, maxContextCharsPerSide: 12_000 })).toHaveLength(3);
    expect(limitAgentHistory([], { historyTurns: 2, maxContextCharsPerSide: 10 })).toEqual([]);
    expect(
      buildDebatePrompt({ topic: "T", phase: DebatePhase.OPENING_A, agent: { id: "A", name: "A" }, history: [] }),
    ).toContain("(no previous turns)");
  });

  it("trims agent history in buildPromptContext but leaves legacy configs untouched", () => {
    const state = { ...createDebateState(), turns: TURNS };
    const trimmed = buildPromptContext(
      configWith({ maxHistoryTurns: 10, maxContextCharsPerSide: 12 }),
      state,
      "A",
    );
    expect(trimmed.history.map((entry) => entry.content)).toEqual(["BBBB", "CC"]);

    const legacy = buildPromptContext(configWith({ maxHistoryTurns: 10 }), state, "A");
    expect(legacy.history).toHaveLength(3);
  });

  it("always keeps the topic and own position in the agent system prompt", () => {
    const system = buildAgentSystemPrompt("B", "AGAINST", "My Topic");
    expect(system).toContain("My Topic");
    expect(system).toContain("AGAINST");
    expect(system).toContain("debater B");
  });

  it("gives the judge the full transcript regardless of agent caps", () => {
    const long = TURNS.map((entry, index) => ({ ...entry, content: `${entry.content}-long-${index}-`.repeat(50) }));
    const prompt = buildJudgePrompt("Topic", long);
    for (const entry of long) {
      expect(prompt).toContain(entry.content);
    }
  });
});

