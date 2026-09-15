/**
 * Full-seam test for `POST /api/debate` in Standard mode: the real route and the
 * real `runDebate` runner are exercised, while only the outer I/O seams are
 * faked — provider lookup, the web adapter (model / tool executor / persistence),
 * and the Standard session factory. That keeps the match deterministic with no
 * network or process execution while still covering POST → runner → sessions →
 * tool events → judge → save as one flow.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DebateStreamEvent } from "@arena/types";
import type {
  MatchRecord,
  StandardAgentMoveResult,
  StandardAgentSessionFactory,
  StandardAgentToolEvent,
  StandardToolName,
  StandardToolResult,
} from "@arena/debate-engine";

const mocks = vi.hoisted(() => ({
  webCallModel: vi.fn(),
  webRunStandardTool: vi.fn(),
  webSaveMatch: vi.fn(),
  createWebStandardAgentSession: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock("@/features/run-debate/server/web-adapter", () => ({
  webCallModel: mocks.webCallModel,
  webRunStandardTool: mocks.webRunStandardTool,
  webSaveMatch: mocks.webSaveMatch,
}));

vi.mock("@/features/run-debate/server/standard-agent-adapter", () => ({
  createWebStandardAgentSession: mocks.createWebStandardAgentSession,
}));

vi.mock("@/shared/config/provider-store", () => ({
  getProvider: mocks.getProvider,
}));

import { POST } from "./route";

const VALID_VERDICT_JSON = JSON.stringify({
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

const A_TOOL_OUTPUT = "Transit data shows the ban reduced short trips.";
const B_TOOL_ERROR = "Fetch request failed";

/**
 * One deterministic session per side. The opening move performs exactly one
 * tool call (A succeeds, B fails) and then speaks; the paired round speaks
 * `ready`, which ends the match naturally after both sides answer. Live
 * progress and the final tool list are kept identical so the runner's
 * live/final agreement check passes.
 */
const scriptedSessionFactory: StandardAgentSessionFactory = (input) => {
  let moveIndex = 0;
  return {
    async move(moveInput): Promise<StandardAgentMoveResult> {
      const index = moveIndex;
      moveIndex += 1;
      const toolEvents: StandardAgentToolEvent[] = [];
      if (index === 0) {
        const tool: StandardToolName = input.side === "A" ? "web_search" : "fetch_url";
        const query = input.side === "A" ? "short-term rental transit evidence" : "https://example.com/source";
        const invocationId = `${input.side}-tool-${index}`;
        moveInput.onProgress?.({ type: "tool-start", invocationId, tool, query });
        const result = await moveInput.runTool(
          tool,
          { query, timeoutMs: moveInput.toolTimeoutMs },
          moveInput.abortSignal,
        );
        const event: StandardAgentToolEvent = {
          tool,
          query,
          output: result.output,
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
        };
        moveInput.onProgress?.({
          type: "tool-result",
          invocationId,
          tool,
          query,
          output: event.output,
          ok: event.ok,
          ...(event.error ? { error: event.error } : {}),
        });
        toolEvents.push(event);
      }
      const speech = index === 0 ? `${input.side} opening speech.` : `${input.side} round-${index} speech.`;
      moveInput.onProgress?.({ type: "speech", text: speech });
      return { speech, ready: index >= 1, toolEvents };
    },
  };
};

function standardBody() {
  return {
    topic: "Should cities restrict short-term rentals?",
    mode: "standard" as const,
    agentA: { providerId: "p1", model: "m1", position: "FOR" },
    agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
  };
}

async function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/debate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function readNdjson(res: Response): Promise<DebateStreamEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DebateStreamEvent);
}

const saved: MatchRecord[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  saved.length = 0;
  mocks.getProvider.mockImplementation(async (id: string) => ({
    id,
    name: `Provider ${id}`,
    baseUrl: "https://provider.example/v1",
    model: "m",
    api: "chat",
    apiKey: "sk-should-never-appear",
  }));
  mocks.webCallModel.mockImplementation(async (args: { kind: string }) => {
    if (args.kind !== "judge") throw new Error("Standard mode must not call callModel for agents");
    return { text: VALID_VERDICT_JSON, chunks: [] as string[] };
  });
  mocks.webRunStandardTool.mockImplementation(async (tool: StandardToolName): Promise<StandardToolResult> => {
    if (tool === "fetch_url") return { ok: false, output: "The page could not be reached.", error: B_TOOL_ERROR };
    return { ok: true, output: A_TOOL_OUTPUT };
  });
  mocks.webSaveMatch.mockImplementation(async (record: MatchRecord) => {
    saved.push(record);
  });
  mocks.createWebStandardAgentSession.mockImplementation(scriptedSessionFactory);
});

describe("POST /api/debate Standard full seam", () => {
  it("streams a complete agent match through the real runner and persists it", async () => {
    const response = await post(standardBody());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");

    const events = await readNdjson(response);
    const types = events.map((event) => event.type);

    // Envelope: v1, one matchId, strictly monotonic seq.
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event.v).toBe(1);
    const matchIds = new Set(events.map((event) => event.matchId));
    expect(matchIds.size).toBe(1);
    expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index + 1));

    // Ordering: opening + paired ready round, one speech token per move, then
    // the judge leg and exactly one terminal.
    expect(types).toEqual([
      "phase", "tool-start", "tool-result", "token", "turn", "standard-state",
      "phase", "tool-start", "tool-result", "token", "turn", "standard-state",
      "phase", "token", "turn", "standard-state",
      "phase", "token", "turn", "standard-state",
      "judge-start", "verdict", "done",
    ]);
    expect(events.filter((event) => event.type === "error")).toHaveLength(0);
    expect(events.filter((event) => event.type === "judge-start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "verdict")).toHaveLength(1);
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("done");

    const phases = events.flatMap((event) => (event.type === "phase" ? [event.phase] : []));
    expect(phases).toEqual([
      "standard-a-opening",
      "standard-b-opening",
      "standard-a-round-1",
      "standard-b-round-1",
    ]);

    // Every turn is preceded by exactly its own phase event.
    const turns = events.flatMap((event) => (event.type === "turn" ? [event.turn] : []));
    expect(turns.map((turn) => turn.phase)).toEqual(phases);
    expect(turns.map((turn) => turn.side)).toEqual(["A", "B", "A", "B"]);
    expect(turns[0]?.content).toContain("opening");

    // Tool start/result pairs share stable identity and side.
    const starts = events.flatMap((event) => (event.type === "tool-start" ? [event.tool] : []));
    const results = events.flatMap((event) => (event.type === "tool-result" ? [event.result] : []));
    expect(starts).toHaveLength(2);
    expect(results).toHaveLength(2);
    expect(starts.map((start) => [start.side, start.tool])).toEqual([
      ["A", "web_search"],
      ["B", "fetch_url"],
    ]);
    for (const [index, result] of results.entries()) {
      expect(result.callId).toBe(starts[index]!.callId);
      expect(result.createdAt).toBe(starts[index]!.createdAt);
      expect(result.side).toBe(starts[index]!.side);
      expect(result.query).toBe(starts[index]!.query);
    }
    // The failed fetch is public but does not destroy the match.
    expect(results[0]).toMatchObject({ side: "A", ok: true, output: A_TOOL_OUTPUT });
    expect(results[1]).toMatchObject({ side: "B", ok: false, error: B_TOOL_ERROR });

    // Authoritative Standard state changes after each move.
    const states = events.flatMap((event) => (event.type === "standard-state" ? [event.state] : []));
    expect(states).toHaveLength(4);
    expect(states[0]!.movesUsed).toBe(1);
    expect(states[0]!.moveLimitReached).toBe(false);
    expect(states[0]!.sides.A).toMatchObject({
      creditsRemaining: 9,
      toolsUsed: 1,
      toolsUsedThisMove: 1,
      toolsRejected: 0,
      depleted: false,
    });
    expect(states[0]!.sides.B).toMatchObject({ creditsRemaining: 12, toolsUsed: 0 });
    expect(states[1]!.sides.B).toMatchObject({ creditsRemaining: 9, toolsUsed: 1 });
    expect(states[3]!.movesUsed).toBe(4);
    expect(states[3]!.sides.A.creditsRemaining).toBe(8);
    expect(states[3]!.sides.B.creditsRemaining).toBe(8);
    expect(states[3]!.ready).toEqual({ A: true, B: true });

    // The judge leg ran exactly once, on the web model seam.
    expect(mocks.webCallModel).toHaveBeenCalledTimes(1);
    expect(mocks.webCallModel.mock.calls[0]?.[0]).toMatchObject({ kind: "judge" });

    // Persistence: exactly once, Standard-shaped, secret-free.
    expect(mocks.webSaveMatch).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
    const record = saved[0]!;
    expect(record.mode).toBe("standard");
    expect(record.terminal).toBe("completed");
    expect(record.standardEndReason).toBe("both-ready");
    expect(record.terminalReason).toMatch(/ready/i);
    expect(record.standard).toEqual({
      startingCredits: 12,
      maxToolsPerMove: 2,
      toolTimeoutMs: 8_000,
      maxMoves: 12,
    });
    expect(record.transcript.map((turn) => turn.phase)).toEqual(phases);
    expect(record.toolEvents).toHaveLength(2);
    expect(record.toolEvents?.[0]).toMatchObject({ side: "A", tool: "web_search", ok: true });
    expect(record.toolEvents?.[1]).toMatchObject({ side: "B", tool: "fetch_url", ok: false, error: B_TOOL_ERROR });
    expect(record.toolEvents?.[1]?.rejected).toBeUndefined();
    expect(record.verdict?.winner).toBe("A");
    expect(record.verdict?.criteria.argumentQualityA).toBe(85);

    // No provider credentials or endpoints leak into the stream or the record.
    expect(JSON.stringify(events)).not.toMatch(/sk-should-never-appear|apiKey|baseUrl/i);
    expect(JSON.stringify(record)).not.toMatch(/sk-should-never-appear|apiKey|baseUrl/i);
  });
});
