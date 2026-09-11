/**
 * Tests for `POST /api/matches/[id]/proofs` (bounded content-integrity proof,
 * F10-16/F10-18).
 *
 * Records are seeded through the real `runDebate` (injected model calls, no
 * HTTP) into a temp match dir. The proof path is pure: no model/provider
 * calls exist, and the mock provider stays untouched throughout.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { MatchRecord } from "@arena/debate-engine";
import { runDebate, normalizeUserEvidencePacket } from "@arena/debate-engine";
import { getProvider } from "../../../../../shared/config/provider-store";
import { loadMatchRecord, saveMatchRecord } from "../../../../../shared/config/match-store";
import { POST as postProof } from "./route";
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
  dir = await mkdtemp(join(tmpdir(), "ai-debate-arena-proof-"));
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

/** Seeds a completed match with a one-item user evidence bundle. */
async function seedCompletedMatch(matchId: string, withEvidence: boolean): Promise<MatchRecord> {
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
    },
  );
  for await (const event of events) {
    void event;
  }
  let record = saved[0]!;
  expect(record.terminal).toBe("completed");
  if (withEvidence) {
    const evidence = normalizeUserEvidencePacket({
      version: 1,
      items: [{ source: "user_text", label: "notes", content: "Solar module prices fell sharply." }],
    });
    if (!evidence.success) throw new Error("fixture evidence failed");
    record = { ...record, evidence: evidence.data };
  }
  await saveMatchRecord(record);
  return record;
}

function postProofRequest(matchId: string, body: unknown): Promise<Response> {
  return postProof(
    new Request(`http://localhost/api/matches/${matchId}/proofs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: matchId }) },
  );
}

function proofBody(evidenceId: string): { version: 1; evidenceId: string } {
  return { version: 1, evidenceId };
}

describe("POST /api/matches/[id]/proofs", () => {
  it("runs a verified proof, persists it with a safe event, and preserves the record", async () => {
    const record = await seedCompletedMatch("pr-ok", true);
    const evidenceId = record.evidence?.items[0]?.id;
    expect(evidenceId).toBeDefined();

    const res = await postProofRequest(record.matchId, proofBody(evidenceId!));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      proof?: { evidenceId?: string; status?: string; adapterId?: string; algorithm?: string };
    };
    expect(body.proof?.evidenceId).toBe(evidenceId);
    expect(body.proof?.status).toBe("verified");
    expect(body.proof?.adapterId).toBe("sbadp_content-hash");
    expect(body.proof?.algorithm).toBe("sha256");

    const stored = await loadMatchRecord(record.matchId);
    // Original verdict and terminal state are untouched.
    expect(stored?.terminal).toBe("completed");
    expect(stored?.verdict?.winner).toBe("A");
    expect(stored?.challenges ?? []).toHaveLength(0);
    // The proof is persisted in the canonical bundle.
    expect(stored?.evidence?.proofs).toHaveLength(1);
    expect(stored?.evidence?.proofs[0]?.evidenceId).toBe(evidenceId);
    expect(stored?.evidence?.proofs[0]?.status).toBe("verified");
    expect(stored?.evidence?.proofs[0]?.adapterId).toBe("sbadp_content-hash");
    // A safe proof-recorded event was appended.
    const event = stored?.evidenceEvents?.find((entry) => entry.type === "proof-recorded");
    expect(event).toBeDefined();
    expect(event?.evidenceId).toBe(evidenceId);
    expect(event?.status).toBe("verified");
    // Evidence items, snapshots, audits are preserved.
    expect(stored?.evidence?.items).toEqual(record.evidence?.items);
    expect(stored?.evidence?.sourceSnapshots).toEqual(record.evidence?.sourceSnapshots);
    expect(JSON.stringify(stored)).not.toMatch(/apiKey|baseUrl|sk-test/i);
  });

  it("returns the exact hash result fields for a verified proof", async () => {
    const record = await seedCompletedMatch("pr-hash", true);
    const item = record.evidence?.items[0];
    if (!item) throw new Error("fixture evidence item missing");
    const res = await postProofRequest(record.matchId, proofBody(item.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      proof?: { status?: string; data?: { details?: Record<string, string | number> } };
    };
    expect(body.proof?.status).toBe("verified");
    const details = body.proof?.data?.details ?? {};
    expect(details["algorithm"]).toBe("sha256");
    expect(details["adapterId"]).toBe("sbadp_content-hash");
    expect(details["contentBytes"]).toBe(Buffer.byteLength(item.text, "utf8"));
  });

  it("persists a failed proof for hash-mismatched evidence without altering the item", async () => {
    const record = await seedCompletedMatch("pr-mismatch", true);
    const item = record.evidence?.items[0];
    if (!item) throw new Error("fixture evidence item missing");
    // Tamper with the declared content hash: the recomputed hash will differ.
    const tampered: MatchRecord = {
      ...record,
      evidence: {
        ...record.evidence!,
        items: record.evidence!.items.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                provenance: {
                  ...entry.provenance,
                  contentHash: "0".repeat(64),
                },
              }
            : entry,
        ),
      },
    };
    await saveMatchRecord(tampered);

    const res = await postProofRequest(record.matchId, proofBody(item.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proof?: { status?: string } };
    expect(body.proof?.status).toBe("failed");

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence?.proofs).toHaveLength(1);
    expect(stored?.evidence?.proofs[0]?.status).toBe("failed");
    // EvidenceItem.status is NEVER mutated by a proof.
    expect(stored?.evidence?.items[0]?.status).toBe(item.status);
    expect(stored?.terminal).toBe("completed");
    expect(stored?.evidenceEvents?.some((event) => event.type === "proof-recorded" && event.status === "failed")).toBe(true);
    // Raw content is never echoed in proof data.
    expect(JSON.stringify(stored?.evidence?.proofs)).not.toContain(item.text);
  });

  it("returns a safe 409 for legacy records without an evidence bundle", async () => {
    const record = await seedCompletedMatch("pr-legacy", false);
    const res = await postProofRequest(record.matchId, proofBody("ev_whatever"));
    expect(res.status).toBe(409);
    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence ?? undefined).toBeUndefined();
    expect(stored?.evidenceEvents?.some((event) => event.type === "proof-recorded")).toBe(false);
  });

  it("rejects unknown evidence references with 409 and persists nothing", async () => {
    const record = await seedCompletedMatch("pr-unknown", true);
    const res = await postProofRequest(record.matchId, proofBody("ev_ghost"));
    expect(res.status).toBe(409);
    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence?.proofs ?? []).toHaveLength(0);
    expect(stored?.evidenceEvents?.some((event) => event.type === "proof-recorded")).toBe(false);
  });

  it("rejects empty and malformed evidenceIds with 400 before loading the record", async () => {
    const record = await seedCompletedMatch("pr-malformed", true);
    for (const body of [
      { version: 1, evidenceId: "" },
      { version: 1, evidenceId: "has space" },
      { version: 1, evidenceId: { nested: true } },
      { evidenceId: "ev_x" },
      { version: 2, evidenceId: "ev_x" },
    ]) {
      const res = await postProofRequest(record.matchId, body);
      expect(res.status).toBe(400);
    }
    // Unknown fields are rejected, never stripped.
    const extra = await postProofRequest(record.matchId, {
      version: 1,
      evidenceId: record.evidence?.items[0]?.id,
      status: "verified",
      contentHash: "0".repeat(64),
      adapterId: "sbadp_content-hash",
    });
    expect(extra.status).toBe(400);
    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence?.proofs ?? []).toHaveLength(0);
  });

  it("rejects oversized bodies with 400 before parsing", async () => {
    const record = await seedCompletedMatch("pr-oversized", true);
    const res = await postProof(
      new Request(`http://localhost/api/matches/${record.matchId}/proofs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 1, evidenceId: "ev_x", padding: "x".repeat(70 * 1024) }),
      }),
      { params: Promise.resolve({ id: record.matchId }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const record = await seedCompletedMatch("pr-json", true);
    const res = await postProof(
      new Request(`http://localhost/api/matches/${record.matchId}/proofs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
      { params: Promise.resolve({ id: record.matchId }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown matches", async () => {
    const res = await postProofRequest("does-not-exist", proofBody("ev_x"));
    expect(res.status).toBe(404);
  });

  it("is idempotent: a repeated proof returns the stored result without duplicates", async () => {
    const record = await seedCompletedMatch("pr-idem", true);
    const evidenceId = record.evidence?.items[0]?.id;
    if (!evidenceId) throw new Error("fixture evidence item missing");
    const first = await postProofRequest(record.matchId, proofBody(evidenceId));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { proof?: { status?: string; verifiedAt?: string } };

    const second = await postProofRequest(record.matchId, proofBody(evidenceId));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { proof?: { status?: string; verifiedAt?: string } };
    expect(secondBody.proof?.verifiedAt).toBe(firstBody.proof?.verifiedAt);
    expect(secondBody.proof?.status).toBe(firstBody.proof?.status);

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence?.proofs).toHaveLength(1);
    // Only one proof-recorded event despite two requests.
    const events = (stored?.evidenceEvents ?? []).filter((event) => event.type === "proof-recorded");
    expect(events).toHaveLength(1);
  });

  it("serializes concurrent duplicate proofs under the record lock: exactly one persisted proof", async () => {
    const record = await seedCompletedMatch("pr-concurrent", true);
    const evidenceId = record.evidence?.items[0]?.id;
    if (!evidenceId) throw new Error("fixture evidence item missing");
    const body = proofBody(evidenceId);
    const [first, second] = await Promise.all([
      postProofRequest(record.matchId, body),
      postProofRequest(record.matchId, body),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { proof?: { verifiedAt?: string } };
    const secondBody = (await second.json()) as { proof?: { verifiedAt?: string } };
    expect(secondBody.proof?.verifiedAt).toBe(firstBody.proof?.verifiedAt);

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence?.proofs).toHaveLength(1);
    const events = (stored?.evidenceEvents ?? []).filter((event) => event.type === "proof-recorded");
    expect(events).toHaveLength(1);
  });

  it("persists proofs atomically: bundle update and event land together or not at all", async () => {
    const record = await seedCompletedMatch("pr-atomic", true);
    const evidenceId = record.evidence?.items[0]?.id;
    if (!evidenceId) throw new Error("fixture evidence item missing");
    // Point the match dir at an unwritable location is invasive; instead
    // verify the single-persist property structurally: after success, the
    // persisted record contains BOTH the proof and its event.
    const res = await postProofRequest(record.matchId, proofBody(evidenceId));
    expect(res.status).toBe(200);
    const stored = await loadMatchRecord(record.matchId);
    const hasProof = (stored?.evidence?.proofs ?? []).length === 1;
    const hasEvent = (stored?.evidenceEvents ?? []).some((event) => event.type === "proof-recorded");
    expect(hasProof).toBe(true);
    expect(hasEvent).toBe(true);
  });

  it("keeps a verified proof reproducible: the recomputed hash matches the stored content hash", async () => {
    const record = await seedCompletedMatch("pr-determinism", true);
    const item = record.evidence?.items[0];
    if (!item) throw new Error("fixture evidence item missing");
    expect(createHash("sha256").update(item.text, "utf8").digest("hex")).toBe(item.provenance.contentHash);
    const res = await postProofRequest(record.matchId, proofBody(item.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proof?: { status?: string } };
    expect(body.proof?.status).toBe("verified");
  });
});
