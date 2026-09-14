import { describe, expect, it } from "vitest";
import { MATCH_PROFILES } from "@arena/debate-engine";
import type { DebateSide } from "@arena/types";
import {
  runDebate,
  type DebateStreamEvent,
  type ModelCallArgs,
} from "../src/runner";
import type {
  StandardAgentMoveInput,
  StandardAgentMoveResult,
  StandardAgentSessionFactory,
  StandardAgentSessionFactoryInput,
  StandardAgentToolEvent,
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

const noopSave = async (): Promise<void> => {};

const judgeCall = async (args: ModelCallArgs) =>
  args.kind === "judge" ? { text: verdictJson, chunks: [] as string[] } : { text: "quick speech", chunks: [] as string[] };

function standardInput(standardLimits?: Record<string, number>) {
  return {
    topic: "Should cities restrict short-term rentals?",
    mode: "standard" as const,
    agentA: { providerId: "p1", model: "m1", position: "FOR" as const },
    agentB: { providerId: "p2", model: "m2", position: "AGAINST" as const },
    ...(standardLimits ? { standardLimits } : {}),
  };
}

type MovePlan = (
  side: DebateSide,
  sideMoveIndex: number,
  input: StandardAgentMoveInput,
) => StandardAgentMoveResult | Promise<StandardAgentMoveResult>;

function toolEvent(query: string, overrides: Partial<StandardAgentToolEvent> = {}): StandardAgentToolEvent {
  return { tool: "web_search", query, output: `output:${query}`, ok: true, ...overrides };
}

function speak(speech: string, ready = false): StandardAgentMoveResult {
  return { speech, ready, toolEvents: [] };
}

/** Records every factory/move call and lets each test define the move behavior. */
function fakeSessions(plan: MovePlan) {
  const factoryInputs: StandardAgentSessionFactoryInput[] = [];
  const moveInputs: StandardAgentMoveInput[] = [];
  const sideMoveCounts: Record<DebateSide, number> = { A: 0, B: 0 };
  const factory: StandardAgentSessionFactory = (input) => {
    factoryInputs.push(input);
    return {
      async move(moveInput) {
        const index = sideMoveCounts[input.side];
        sideMoveCounts[input.side] += 1;
        moveInputs.push(moveInput);
        return plan(input.side, index, moveInput);
      },
    };
  };
  return { factory, factoryInputs, moveInputs };
}

async function drain(events: AsyncIterable<DebateStreamEvent>): Promise<DebateStreamEvent[]> {
  const collected: DebateStreamEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

const typesOf = (events: readonly DebateStreamEvent[]): string[] => events.map((event) => event.type);

describe("Standard runner → agent session port", () => {
  it("yields callback progress before a deferred move resolves with stable public ids", async () => {
    let releaseMove!: () => void;
    const deferredMove = new Promise<void>((resolve) => {
      releaseMove = resolve;
    });
    const { factory } = fakeSessions(async (side, index, input) => {
      if (side === "A" && index === 0) {
        input.onProgress?.({ type: "tool-start", invocationId: "native-1", tool: "web_search", query: "live query" });
        input.onProgress?.({
          type: "tool-result",
          invocationId: "native-1",
          tool: "web_search",
          query: "live query",
          output: "live result",
          ok: true,
        });
        await deferredMove;
        return { speech: "A live move", ready: true, toolEvents: [{ tool: "web_search", query: "live query", output: "live result", ok: true }] };
      }
      return speak(`${side}${index}`, true);
    });

    const stream = runDebate(standardInput(), {
      callModel: judgeCall,
      runTool: async () => ({ ok: true, output: "unused" }),
      createStandardAgentSession: factory,
      saveMatch: noopSave,
    });
    expect((await stream.next()).value?.type).toBe("phase");
    const start = await stream.next();
    expect(start.value?.type).toBe("tool-start");
    const result = await stream.next();
    expect(result.value?.type).toBe("tool-result");
    if (start.value?.type === "tool-start" && result.value?.type === "tool-result") {
      expect(result.value.result.callId).toBe(start.value.tool.callId);
      expect(result.value.result.createdAt).toBe(start.value.tool.createdAt);
    }

    // The session is still blocked, but progress already crossed the runner.
    releaseMove();
    const events = await drain(stream);
    const all = [start.value, result.value, ...events].filter(Boolean) as DebateStreamEvent[];
    expect(all.map((event) => event.seq)).toEqual(all.map((_, index) => index + 2));
    expect(all.filter((event) => event.type === "tool-result")).toHaveLength(1);
  });

  it("delegates the tool loop and emits tool events before the move in order", async () => {
    const saved: import("@arena/debate-engine").MatchRecord[] = [];
    const { factory, moveInputs } = fakeSessions((side, index) => {
      if (side === "A" && index === 0) {
        return {
          speech: "A opening with evidence.",
          ready: true,
          toolEvents: [toolEvent("a-source")],
          usage: { promptTokens: 3, completionTokens: 4 },
        };
      }
      return speak(`${side} move ${index}`, true);
    });

    const events = await drain(
      runDebate(standardInput(), {
        callModel: judgeCall,
        runTool: async () => ({ ok: true, output: "unused" }),
        createStandardAgentSession: factory,
        saveMatch: async (record) => {
          saved.push(record);
        },
      }),
    );

    const types = typesOf(events);
    const start = types.indexOf("tool-start");
    const result = types.indexOf("tool-result");
    const token = types.indexOf("token");
    const turn = types.indexOf("turn");
    expect(types[0]).toBe("phase");
    expect(start).toBeGreaterThan(0);
    expect(result).toBe(start + 1);
    expect(token).toBe(result + 1);
    expect(turn).toBe(token + 1);

    const finished = events[result];
    expect(finished?.type).toBe("tool-result");
    if (finished?.type === "tool-result") {
      expect(finished.result.ok).toBe(true);
      expect(finished.result.output).toBe("output:a-source");
    }

    // The runner owns persistence and records the session's tool event.
    expect(saved).toHaveLength(1);
    expect(saved[0]!.toolEvents).toHaveLength(1);
    expect(saved[0]!.toolEvents?.[0]?.side).toBe("A");
    // Session usage is summed into the match metrics.
    expect(saved[0]!.metrics.usage).toEqual({ promptTokens: 3, completionTokens: 4 });

    // The opening session only saw an empty transcript and no prior tools.
    expect(moveInputs[0]?.observation).toEqual([]);
    expect(moveInputs[0]?.publicToolEvents).toEqual([]);
    expect(moveInputs[0]?.maxAffordableTools).toBe(2);
  });

  it("keeps one private session per side with distinct stable keys and identity", async () => {
    const controller = new AbortController();
    const { factory, factoryInputs, moveInputs } = fakeSessions((side, index) => {
      if (side === "A") return { speech: `A${index}`, ready: index >= 1, toolEvents: [toolEvent(`a-source-${index}`)] };
      return speak(`B${index}`, index >= 1);
    });

    await drain(
      runDebate(standardInput(), {
        matchId: "match-session",
        abortSignal: controller.signal,
        callModel: judgeCall,
        runTool: async () => ({ ok: true, output: "unused" }),
        createStandardAgentSession: factory,
        saveMatch: noopSave,
      }),
    );

    expect(factoryInputs.map((input) => input.side)).toEqual(["A", "B"]);
    expect(factoryInputs.map((input) => input.sessionKey)).toEqual(["match-session:agent-a", "match-session:agent-b"]);
    expect(factoryInputs.map((input) => input.position)).toEqual(["FOR", "AGAINST"]);
    expect(factoryInputs.every((input) => input.maxOutputTokens === MATCH_PROFILES.standard.agentMaxOutputTokens)).toBe(true);

    const aMoves = moveInputs.filter((input) => input.side === "A");
    const bMoves = moveInputs.filter((input) => input.side === "B");
    expect(aMoves).toHaveLength(2);
    expect(bMoves).toHaveLength(2);
    // Tool events are public match state: A sees its own prior call, and B sees
    // A's public call on its later move while keeping its own side identity.
    expect(aMoves[0]?.publicToolEvents).toHaveLength(0);
    expect(aMoves[1]?.publicToolEvents).toHaveLength(1);
    expect(aMoves[1]?.publicToolEvents[0]?.query).toBe("a-source-0");
    expect(bMoves[1]?.publicToolEvents.some((event) => event.query === "a-source-0")).toBe(true);
    // The abort signal is passed straight through to every move.
    expect(moveInputs.every((input) => input.abortSignal === controller.signal)).toBe(true);
  });

  it("passes the runner-owned credit budget to the session and charges actual usage", async () => {
    const { factory, moveInputs } = fakeSessions((side, index) => {
      if (side === "A" && index === 0) return { speech: "A0", ready: false, toolEvents: [toolEvent("s")] };
      return speak(`${side}${index}`, true);
    });

    await drain(
      runDebate(standardInput({ startingCredits: 5, maxToolsPerMove: 1, toolTimeoutSeconds: 3 }), {
        callModel: judgeCall,
        runTool: async () => ({ ok: true, output: "unused" }),
        createStandardAgentSession: factory,
        saveMatch: noopSave,
      }),
    );

    const aMoves = moveInputs.filter((input) => input.side === "A");
    expect(aMoves[0]?.credits).toBe(5);
    expect(aMoves[0]?.speechCost).toBe(1);
    expect(aMoves[0]?.toolCost).toBe(2);
    expect(aMoves[0]?.maxToolsPerMove).toBe(1);
    expect(aMoves[0]?.maxAffordableTools).toBe(1);
    expect(aMoves[0]?.toolTimeoutMs).toBe(3_000);
    // One tool (2) + one speech (1) charged: the next A move starts at 2 credits
    // and can no longer afford a tool.
    expect(aMoves[1]?.credits).toBe(2);
    expect(aMoves[1]?.maxAffordableTools).toBe(0);
  });

  it("ends immediately when both sides are ready in the same round", async () => {
    const { factory, moveInputs } = fakeSessions((side, index) => speak(`${side}${index}`, true));

    const events = await drain(
      runDebate(standardInput(), {
        callModel: judgeCall,
        runTool: async () => ({ ok: true, output: "unused" }),
        createStandardAgentSession: factory,
        saveMatch: noopSave,
      }),
    );

    expect(events.flatMap((event) => (event.type === "phase" ? [event.phase] : []))).toEqual([
      "standard-a-opening",
      "standard-b-opening",
      "standard-a-round-1",
      "standard-b-round-1",
    ]);
    expect(moveInputs.every((input) => input.closingRound === false)).toBe(true);
  });

  it("gives one ready side exactly one paired answer round flagged as closing", async () => {
    // A signals ready on every speak (its opening ready intent is ignored); B
    // never does. A's round-1 ready forces one more paired round.
    const { factory, moveInputs } = fakeSessions((side, index) => speak(`${side}${index}`, side === "A"));

    const events = await drain(
      runDebate(standardInput(), {
        callModel: judgeCall,
        runTool: async () => ({ ok: true, output: "unused" }),
        createStandardAgentSession: factory,
        saveMatch: noopSave,
      }),
    );

    expect(events.flatMap((event) => (event.type === "phase" ? [event.phase] : []))).toEqual([
      "standard-a-opening",
      "standard-b-opening",
      "standard-a-round-1",
      "standard-b-round-1",
      "standard-a-round-2",
      "standard-b-round-2",
    ]);

    const round = (side: DebateSide, n: number) =>
      moveInputs.find((input) => input.side === side && input.phase === `standard-${side.toLowerCase()}-round-${n}`);
    expect(round("A", 1)?.closingRound).toBe(false);
    expect(round("B", 1)?.closingRound).toBe(false);
    expect(round("A", 2)?.closingRound).toBe(true);
    expect(round("B", 2)?.closingRound).toBe(true);
  });

  it("keeps a failed tool public and lets the match continue", async () => {
    const saved: import("@arena/debate-engine").MatchRecord[] = [];
    const { factory } = fakeSessions((side, index) => {
      if (side === "A" && index === 0) {
        return {
          speech: "A continues despite the failure.",
          ready: true,
          toolEvents: [toolEvent("x", { ok: false, output: "Search timed out.", error: "Search timed out" })],
        };
      }
      return speak(`${side}${index}`, true);
    });

    const events = await drain(
      runDebate(standardInput(), {
        callModel: judgeCall,
        runTool: async () => ({ ok: true, output: "unused" }),
        createStandardAgentSession: factory,
        saveMatch: async (record) => {
          saved.push(record);
        },
      }),
    );

    const failed = events.find((event) => event.type === "tool-result");
    expect(failed?.type).toBe("tool-result");
    if (failed?.type === "tool-result") {
      expect(failed.result.ok).toBe(false);
      expect(failed.result.error).toBe("Search timed out");
    }
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)?.type).toBe("done");
    expect(saved[0]!.terminal).toBe("completed");
  });

  it("survives a session failure as a persisted error terminal", async () => {
    const saved: import("@arena/debate-engine").MatchRecord[] = [];
    const { factory } = fakeSessions((side, index) => {
      if (side === "A" && index === 0) throw new Error("session exploded");
      return speak(`${side}${index}`, true);
    });

    const events = await drain(
      runDebate(standardInput(), {
        callModel: judgeCall,
        runTool: async () => ({ ok: true, output: "unused" }),
        createStandardAgentSession: factory,
        saveMatch: async (record) => {
          saved.push(record);
        },
      }),
    );

    const types = typesOf(events);
    expect(types.filter((type) => type === "error")).toHaveLength(1);
    expect(types.at(-1)).toBe("done");
    const error = events.find((event) => event.type === "error");
    if (error?.type === "error") expect(error.message).toContain("session exploded");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.terminal).toBe("error");
  });

  it("fails visibly when Standard runs without a session factory", async () => {
    const events = await drain(
      runDebate(standardInput(), {
        callModel: judgeCall,
        runTool: async () => ({ ok: true, output: "unused" }),
        saveMatch: noopSave,
      }),
    );
    const error = events.find((event) => event.type === "error");
    expect(error?.type).toBe("error");
    if (error?.type === "error") expect(error.message).toMatch(/createStandardAgentSession/);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("leaves Quick untouched and never constructs a Standard session", async () => {
    let factoryCalls = 0;
    const factory: StandardAgentSessionFactory = () => {
      factoryCalls += 1;
      throw new Error("Quick must not build Standard sessions");
    };
    const events = await drain(
      runDebate(
        {
          topic: "Should AI be regulated?",
          mode: "quick",
          agentA: { providerId: "p1", model: "m1", position: "FOR" },
          agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
        },
        { callModel: judgeCall, createStandardAgentSession: factory, saveMatch: noopSave },
      ),
    );

    expect(events.filter((event) => event.type === "turn")).toHaveLength(6);
    expect(events.some((event) => event.type === "tool-start" || event.type === "tool-result")).toBe(false);
    expect(factoryCalls).toBe(0);
    expect(events.at(-1)?.type).toBe("done");
  });
});
