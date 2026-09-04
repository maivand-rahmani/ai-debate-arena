import { describe, expect, it } from "vitest";
import { DebatePhase } from "../../../entities/debate/types";
import { runDebate, type DebateStreamEvent } from "./debate-runner";

const verdictJson = JSON.stringify({
  winner: "A",
  scoreA: 82,
  scoreB: 74,
  criteria: {
    argumentQualityA: 85,
    argumentQualityB: 75,
    rebuttalA: 80,
    rebuttalB: 72,
    consistencyA: 83,
    consistencyB: 74,
    relevanceA: 84,
    relevanceB: 73,
  },
  reasoning: "A had stronger arguments",
});

describe("runDebate", () => {
  it("emits phase, tokens, turns x4, then judge-start, verdict, done", async () => {
    const calls: string[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        callModel: async (args) => {
          calls.push(args.kind);
          if (args.kind === "judge") return { text: verdictJson, chunks: [] };
          return { text: `text-${args.system.slice(0, 0)}${calls.length}`, chunks: ["c1", "c2"] };
        },
      },
    )) {
      events.push(event);
    }

    const types = events.map((event) => event.type);
    expect(types).toEqual([
      "phase",
      "token",
      "token",
      "turn",
      "phase",
      "token",
      "token",
      "turn",
      "phase",
      "token",
      "token",
      "turn",
      "phase",
      "token",
      "token",
      "turn",
      "judge-start",
      "verdict",
      "done",
    ]);

    const phases = events.filter((event) => event.type === "phase");
    expect(phases.map((event) => (event.type === "phase" ? event.phase : null))).toEqual([
      DebatePhase.OPENING_A,
      DebatePhase.OPENING_B,
      DebatePhase.REBUTTAL_A,
      DebatePhase.REBUTTAL_B,
    ]);

    const verdictEvent = events.find((event) => event.type === "verdict");
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
      expect(verdictEvent.verdict.criteria.argumentQualityA).toBe(85);
    }
  });

  it("emits error then done when the model fails", async () => {
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Topic",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        callModel: async () => {
          throw new Error("boom");
        },
      },
    )) {
      events.push(event);
    }
    expect(events[0].type).toBe("phase");
    expect(events[events.length - 2].type).toBe("error");
    expect(events[events.length - 1].type).toBe("done");
  });
});
