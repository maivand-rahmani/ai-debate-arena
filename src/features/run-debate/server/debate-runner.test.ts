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

  it("retries once when the judge returns degenerate zero DRAW, then emits the corrected verdict", async () => {
    const degenerate = JSON.stringify({
      winner: "DRAW",
      scoreA: 0,
      scoreB: 0,
      reasoning: "placeholder zeros",
    });
    const judgeCalls: string[] = [];
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
          if (args.kind === "judge") {
            judgeCalls.push(args.prompt);
            return { text: judgeCalls.length === 1 ? degenerate : verdictJson, chunks: [] };
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(judgeCalls).toHaveLength(2);
    expect(judgeCalls[1]).toMatch(/previous output was invalid/i);
    const types = events.map((event) => event.type);
    expect(types).toContain("judge-start");
    expect(types).toContain("verdict");
    expect(types[types.length - 1]).toBe("done");
    const verdictEvent = events.find((event) => event.type === "verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
      expect(verdictEvent.verdict.scoreA).toBe(82);
    } else {
      expect.unreachable("expected a verdict event");
    }
  });

  it("repairs a winner that conflicts with the scores without retrying", async () => {
    const conflicted = JSON.stringify({
      winner: "B",
      scoreA: 82,
      scoreB: 74,
      reasoning: "scores favor A",
    });
    let judgeCalls = 0;
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
          if (args.kind === "judge") {
            judgeCalls += 1;
            return { text: conflicted, chunks: [] };
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(judgeCalls).toBe(1);
    const verdictEvent = events.find((event) => event.type === "verdict");
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
    }
  });

  it("emits error when the retry is still degenerate", async () => {
    const degenerate = JSON.stringify({
      winner: "DRAW",
      scoreA: 0,
      scoreB: 0,
      reasoning: "placeholder zeros",
    });
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
          if (args.kind === "judge") return { text: degenerate, chunks: [] };
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(events[events.length - 2].type).toBe("error");
    expect(events[events.length - 1].type).toBe("done");
    expect(events.some((event) => event.type === "verdict")).toBe(false);
  });

  it("accepts markdown-fenced judge JSON without retrying (plain-fallback shape)", async () => {
    const fenced = `\`\`\`json\n${verdictJson}\n\`\`\``;
    let judgeCalls = 0;
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
          if (args.kind === "judge") {
            judgeCalls += 1;
            return { text: fenced, chunks: [] };
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(judgeCalls).toBe(1);
    const verdictEvent = events.find((event) => event.type === "verdict");
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
      expect(verdictEvent.verdict.scoreA).toBe(82);
      expect(verdictEvent.verdict.scoreB).toBe(74);
    }
  });

  it("accepts prose-wrapped judge JSON without retrying", async () => {
    const wrapped = `Here is my verdict:\n${verdictJson}\nThat concludes the judging.`;
    let judgeCalls = 0;
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
          if (args.kind === "judge") {
            judgeCalls += 1;
            return { text: wrapped, chunks: [] };
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(judgeCalls).toBe(1);
    const verdictEvent = events.find((event) => event.type === "verdict");
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
    }
  });
});
