/**
 * Tests for `POST /api/matches/[id]/challenges` (bounded post-match
 * challenges, F10-11..13).
 *
 * Records are seeded through the real `runDebate` (injected model calls, no
 * HTTP) into a temp match dir; challenge model calls go through the real
 * `webCallModel` against the local mock OpenAI-compatible provider.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { MatchRecord } from "@arena/debate-engine";
import { runDebate, normalizeUserEvidencePacket } from "@arena/debate-engine";
import { getProvider } from "../../../../../shared/config/provider-store";
import { loadMatchRecord, saveMatchRecord } from "../../../../../shared/config/match-store";
import { POST as postChallenge } from "./route";
import {
  startMockOpenAIProvider,
  type MockOpenAIProvider,
} from "../../../../../test/mock-openai-provider";

vi.mock("../../../../../shared/config/provider-store", () => ({ getProvider: vi.fn() }));
vi.mock("server-only", () => ({}));

const getProviderMock = vi.mocked(getProvider);

const VERDICT_A_JSON = JSON.stringify({
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

const AGENT_TEXTS = ["A opening.", "B opening.", "A first response.", "B first response.", "A final response.", "B final response."];

const ADJUDICATION_JSON = JSON.stringify({
  claimStatus: "supported",
  evidenceAssessments: [],
  reasoning: "The response is consistent with the transcript.",
});

/** P1-6: answers must cite at least one allowed (selected) evidence id. */
function challengeAnswerJson(citedEvidenceIds: readonly string[]): string {
  return JSON.stringify({
    kind: "answer",
    answer: "The claim holds: module prices fell an order of magnitude.",
    citedEvidenceIds: [...citedEvidenceIds],
  });
}

let mock: MockOpenAIProvider;
let dir = "";
const ORIGINAL_DIR = process.env.AI_DEBATE_ARENA_MATCH_DIR;

beforeAll(async () => {
  mock = await startMockOpenAIProvider();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-debate-arena-challenge-"));
  process.env.AI_DEBATE_ARENA_MATCH_DIR = dir;
  mock.reset();
  getProviderMock.mockReset();
  getProviderMock.mockImplementation(async (id: string) => {
    if (id === "missing-provider") return undefined;
    return { id, name: "Mock Provider", baseUrl: mock.baseUrl, model: "mock-model", api: "chat", apiKey: "sk-test" };
  });
});

afterEach(async () => {
  if (ORIGINAL_DIR === undefined) delete process.env.AI_DEBATE_ARENA_MATCH_DIR;
  else process.env.AI_DEBATE_ARENA_MATCH_DIR = ORIGINAL_DIR;
  await rm(dir, { recursive: true, force: true });
});

/** Seeds a completed quick match; `withProviderIds` controls the v0.4 side ids. */
async function seedCompletedMatch(matchId: string, withProviderIds: boolean): Promise<MatchRecord> {
  const saved: MatchRecord[] = [];
  let agentCalls = 0;
  const events = runDebate(
    {
      topic: "Should AI be regulated?",
      mode: "quick",
      agentA: { providerId: "test-provider", model: "mock-model", position: "FOR" },
      agentB: { providerId: "test-provider", model: "mock-model", position: "AGAINST" },
    },
    {
      matchId,
      callModel: async (args) => {
        if (args.kind === "judge") return { text: VERDICT_A_JSON, chunks: [] };
        const text = AGENT_TEXTS[agentCalls % AGENT_TEXTS.length]!;
        agentCalls += 1;
        return { text, chunks: [] };
      },
      saveMatch: async (record) => {
        saved.push(record);
      },
      ...(withProviderIds
        ? {
            sides: {
              A: { providerName: "Mock Provider", modelId: "mock-model", position: "FOR" as const, providerId: "test-provider" },
              B: { providerName: "Mock Provider", modelId: "mock-model", position: "AGAINST" as const, providerId: "test-provider" },
            },
          }
        : {}),
    },
  );
  for await (const event of events) {
    void event;
  }
  let record = saved[0]!;
  expect(record.terminal).toBe("completed");
  if (withProviderIds) {
    const evidence = normalizeUserEvidencePacket({
      version: 1,
      items: [{ source: "user_text", label: "notes", content: "Solar module prices fell sharply." }],
    });
    if (!evidence.success) throw new Error("fixture evidence failed");
    record = {
      ...record,
      evidence: evidence.data,
    };
  }
  await saveMatchRecord(record);
  return record;
}

function challengeBody(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    requestId: "req-1",
    target: { turnId: "t1", claimText: "A opening." },
    evidenceIds: [],
    ...overrides,
  };
}

function postChallengeRequest(matchId: string, body: unknown): Promise<Response> {
  return postChallenge(
    new Request(`http://localhost/api/matches/${matchId}/challenges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: matchId }) },
  );
}

describe("POST /api/matches/[id]/challenges", () => {
  it("runs a completed challenge end-to-end and preserves the original verdict/terminal", async () => {
    const record = await seedCompletedMatch("ch-ok", true);
    const turnId = record.transcript[0]!.id;
    const evidenceId = record.evidence?.items[0]?.id;
    expect(evidenceId).toBeDefined();
    mock.enqueue(
      { kind: "text", text: challengeAnswerJson([evidenceId!]) },
      { kind: "text", text: ADJUDICATION_JSON },
    );

    const res = await postChallengeRequest(
      record.matchId,
      challengeBody({ target: { turnId, claimText: "A opening." }, evidenceIds: [evidenceId!] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge?: { status?: string; adjudication?: { claimStatus?: string; method?: string } } };
    expect(body.challenge?.status).toBe("resolved");
    expect(body.challenge?.adjudication?.claimStatus).toBe("supported");
    expect(body.challenge?.adjudication?.method).toBe("judge_model");

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.terminal).toBe("completed");
    expect(stored?.verdict?.winner).toBe("A");
    expect(stored?.challenges).toHaveLength(1);
    expect(stored?.challenges?.[0]?.status).toBe("resolved");
    expect(stored?.evidenceEvents?.some((event) => event.type === "challenge-requested")).toBe(true);
    expect(stored?.evidenceEvents?.some((event) => event.type === "challenge-resolved")).toBe(true);
    // P0-3: the server-created claim is persisted in the canonical bundle and
    // linked from the challenge.
    const claimId = stored?.challenges?.[0]?.claimId;
    expect(claimId).toMatch(/^clm_/);
    expect(stored?.evidence?.claims.some((claim) => claim.id === claimId)).toBe(true);
    expect(
      stored?.evidence?.items.some((item) => item.claimIds.includes(claimId!)),
    ).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/apiKey|baseUrl|sk-test/i);
  });

  it("rejects legacy records without the challenged-side providerId with a safe 409 and no model calls", async () => {
    const record = await seedCompletedMatch("ch-legacy", false);
    const callsBefore = mock.requestCount;
    const res = await postChallengeRequest(record.matchId, challengeBody());
    expect(res.status).toBe(409);
    expect(mock.requestCount).toBe(callsBefore);
    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.challenges ?? []).toHaveLength(0);
  });

  it("rejects challenges on records with providerId but no evidence bundle (P0-3)", async () => {
    const record = await seedCompletedMatch("ch-noevidence", true);
    // Strip the evidence bundle: the claim cannot be persisted safely.
    const bare: MatchRecord = { ...record, evidence: undefined };
    await saveMatchRecord(bare);
    const callsBefore = mock.requestCount;
    const res = await postChallengeRequest(record.matchId, challengeBody());
    expect(res.status).toBe(409);
    expect(mock.requestCount).toBe(callsBefore);
    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.challenges ?? []).toHaveLength(0);
  });

  it("rejects invalid bodies with 400 before any model call", async () => {
    const record = await seedCompletedMatch("ch-bad", true);
    for (const body of [
      { version: 2, requestId: "req-1", target: { turnId: "t1", claimText: "A opening." }, evidenceIds: [] },
      { version: 1, requestId: "req-1", target: { turnId: "t1", claimText: "A opening." }, evidenceIds: [], status: "resolved" },
      { version: 1, requestId: "", target: { turnId: "t1", claimText: "A opening." }, evidenceIds: [] },
      { version: 1, requestId: "req-1", target: { turnId: "t1", claimText: "" }, evidenceIds: [] },
    ]) {
      const res = await postChallengeRequest(record.matchId, body);
      expect(res.status).toBe(400);
    }
    expect(mock.requestCount).toBe(0);
  });

  it("rejects unknown turns, non-excerpts, and unknown evidence refs with 409", async () => {
    const record = await seedCompletedMatch("ch-refs", true);
    const turnId = record.transcript[0]!.id;
    for (const body of [
      challengeBody({ target: { turnId: "missing-turn", claimText: "A opening." } }),
      challengeBody({ target: { turnId, claimText: "Not in the turn at all." } }),
      challengeBody({ evidenceIds: ["ev_ghost"] }),
    ]) {
      const res = await postChallengeRequest(record.matchId, body);
      expect(res.status).toBe(409);
    }
    expect(mock.requestCount).toBe(0);
  });

  it("accepts a challenge referencing stored evidence ids", async () => {
    const record = await seedCompletedMatch("ch-evref", true);
    const turnId = record.transcript[0]!.id;
    const evidenceId = record.evidence?.items[0]?.id;
    expect(evidenceId).toBeDefined();
    mock.enqueue(
      { kind: "text", text: challengeAnswerJson([evidenceId!]) },
      { kind: "text", text: ADJUDICATION_JSON },
    );
    const res = await postChallengeRequest(
      record.matchId,
      challengeBody({ requestId: "req-evref", target: { turnId, claimText: "A opening." }, evidenceIds: [evidenceId!] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge?: { evidenceIds?: string[]; status?: string } };
    expect(body.challenge?.evidenceIds).toEqual([evidenceId]);
    expect(body.challenge?.status).toBe("resolved");
  });

  it("is idempotent: a repeated requestId returns the stored challenge without model calls", async () => {
    const record = await seedCompletedMatch("ch-idem", true);
    const turnId = record.transcript[0]!.id;
    const evidenceId = record.evidence?.items[0]?.id;
    expect(evidenceId).toBeDefined();
    mock.enqueue(
      { kind: "text", text: challengeAnswerJson([evidenceId!]) },
      { kind: "text", text: ADJUDICATION_JSON },
    );
    const first = await postChallengeRequest(
      record.matchId,
      challengeBody({ target: { turnId, claimText: "A opening." }, evidenceIds: [evidenceId!] }),
    );
    expect(first.status).toBe(200);
    const callsAfterFirst = mock.requestCount;

    const second = await postChallengeRequest(record.matchId, challengeBody({ target: { turnId, claimText: "A opening." } }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { challenge?: { id?: string } };
    const firstBody = (await first.json()) as { challenge?: { id?: string } };
    expect(secondBody.challenge?.id).toBe(firstBody.challenge?.id);
    expect(mock.requestCount).toBe(callsAfterFirst);
  });

  it("serializes concurrent duplicate requestIds: only one set of model calls (P0-5)", async () => {
    const record = await seedCompletedMatch("ch-concurrent", true);
    const turnId = record.transcript[0]!.id;
    const evidenceId = record.evidence?.items[0]?.id;
    expect(evidenceId).toBeDefined();
    // Exactly one agent + one judge response for the single winner; a second
    // concurrent request must not consume any queued model response.
    mock.enqueue(
      { kind: "text", text: challengeAnswerJson([evidenceId!]) },
      { kind: "text", text: ADJUDICATION_JSON },
    );

    const body = challengeBody({ target: { turnId, claimText: "A opening." }, evidenceIds: [evidenceId!] });
    const [first, second] = await Promise.all([
      postChallengeRequest(record.matchId, body),
      postChallengeRequest(record.matchId, body),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { challenge?: { id?: string; status?: string } };
    const secondBody = (await second.json()) as { challenge?: { id?: string; status?: string } };
    // Both responses carry the SAME persisted challenge.
    expect(secondBody.challenge?.id).toBe(firstBody.challenge?.id);
    expect(firstBody.challenge?.status).toBe("resolved");

    // Exactly two model HTTP calls happened (one agent + one judge round;
    // the SDK may need an extra transport attempt, so bound it).
    expect(mock.requestCount).toBeLessThanOrEqual(4);

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.challenges).toHaveLength(1);
    expect(stored?.challenges?.[0]?.status).toBe("resolved");
  }, 30_000);

  it("enforces the one-active-challenge budget with 409", async () => {
    const record = await seedCompletedMatch("ch-active", true);
    const turnId = record.transcript[0]!.id;
    const evidenceId = record.evidence?.items[0]?.id;
    expect(evidenceId).toBeDefined();
    // Seed a nonterminal (active) challenge directly: with the per-record
    // lock serializing requests, a concurrent in-flight challenge is covered
    // by the concurrency test, so here we assert the budget check itself.
    const active: MatchRecord = {
      ...record,
      challenges: [
        {
          id: "chl_active",
          requestId: "req-inflight",
          matchId: record.matchId,
          status: "responding",
          side: "A",
          targetTurnId: record.transcript[1]!.id,
          targetClaimText: "B opening.",
          claimId: "clm_active",
          evidenceIds: [],
          createdAt: "2026-01-01T00:02:00.000Z",
          updatedAt: "2026-01-01T00:02:00.000Z",
        },
      ],
    };
    await saveMatchRecord(active);
    const callsBefore = mock.requestCount;
    const res = await postChallengeRequest(
      record.matchId,
      challengeBody({ requestId: "req-second", target: { turnId, claimText: "A opening." }, evidenceIds: [evidenceId!] }),
    );
    expect(res.status).toBe(409);
    expect(mock.requestCount).toBe(callsBefore);
  });

  it("persists a failed challenge on provider failure and preserves the original verdict/terminal", async () => {
    const record = await seedCompletedMatch("ch-fail", true);
    const turnId = record.transcript[0]!.id;
    // The SDK retries transient 5xx; enqueue enough error responses.
    mock.enqueue(
      { kind: "error", status: 500, message: "upstream boom" },
      { kind: "error", status: 500, message: "upstream boom" },
      { kind: "error", status: 500, message: "upstream boom" },
      { kind: "error", status: 500, message: "upstream boom" },
      { kind: "error", status: 500, message: "upstream boom" },
      { kind: "error", status: 500, message: "upstream boom" },
    );
    const res = await postChallengeRequest(record.matchId, challengeBody({ target: { turnId, claimText: "A opening." } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge?: { status?: string; failureReason?: string } };
    expect(body.challenge?.status).toBe("failed");
    expect(typeof body.challenge?.failureReason).toBe("string");

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.terminal).toBe("completed");
    expect(stored?.verdict?.winner).toBe("A");
    expect(stored?.challenges?.[0]?.status).toBe("failed");
    expect(stored?.evidenceEvents?.some((event) => event.type === "challenge-failed")).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/apiKey|baseUrl|sk-test/i);
  }, 30_000);

  it("rejects challenges against non-completed records with 409", async () => {
    const record = await seedCompletedMatch("ch-error", true);
    const broken: MatchRecord = { ...record, terminal: "error", terminalReason: "boom", verdict: null };
    await saveMatchRecord(broken);
    const res = await postChallengeRequest(record.matchId, challengeBody());
    expect(res.status).toBe(409);
  });

  it("returns 404 for unknown matches and 400 for malformed JSON", async () => {
    expect((await postChallengeRequest("does-not-exist", challengeBody())).status).toBe(404);
    const record = await seedCompletedMatch("ch-json", true);
    const res = await postChallenge(
      new Request(`http://localhost/api/matches/${record.matchId}/challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
      { params: Promise.resolve({ id: record.matchId }) },
    );
    expect(res.status).toBe(400);
  });
});
