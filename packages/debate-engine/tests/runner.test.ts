import { describe, expect, it } from "vitest";
import { DebatePhase, MATCH_PROFILES, type MatchRecord } from "@arena/debate-engine";
import { runDebate, type DebateStreamEvent, type ModelCallArgs } from "../src/runner";
import type {
  StandardAgentMoveInput,
  StandardAgentMoveResult,
  StandardAgentSessionFactory,
} from "../src/standard-agent";

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

// Unit tests inject persistence; the default writer (match-store on disk) must
// never run here.
const noopSave = async (): Promise<void> => {};

type MovePlan = (
  side: "A" | "B",
  sideMoveIndex: number,
  input: StandardAgentMoveInput,
) => StandardAgentMoveResult | Promise<StandardAgentMoveResult>;

const judgeCall = async (args: ModelCallArgs) =>
  args.kind === "judge"
    ? { text: verdictJson, chunks: [] as string[] }
    : { text: "agent text", chunks: [] as string[] };

function fakeSessions(plan: MovePlan) {
  const counts: Record<"A" | "B", number> = { A: 0, B: 0 };
  const moveInputs: StandardAgentMoveInput[] = [];
  const factory: StandardAgentSessionFactory = (input) => ({
    async move(moveInput) {
      const index = counts[input.side];
      counts[input.side] += 1;
      moveInputs.push(moveInput);
      return plan(input.side, index, moveInput);
    },
  });
  return { factory, moveInputs };
}

describe("runDebate", () => {
  it("emits six format-owned Quick turns, then judge-start, verdict, and done", async () => {
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
        saveMatch: noopSave,
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
      ...Array.from({ length: 6 }, () => ["phase", "token", "token", "turn"]).flat(),
      "judge-start", "verdict", "done",
    ]);

    const phases = events.filter((event) => event.type === "phase");
    expect(phases.map((event) => (event.type === "phase" ? event.phase : null))).toEqual([
      "quick-a-opening",
      "quick-b-opening",
      "quick-a-response-1",
      "quick-b-response-1",
      "quick-a-response-2",
      "quick-b-response-2",
    ]);

    const verdictEvent = events.find((event) => event.type === "verdict");
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
      expect(verdictEvent.verdict.criteria.argumentQualityA).toBe(85);
    }
  });

  it("keeps open Standard rounds going while neither side is ready and stops at the move ceiling", async () => {
    const events: DebateStreamEvent[] = [];
    const { factory } = fakeSessions((side, index) => ({ speech: `${side}${index}`, ready: false, toolEvents: [] }));
    for await (const event of runDebate(standardInput(), {
      saveMatch: noopSave,
      callModel: judgeCall,
      runTool: async () => ({ ok: true, output: "unused" }),
      createStandardAgentSession: factory,
    })) events.push(event);

    const phases = events.flatMap((event) => (event.type === "phase" ? [event.phase] : []));
    expect(events.filter((event) => event.type === "turn")).toHaveLength(12);
    expect(phases).toEqual([
      "standard-a-opening", "standard-b-opening",
      "standard-a-round-1", "standard-b-round-1",
      "standard-a-round-2", "standard-b-round-2",
      "standard-a-round-3", "standard-b-round-3",
      "standard-a-round-4", "standard-b-round-4",
      "standard-a-round-5", "standard-b-round-5",
    ]);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("forces a depleted side to close after the opponent's final move", async () => {
    const events: DebateStreamEvent[] = [];
    const { factory } = fakeSessions((side, index, input): StandardAgentMoveResult => {
      if (side === "A") {
        const tools = Array.from({ length: input.maxAffordableTools }, (_, i) => ({
          tool: "web_search" as const,
          query: `a-${index}-${i}`,
          output: `result ${index}-${i}`,
          ok: true,
        }));
        return { speech: `A${index}`, ready: false, toolEvents: tools };
      }
      return { speech: `B${index}`, ready: false, toolEvents: [] };
    });
    for await (const event of runDebate(standardInput(), {
      saveMatch: noopSave,
      callModel: judgeCall,
      runTool: async () => ({ ok: true, output: "result" }),
      createStandardAgentSession: factory,
    })) {
      events.push(event);
    }

    const turnEvents = events.flatMap((event) => (event.type === "turn" ? [event.turn] : []));
    const toolStarts = events.flatMap((event) => (event.type === "tool-start" ? [event.tool.side] : []));
    const phases = events.flatMap((event) => (event.type === "phase" ? [event.phase] : []));

    // A burns two tools per move and runs out of credits well before the
    // emergency ceiling; B still receives its final move in the closing round.
    expect(turnEvents.length).toBeLessThan(12);
    expect(turnEvents.filter((turn) => turn.side === "A").length).toBeLessThan(
      turnEvents.filter((turn) => turn.side === "B").length,
    );
    expect(turnEvents.at(-1)?.side).toBe("B");
    expect(toolStarts).toEqual(["A", "A", "A", "A"]);
    expect(phases).not.toContain("standard-a-round-4");
    expect(events.at(-1)?.type).toBe("done");
  });


  it("keeps Quick as a fixed six-turn format with no ready or credit handling", async () => {
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(quickInput(), {
      saveMatch: noopSave,
      callModel: async (args) => {
        if (args.kind === "judge") return { text: verdictJson, chunks: [] };
        // A Standard-style action payload is treated as plain Quick speech.
        return { text: JSON.stringify({ action: "speak", content: "hello", ready: true }), chunks: ["a", "b"] };
      },
    })) events.push(event);

    const phases = events.flatMap((event) => (event.type === "phase" ? [event.phase] : []));
    expect(phases).toEqual([
      "quick-a-opening",
      "quick-b-opening",
      "quick-a-response-1",
      "quick-b-response-1",
      "quick-a-response-2",
      "quick-b-response-2",
    ]);
    expect(events.filter((event) => event.type === "turn")).toHaveLength(6);
    expect(events.some((event) => event.type === "tool-start" || event.type === "tool-result")).toBe(false);
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
        saveMatch: noopSave,
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
        saveMatch: noopSave,
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
        saveMatch: noopSave,
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
        saveMatch: noopSave,
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
        saveMatch: noopSave,
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
        saveMatch: noopSave,
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

  it("passes the run abortSignal through to every model call", async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        abortSignal: controller.signal,
        saveMatch: noopSave,
        callModel: async (args: ModelCallArgs) => {
          seen.push(args.abortSignal);
          if (args.kind === "judge") return { text: verdictJson, chunks: [] };
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(seen.length).toBeGreaterThan(0);
    for (const signal of seen) {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal).toBe(controller.signal);
    }
    expect(events[events.length - 1].type).toBe("done");
  });

  it("aborting mid-run yields exactly one error and one done", async () => {
    const controller = new AbortController();
    let agentCalls = 0;
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        abortSignal: controller.signal,
        saveMatch: noopSave,
        callModel: async (args: ModelCallArgs) => {
          if (args.kind === "judge") return { text: verdictJson, chunks: [] };
          agentCalls += 1;
          if (agentCalls === 2) {
            controller.abort();
          }
          if (args.abortSignal?.aborted) {
            throw new DOMException("This operation was aborted", "AbortError");
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === "error")).toHaveLength(1);
    expect(types.filter((type) => type === "done")).toHaveLength(1);
    expect(types[types.length - 2]).toBe("error");
    expect(types[types.length - 1]).toBe("done");
    expect(types).toContain("turn");
    expect(types).not.toContain("verdict");
  });
});

function quickInput() {
  return {
    topic: "Should AI be regulated?",
    mode: "quick" as const,
    agentA: { providerId: "p1", model: "m1", position: "FOR" as const },
    agentB: { providerId: "p2", model: "m2", position: "AGAINST" as const },
  };
}

function standardInput() {
  return {
    topic: "Should cities restrict short-term rentals?",
    mode: "standard" as const,
    agentA: { providerId: "p1", model: "m1", position: "FOR" as const },
    agentB: { providerId: "p2", model: "m2", position: "AGAINST" as const },
  };
}

async function agentSuccess(args: ModelCallArgs) {
  if (args.kind === "judge") return { text: verdictJson, chunks: [] as string[] };
  return { text: "agent text", chunks: [] as string[] };
}

describe("runDebate stream contract v1 + persistence", () => {
  it("envelopes every event with v/matchId/seq in order", async () => {
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: agentSuccess,
      matchId: "match-123",
      saveMatch: noopSave,
    })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.v).toBe(1);
      expect(event.matchId).toBe("match-123");
    }
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
  });

  it("generates a matchId when none is provided", async () => {
    const seen = new Set<string>();
    for (let run = 0; run < 2; run += 1) {
      const events: DebateStreamEvent[] = [];
      for await (const event of runDebate(quickInput(), { callModel: agentSuccess, saveMatch: noopSave })) {
        events.push(event);
      }
      for (const event of events) seen.add(event.matchId);
    }
    expect(seen.size).toBe(2);
  });

  it("calls saveMatch once on success with a complete, secret-free record", async () => {
    const saved: MatchRecord[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: agentSuccess,
      matchId: "match-ok",
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      events.push(event);
    }

    expect(saved).toHaveLength(1);
    const record = saved[0]!;
    expect(record.version).toBe(1);
    expect(record.matchId).toBe("match-ok");
    expect(record.mode).toBe("quick");
    expect(record.terminal).toBe("completed");
    expect(record.terminalReason).toBeNull();
    expect(record.transcript).toHaveLength(6);
    expect(record.verdict?.winner).toBe("A");
    expect(record.metrics.turnsMs).toHaveLength(6);
    expect(record.metrics.totalMs).toBeGreaterThanOrEqual(0);
    expect(record.policy).toMatchObject({ mode: "quick", agentMaxOutputTokens: 3000 });
    expect(record.promptVersions).toEqual({ agent: "2", judge: "2" });
    expect(record.rubricVersion).toBe("2");
    expect(JSON.stringify(record)).not.toMatch(/apiKey|baseUrl|sk-/i);

    const done = events[events.length - 1];
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.terminal).toBe("completed");
  });

  it("calls saveMatch once on error with a partial record and error terminal", async () => {
    const saved: MatchRecord[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: async () => {
        throw new Error("boom");
      },
      matchId: "match-err",
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      events.push(event);
    }

    expect(saved).toHaveLength(1);
    const record = saved[0]!;
    expect(record.matchId).toBe("match-err");
    expect(record.terminal).toBe("error");
    const errorEvent = events.find((event) => event.type === "error");
    expect(errorEvent?.type).toBe("error");
    if (errorEvent?.type === "error") expect(record.terminalReason).toBe(errorEvent.message);
    expect(record.verdict).toBeNull();
    expect(record.transcript).toHaveLength(0);
    expect(JSON.stringify(record)).not.toMatch(/apiKey|baseUrl|sk-/i);

    const done = events[events.length - 1];
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.terminal).toBe("error");
  });

  it("records cancelled when the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const saved: MatchRecord[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(quickInput(), {
      abortSignal: controller.signal,
      callModel: async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      },
      matchId: "match-cancel",
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      events.push(event);
    }

    expect(saved).toHaveLength(1);
    expect(saved[0]!.terminal).toBe("cancelled");
    expect(JSON.stringify(saved[0])).not.toMatch(/apiKey|baseUrl|sk-/i);
    const done = events[events.length - 1];
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.terminal).toBe("cancelled");
  });

  it("persists a cancelled record when the consumer abandons the stream early", async () => {
    const saved: MatchRecord[] = [];
    const generator = runDebate(quickInput(), {
      callModel: agentSuccess,
      matchId: "match-early",
      saveMatch: async (record) => {
        saved.push(record);
      },
    });
    await generator.next();
    await generator.return(undefined);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.terminal).toBe("cancelled");
    expect(saved[0]!.transcript).toHaveLength(0);
  });

  it("takes per-turn call limits from the injected profile", async () => {
    const limits: number[] = [];
    const judgeLimits: number[] = [];
    const profile = { ...MATCH_PROFILES.quick, agentMaxOutputTokens: 123, judgeMaxOutputTokens: 456 };
    const saved: MatchRecord[] = [];
    for await (const event of runDebate(quickInput(), {
      profile,
      callModel: async (args) => {
        if (args.kind === "judge") {
          judgeLimits.push(args.maxOutputTokens);
          return { text: verdictJson, chunks: [] };
        }
        limits.push(args.maxOutputTokens);
        return { text: "agent text", chunks: [] };
      },
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      expect(event.seq).toBeGreaterThan(0);
    }

    expect(limits).toEqual([123, 123, 123, 123, 123, 123]);
    expect(judgeLimits).toEqual([456]);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.policy.agentMaxOutputTokens).toBe(123);
  });
});

describe("runDebate token metrics (F7-13)", () => {
  it("sums per-call usage into metrics.usage", async () => {
    const saved: MatchRecord[] = [];
    const types: string[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: async (args) => {
        if (args.kind === "judge") {
          return { text: verdictJson, chunks: [], usage: { promptTokens: 5, completionTokens: 7 } };
        }
        return { text: "agent text", chunks: [], usage: { promptTokens: 10, completionTokens: 20 } };
      },
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      types.push(event.type);
    }

    expect(types[types.length - 1]).toBe("done");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.metrics.usage).toEqual({ promptTokens: 65, completionTokens: 127 });
  });

  it("records zeros when the provider reports no usage", async () => {
    const saved: MatchRecord[] = [];
    const types: string[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: agentSuccess,
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      types.push(event.type);
    }

    expect(types[types.length - 1]).toBe("done");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.metrics.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("sums judge usage across retry attempts in runJudge", async () => {
    const { runJudge } = await import("../src/runner");
    let calls = 0;
    const result = await runJudge(
      {
        topic: "Topic",
        turns: [],
        providerId: "p",
        model: "m",
      },
      {
        callModel: async () => {
          calls += 1;
          if (calls === 1) return { text: "garbage", chunks: [], usage: { promptTokens: 3, completionTokens: 4 } };
          return { text: verdictJson, chunks: [], usage: { promptTokens: 5, completionTokens: 6 } };
        },
      },
    );
    expect(calls).toBe(2);
    expect(result.verdict.winner).toBe("A");
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 10 });
  });

  it("treats malformed usage as zeros without throwing", async () => {
    const { runJudge, toModelUsage } = await import("../src/runner");
    expect(toModelUsage(undefined)).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(toModelUsage({ inputTokens: -5, outputTokens: Number.NaN })).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(toModelUsage({ inputTokens: { total: 9 }, outputTokens: 2 })).toEqual({ promptTokens: 9, completionTokens: 2 });
    const result = await runJudge(
      { topic: "Topic", turns: [], providerId: "p", model: "m" },
      { callModel: async () => ({ text: verdictJson, chunks: [] }) },
    );
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});

describe("runDebate Standard budget configuration", () => {
  it("threads custom starting credits and per-move tool cap into the session", async () => {
    const { factory, moveInputs } = fakeSessions((side, index, input): StandardAgentMoveResult => {
      if (side === "A") {
        const tools = Array.from({ length: input.maxAffordableTools }, (_, i) => ({
          tool: "web_search" as const,
          query: `source-${index}-${i}`,
          output: "result",
          ok: true,
        }));
        return { speech: `A${index}`, ready: index >= 1, toolEvents: tools };
      }
      return { speech: `B${index}`, ready: true, toolEvents: [] };
    });

    for await (const event of runDebate(
      { ...standardInput(), standardLimits: { startingCredits: 64, maxToolsPerMove: 4 } },
      {
        saveMatch: noopSave,
        callModel: judgeCall,
        runTool: async () => ({ ok: true, output: "result" }),
        createStandardAgentSession: factory,
      },
    )) {
      void event;
    }

    const aMoves = moveInputs.filter((input) => input.side === "A");
    // Opening: four tools (2 credits each) + speech (1) = 9 charged.
    expect(aMoves[0]?.credits).toBe(64);
    expect(aMoves[0]?.maxToolsPerMove).toBe(4);
    expect(aMoves[0]?.maxAffordableTools).toBe(4);
    expect(aMoves[1]?.credits).toBe(55);
  });

  it("honors maxToolsPerMove 0 by forcing an immediate speech and running no tools", async () => {
    const events: DebateStreamEvent[] = [];
    const { factory, moveInputs } = fakeSessions((side, index) => ({ speech: `${side}${index}`, ready: true, toolEvents: [] }));
    for await (const event of runDebate(
      { ...standardInput(), standardLimits: { maxToolsPerMove: 0 } },
      {
        saveMatch: noopSave,
        callModel: judgeCall,
        runTool: async () => {
          throw new Error("tools must not run when maxToolsPerMove is 0");
        },
        createStandardAgentSession: factory,
      },
    )) {
      events.push(event);
    }

    expect(moveInputs.every((input) => input.maxToolsPerMove === 0)).toBe(true);
    expect(moveInputs.every((input) => input.maxAffordableTools === 0)).toBe(true);
    expect(events.some((event) => event.type === "tool-start" || event.type === "tool-result")).toBe(false);
  });

  it("forwards the configured tool timeout to the session and its executor", async () => {
    const timeouts: Array<number | undefined> = [];
    const { factory, moveInputs } = fakeSessions(async (side, index, input): Promise<StandardAgentMoveResult> => {
      if (side === "A" && index === 0) {
        const result = await input.runTool("web_search", { query: "source", timeoutMs: input.toolTimeoutMs }, input.abortSignal);
        timeouts.push(input.toolTimeoutMs);
        return {
          speech: "A0",
          ready: false,
          toolEvents: [{ tool: "web_search", query: "source", output: result.output, ok: result.ok }],
        };
      }
      return { speech: `${side}${index}`, ready: true, toolEvents: [] };
    });

    for await (const event of runDebate(
      { ...standardInput(), standardLimits: { toolTimeoutSeconds: 5 } },
      {
        saveMatch: noopSave,
        callModel: judgeCall,
        runTool: async (_tool, toolInput) => {
          timeouts.push(toolInput.timeoutMs);
          return { ok: true, output: "result" };
        },
        createStandardAgentSession: factory,
      },
    )) {
      void event;
    }

    expect(moveInputs.every((input) => input.toolTimeoutMs === 5_000)).toBe(true);
    expect(timeouts).toEqual([5_000, 5_000]);
  });

  it("rejects out-of-bounds Standard limits before running the match", async () => {
    const generator = runDebate(
      { ...standardInput(), standardLimits: { startingCredits: 0 } },
      { saveMatch: noopSave, callModel: agentSuccess, runTool: async () => ({ ok: true, output: "unused" }) },
    );
    await expect(generator.next()).rejects.toThrow(/startingCredits/);
  });

  it("ignores Standard limits in Quick and keeps the fixed six-turn format", async () => {
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      { ...quickInput(), standardLimits: { startingCredits: 1, maxToolsPerMove: 0, toolTimeoutSeconds: 1 } },
      {
        saveMatch: noopSave,
        callModel: async (args) => {
          if (args.kind === "judge") return { text: verdictJson, chunks: [] };
          return { text: JSON.stringify({ action: "speak", content: "quick", ready: true }), chunks: ["a"] };
        },
      },
    )) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "turn")).toHaveLength(6);
    expect(events.some((event) => event.type === "tool-start" || event.type === "tool-result")).toBe(false);
    expect(events.at(-1)?.type).toBe("done");
  });
});
