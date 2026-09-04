import { describe, expect, it } from "vitest";
import { DebatePhase, type DebateTurn } from "./types";
import { appendTurn, attachVerdict, createDebateState } from "./state";

describe("state helpers", () => {
  it("appends turns immutably", () => {
    const state = createDebateState();
    const turn: DebateTurn = {
      id: "t1",
      agentId: "A",
      side: "A" as const,
      phase: DebatePhase.OPENING_A as DebateTurn["phase"],
      content: "Opening case",
      model: "test-model",
      createdAt: new Date().toISOString(),
    };
    const next = appendTurn(state, turn);
    expect(next.turns).toHaveLength(1);
    expect(next.turns[0]).toEqual(turn);
    expect(state.turns).toHaveLength(0);
  });

  it("attaches a verdict and finishes the debate", () => {
    const state = createDebateState();
    const verdict = {
      winner: "A" as const,
      scoreA: 80,
      scoreB: 70,
      criteria: {
        argumentQualityA: 80,
        argumentQualityB: 70,
        rebuttalA: 80,
        rebuttalB: 70,
        consistencyA: 80,
        consistencyB: 70,
        relevanceA: 80,
        relevanceB: 70,
      },
      reasoning: "A won",
    };
    const next = attachVerdict(state, verdict);
    expect(next.phase).toBe(DebatePhase.FINISHED);
    expect(next.verdict).toEqual(verdict);
    expect(state.verdict).toBeUndefined();
  });
});
