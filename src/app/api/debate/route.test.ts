/**
 * API contract + streaming tests for `POST /api/debate` (QA F6-07, F7-07, F7-09, F6-08).
 *
 * The route handler is invoked directly with a `Request`. The provider store
 * is faked (`vi.mock` of `getProvider`) to point at a local mock
 * OpenAI-compatible HTTP server; the AI SDK itself is NOT mocked, so every
 * model call exercises the real `streamText`/`generateText` + SSE/JSON wire
 * handling against `http://127.0.0.1:<port>/v1`. Nothing leaves loopback.
 */

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setTimeout as sleep } from "node:timers/promises";
import type { DebateStreamEvent } from "../../../shared/api/debate-stream";
import { POST } from "./route";
import { getProvider } from "../../../shared/config/provider-store";
import { saveMatchRecord } from "../../../shared/config/match-store";
import {
  startMockOpenAIProvider,
  type MockOpenAIProvider,
} from "../../../test/mock-openai-provider";

vi.mock("../../../shared/config/provider-store", () => ({ getProvider: vi.fn() }));
vi.mock("../../../shared/config/match-store", () => ({ saveMatchRecord: vi.fn() }));
// `server-only` is a deployment-time boundary marker with no runtime module
// installed here; stub it so the real model factory can load under vitest.
vi.mock("server-only", () => ({}));

const getProviderMock = vi.mocked(getProvider);
const saveMatchMock = vi.mocked(saveMatchRecord);

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

const GARBAGE_JUDGE_TEXT = "this is not JSON at all {{{";

const AGENT_TEXTS = [
  "Agent A opening argument.",
  "Agent B opening argument.",
  "Agent A rebuttal argument.",
  "Agent B rebuttal argument.",
];

let mock: MockOpenAIProvider;

beforeAll(async () => {
  mock = await startMockOpenAIProvider();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
  getProviderMock.mockReset();
  getProviderMock.mockImplementation(async (id: string) => ({
    id,
    name: "Mock Provider",
    baseUrl: mock.baseUrl,
    model: "mock-model",
    api: "chat",
    apiKey: "sk-test",
  }));
  saveMatchMock.mockReset();
  saveMatchMock.mockImplementation(async () => {});
});

function validBody() {
  return {
    topic: "Should AI be regulated?",
    mode: "quick",
    agentA: { providerId: "test-provider", model: "mock-model", position: "FOR" },
    agentB: { providerId: "test-provider", model: "mock-model", position: "AGAINST" },
  };
}

function postDebate(body: unknown, signal?: AbortSignal): Promise<Response> {
  return POST(
    new Request("http://localhost/api/debate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
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

function count(events: DebateStreamEvent[], type: DebateStreamEvent["type"]): number {
  return events.filter((event) => event.type === type).length;
}

async function readErrorBody(res: Response): Promise<{ status: number; error: unknown }> {
  return { status: res.status, error: (await res.json() as { error?: unknown }).error };
}

describe("POST /api/debate", () => {
  it("streams a full Quick match: phases, token deltas, 4 turns, verdict, exactly one done (F7-07)", async () => {
    mock.enqueue(
      ...AGENT_TEXTS.map((text) => ({ kind: "text", text }) as const),
      // Two copies: the judge may take one HTTP call (structured output) or
      // two (structured attempt + plain-text fallback) depending on SDK path.
      { kind: "text", text: VALID_VERDICT_JSON },
      { kind: "text", text: VALID_VERDICT_JSON },
    );

    const res = await postDebate(validBody());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const events = await readNdjson(res);
    expect(count(events, "error")).toBe(0);
    expect(count(events, "done")).toBe(1);
    expect(events[events.length - 1]?.type).toBe("done");

    expect(events.filter((event) => event.type === "phase").map((event) => event.type === "phase" ? event.phase : null)).toEqual([
      "OPENING_A",
      "OPENING_B",
      "REBUTTAL_A",
      "REBUTTAL_B",
    ]);

    const turns = events.filter((event) => event.type === "turn");
    expect(turns.map((event) => event.type === "turn" ? event.turn.content : null)).toEqual(AGENT_TEXTS);

    // Streaming deltas flow through: concatenated tokens equal the agent texts.
    const tokens = events.filter((event) => event.type === "token");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.map((event) => event.type === "token" ? event.text : "").join("")).toBe(AGENT_TEXTS.join(""));

    const judgeStartIndex = events.findIndex((event) => event.type === "judge-start");
    const verdictIndex = events.findIndex((event) => event.type === "verdict");
    expect(count(events, "judge-start")).toBe(1);
    expect(count(events, "verdict")).toBe(1);
    expect(judgeStartIndex).toBeGreaterThan(-1);
    expect(verdictIndex).toBeGreaterThan(judgeStartIndex);
    const verdictEvent = events[verdictIndex];
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
      expect(verdictEvent.verdict.scoreA).toBe(82);
    }

    // Wire proof: agent calls streamed over HTTP, everything hit the mock.
    expect(mock.requestCount).toBeGreaterThanOrEqual(5);
    expect(mock.requests.every((request) => request.url.endsWith("/chat/completions"))).toBe(true);
    expect(mock.requests.slice(0, 4).every((request) => request.stream === true)).toBe(true);

    // Stream contract v1: every event carries v/matchId/seq, seq from 1.
    expect(events.every((event) => event.v === 1)).toBe(true);
    expect(events.every((event) => typeof event.matchId === "string" && event.matchId.length > 0)).toBe(true);
    expect(new Set(events.map((event) => event.matchId)).size).toBe(1);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    const streamMatchId = events[0]?.matchId;
    const doneEvent = events[events.length - 1];
    expect(doneEvent?.type).toBe("done");
    if (doneEvent?.type === "done") expect(doneEvent.terminal).toBe("completed");

    // The match record was persisted once, secret-free, for the same match.
    expect(saveMatchMock).toHaveBeenCalledTimes(1);
    const record = saveMatchMock.mock.calls[0]?.[0];
    expect(record?.matchId).toBe(streamMatchId);
    expect(record?.terminal).toBe("completed");
    expect(record?.verdict?.winner).toBe("A");
    expect(record?.transcript).toHaveLength(4);
    expect(record?.sides.A.providerName).toBe("Mock Provider");
    expect(record?.sides.B.providerName).toBe("Mock Provider");
    expect(JSON.stringify(record)).not.toMatch(/apiKey|baseUrl|sk-test/i);
  });

  it("rejects an empty topic with a 400 {error} shape (F6-07)", async () => {
    const res = await postDebate({ ...validBody(), topic: "   " });
    const body = await readErrorBody(res);
    expect(body.status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect((body.error as string).length).toBeGreaterThan(0);
    expect(mock.requestCount).toBe(0);
  });

  it("rejects an unknown mode with a 400 {error} shape (F6-07)", async () => {
    const res = await postDebate({ ...validBody(), mode: "marathon" });
    const body = await readErrorBody(res);
    expect(body.status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(mock.requestCount).toBe(0);
  });

  it("rejects a contract-valid but disabled standard mode with a 400 {error} shape", async () => {
    const res = await postDebate({ ...validBody(), mode: "standard" });
    const body = await readErrorBody(res);
    expect(body.status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(mock.requestCount).toBe(0);
    expect(saveMatchMock).not.toHaveBeenCalled();
  });

  it("rejects a body missing agentB with a 400 {error} shape (F6-07)", async () => {
    const { agentB: _dropped, ...rest } = validBody();
    void _dropped;
    const res = await postDebate(rest);
    const body = await readErrorBody(res);
    expect(body.status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(mock.requestCount).toBe(0);
  });

  it("rejects a malformed JSON body with a 400 {error} shape (F6-07)", async () => {
    const res = await POST(
      new Request("http://localhost/api/debate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );
    const body = await readErrorBody(res);
    expect(body.status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(mock.requestCount).toBe(0);
  });

  it("rejects an unknown provider id with a 400 {error} shape before any model call (F6-07)", async () => {
    getProviderMock.mockImplementation(async (id: string) => {
      if (id === "missing-provider") return undefined;
      return { id, name: "Mock Provider", baseUrl: mock.baseUrl, model: "mock-model", api: "chat", apiKey: "sk-test" };
    });
    const res = await postDebate({
      ...validBody(),
      agentB: { providerId: "missing-provider", model: "mock-model", position: "AGAINST" },
    });
    const body = await readErrorBody(res);
    expect(body.status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(mock.requestCount).toBe(0);
  });

  it("surfaces a provider HTTP 500 mid-run as a single error plus done, then closes the stream", async () => {
    mock.enqueue(
      { kind: "text", text: AGENT_TEXTS[0] },
      // Extra copies: the SDK retries transient 5xx before surfacing the failure.
      { kind: "error", status: 500, message: "upstream boom" },
      { kind: "error", status: 500, message: "upstream boom" },
      { kind: "error", status: 500, message: "upstream boom" },
      { kind: "error", status: 500, message: "upstream boom" },
      { kind: "error", status: 500, message: "upstream boom" },
    );

    const res = await postDebate(validBody());
    expect(res.status).toBe(200);
    const events = await readNdjson(res);

    expect(count(events, "error")).toBe(1);
    expect(count(events, "done")).toBe(1);
    expect(events[events.length - 1]?.type).toBe("done");
    expect(count(events, "verdict")).toBe(0);
    // The first turn completed before the failure; the run stopped there.
    expect(count(events, "turn")).toBe(1);

    const errorEvent = events.find((event) => event.type === "error");
    expect(errorEvent?.type).toBe("error");
    if (errorEvent?.type === "error") {
      expect(errorEvent.message.length).toBeGreaterThan(0);
      expect(errorEvent.message).not.toContain("sk-test");
    }

    const done500 = events[events.length - 1];
    if (done500?.type === "done") expect(done500.terminal).toBe("error");
    expect(saveMatchMock).toHaveBeenCalledTimes(1);
    const record500 = saveMatchMock.mock.calls[0]?.[0];
    expect(record500?.terminal).toBe("error");
    expect(record500?.verdict).toBeNull();
    expect(record500?.transcript).toHaveLength(1);
    expect(JSON.stringify(record500)).not.toMatch(/apiKey|baseUrl|sk-test/i);
  }, 30_000);

  it("emits error then done (no verdict) when the judge keeps returning malformed JSON", async () => {
    mock.enqueue(
      ...AGENT_TEXTS.map((text) => ({ kind: "text", text }) as const),
      ...Array.from({ length: 10 }, () => ({ kind: "text", text: GARBAGE_JUDGE_TEXT }) as const),
    );

    const res = await postDebate(validBody());
    const events = await readNdjson(res);

    // Actual runner behavior: one retry, then error+done — assert it, don't change it.
    expect(count(events, "verdict")).toBe(0);
    expect(count(events, "error")).toBe(1);
    expect(count(events, "done")).toBe(1);
    expect(events[events.length - 2]?.type).toBe("error");
    expect(events[events.length - 1]?.type).toBe("done");
    const errorEvent = events[events.length - 2];
    expect(errorEvent?.type).toBe("error");
    if (errorEvent?.type === "error") {
      expect(errorEvent.message).toBe("Judge returned invalid verdict");
    }
    // Retry traffic actually happened (4 agents + at least 2 judge attempts).
    expect(mock.requestCount).toBeGreaterThanOrEqual(6);
    const doneJudge = events[events.length - 1];
    if (doneJudge?.type === "done") expect(doneJudge.terminal).toBe("error");
    expect(saveMatchMock).toHaveBeenCalledTimes(1);
    expect(saveMatchMock.mock.calls[0]?.[0]?.terminal).toBe("error");
  });

  it("recovers with a verdict when the judge retry returns valid JSON", async () => {
    mock.enqueue(...AGENT_TEXTS.map((text) => ({ kind: "text", text }) as const));
    // Route judge calls by body content: the retry prompt carries the
    // "Previous output was invalid" marker, so this holds regardless of how
    // many HTTP calls the SDK needs per judge round (structured/fallback).
    mock.setResponder((ctx) => {
      if (ctx.stream === true) return undefined; // agents consume the queue
      if (ctx.bodyText.includes("Previous output was invalid")) {
        return { kind: "text", text: VALID_VERDICT_JSON };
      }
      return { kind: "text", text: GARBAGE_JUDGE_TEXT };
    });

    const res = await postDebate(validBody());
    const events = await readNdjson(res);

    expect(count(events, "error")).toBe(0);
    expect(count(events, "verdict")).toBe(1);
    expect(count(events, "done")).toBe(1);
    expect(events[events.length - 1]?.type).toBe("done");
    expect(mock.requestCount).toBeGreaterThanOrEqual(6);
    const doneRecovered = events[events.length - 1];
    if (doneRecovered?.type === "done") expect(doneRecovered.terminal).toBe("completed");
  });

  it("client disconnect mid-run terminates the stream with no duplicate terminals and stops further model calls (F7-09, F6-08)", async () => {
    mock.enqueue(
      { kind: "text", text: "Slow opening statement that streams for a while. ", chunkChars: 4, chunkDelayMs: 40 },
      { kind: "text", text: AGENT_TEXTS[1] },
      { kind: "text", text: AGENT_TEXTS[2] },
      { kind: "text", text: AGENT_TEXTS[3] },
      { kind: "text", text: VALID_VERDICT_JSON },
      { kind: "text", text: VALID_VERDICT_JSON },
    );

    const controller = new AbortController();
    const res = await postDebate(validBody(), controller.signal);
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    // Drain the NDJSON stream in the background.
    const events: DebateStreamEvent[] = [];
    let drainError: unknown = null;
    const reader = res.body!.getReader();
    const drain = (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index = buffer.indexOf("\n");
          while (index !== -1) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (line.length > 0) events.push(JSON.parse(line) as DebateStreamEvent);
            index = buffer.indexOf("\n");
          }
        }
      } catch (error) {
        drainError = error;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Ignore — the stream may already be torn down after abort.
        }
      }
    })();

    // Disconnect while the first model call is in flight: the mock logs each
    // request before streaming its SSE, and the slow first reply keeps that
    // response open for ~600ms, so aborting here lands mid-model-call.
    // (Aborting on the first token is racy — the SDK may deliver deltas in a
    // burst after the response completes.)
    const deadline = Date.now() + 5_000;
    while (mock.requestCount === 0 && Date.now() < deadline) await sleep(10);
    expect(mock.requestCount).toBeGreaterThanOrEqual(1);
    controller.abort();
    await drain;
    if (drainError !== null) {
      // Aborting the request may reject the reader; that is a clean termination.
      expect(drainError instanceof Error && /abort/i.test(drainError.message)).toBe(true);
    }

    // The run was cut off mid-stream: terminals appear at most once each
    // (no duplicate done/error), and the stream terminated.
    expect(events.length).toBeGreaterThan(0);
    expect(count(events, "done")).toBeLessThanOrEqual(1);
    expect(count(events, "error")).toBeLessThanOrEqual(1);

    // Give any background work a chance to (incorrectly) continue, then prove
    // the run stopped: no new model calls and the in-flight call was aborted.
    await sleep(400);
    const countAfterAbort = mock.requestCount;
    await sleep(400);
    expect(mock.requestCount).toBe(countAfterAbort);
    expect(mock.abortedCount).toBeGreaterThanOrEqual(1);
    expect(countAfterAbort).toBeLessThan(6);

    // The abandoned run was persisted exactly once as cancelled.
    expect(saveMatchMock).toHaveBeenCalledTimes(1);
    const recordCancelled = saveMatchMock.mock.calls[0]?.[0];
    expect(recordCancelled?.terminal).toBe("cancelled");
    expect(recordCancelled?.verdict).toBeNull();
    expect(JSON.stringify(recordCancelled)).not.toMatch(/apiKey|baseUrl|sk-test/i);
  }, 20_000);
});
