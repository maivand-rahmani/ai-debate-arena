/**
 * Focused tests for `POST /api/matches/[id]/sources` (opt-in external source
 * flow backend, F10-09).
 *
 * The consent-gated fetch host itself is fully covered by
 * `shared/server/source-fetch.test.ts` (injected DNS/dispatchers, no real
 * sockets); these route tests MOCK that boundary (`fetchSourceCapture`) and
 * exercise everything around it for real: strict input validation,
 * server-owned manifest/consent issuance, the pure ingest merge, atomic
 * persistence, idempotency, safe failures, and leak-freedom. No test opens a
 * socket, and no model/provider calls exist on this path.
 */

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchRecord } from "@arena/debate-engine";
import { loadMatchRecord, saveMatchRecord } from "../../../../../shared/config/match-store";
import { fetchSourceCapture } from "../../../../../shared/server/source-fetch";
import type { SourceFetchResult } from "../../../../../shared/server/source-fetch";
import { POST as postSource } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("../../../../../shared/server/source-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../shared/server/source-fetch")>();
  return { ...actual, fetchSourceCapture: vi.fn() };
});

const fetchMock = vi.mocked(fetchSourceCapture);

const REFERENCE = "https://example.com/report-2026";
const CAPTURE_CONTENT = "# Quarterly report\n\nSolar module prices fell sharply in 2026.";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function baseRecord(matchId: string): MatchRecord {
  return {
    version: 1,
    matchId,
    startedAt: "2026-09-11T00:00:00.000Z",
    finishedAt: "2026-09-11T00:01:00.000Z",
    topic: "Should AI be regulated?",
    mode: "quick",
    sides: {
      A: { providerName: "Provider A", modelId: "model-a", position: "FOR" },
      B: { providerName: "Provider B", modelId: "model-b", position: "AGAINST" },
    },
    policy: {
      mode: "quick",
      enabled: true,
      rounds: 1,
      agentMaxOutputTokens: 1024,
      judgeMaxOutputTokens: 1024,
      historyTurns: 2,
      maxContextCharsPerSide: 4000,
    },
    promptVersions: { agent: "agent-v1", judge: "judge-v1" },
    rubricVersion: "rubric-v1",
    transcript: [],
    verdict: null,
    terminal: "completed",
    terminalReason: null,
    metrics: { turnsMs: [], totalMs: 1000 },
    challenges: [],
    evidenceEvents: [],
    sourceAudits: [],
  };
}

function okCapture(reference: string = REFERENCE): SourceFetchResult {
  return {
    ok: true,
    capture: {
      reference,
      contentType: "text/markdown",
      content: CAPTURE_CONTENT,
      contentBytes: Buffer.byteLength(CAPTURE_CONTENT, "utf8"),
      contentHash: createHash("sha256").update(CAPTURE_CONTENT, "utf8").digest("hex"),
    },
    metadata: {},
    redirects: 0,
    httpStatus: 200,
  };
}

function failCapture(reason: string): SourceFetchResult {
  return { ok: false, reason: reason as Extract<SourceFetchResult, { ok: false }>["reason"] };
}

function sourceBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    requestId: "src-req-1",
    adapterId: "srcadp_https",
    adapterVersion: "1.0.0",
    reference: REFERENCE,
    label: "Quarterly report",
    freshness: { mode: "snapshot-only", maxAgeSeconds: 86400 },
    confirm: true,
    ...overrides,
  };
}

function postSourceRequest(matchId: string, body: unknown): Promise<Response> {
  return postSource(
    new Request(`http://localhost/api/matches/${matchId}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: matchId }) },
  );
}

function postRaw(matchId: string, body: string): Promise<Response> {
  return postSource(
    new Request(`http://localhost/api/matches/${matchId}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id: matchId }) },
  );
}

let dir = "";
const ORIGINAL_DIR = process.env.AI_DEBATE_ARENA_MATCH_DIR;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-debate-arena-source-"));
  process.env.AI_DEBATE_ARENA_MATCH_DIR = dir;
  fetchMock.mockReset();
});

afterEach(async () => {
  if (ORIGINAL_DIR === undefined) delete process.env.AI_DEBATE_ARENA_MATCH_DIR;
  else process.env.AI_DEBATE_ARENA_MATCH_DIR = ORIGINAL_DIR;
  await rm(dir, { recursive: true, force: true });
});

async function seed(record: MatchRecord): Promise<MatchRecord> {
  await saveMatchRecord(record);
  return record;
}

interface SourceResponseBody {
  sourceSnapshot?: {
    requestId?: string | null;
    id?: string;
    adapterId?: string;
    adapterVersion?: string;
    reference?: string;
    label?: string | null;
    freshness?: string;
    contentType?: string;
    contentBytes?: number;
    contentHash?: string;
    capturedAt?: string;
  };
  evidence?: { id?: string | null };
  error?: string;
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* Explicit consent / success path                                     */
/* ------------------------------------------------------------------ */

describe("POST /api/matches/[id]/sources", () => {
  it("captures with an explicit server-issued consent and persists evidence, audit, and events atomically", async () => {
    const record = await seed(baseRecord("src-ok"));
    fetchMock.mockResolvedValue(okCapture());

    const res = await postSourceRequest(record.matchId, sourceBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as SourceResponseBody;
    expect(body.sourceSnapshot?.id).toMatch(/^srcsnap_/);
    expect(body.sourceSnapshot?.adapterId).toBe("srcadp_https");
    expect(body.sourceSnapshot?.freshness).toBe("snapshot-only");
    expect(body.evidence?.id).toMatch(/^ev_/);
    // The captured content is never echoed in the response.
    expect(JSON.stringify(body)).not.toContain(CAPTURE_CONTENT);

    // Exactly one consent-gated fetch, with a server-issued consent bound to
    // this match/request/adapter/version/reference and a server-derived
    // net.fetch grant. The client supplied none of these.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]?.[0];
    expect(call?.matchId).toBe(record.matchId);
    expect(call?.requestId).toBe("src-req-1");
    expect(call?.reference).toBe(REFERENCE);
    expect(call?.grantedPermissions).toEqual({ "net.fetch": true });
    expect(call?.manifest).toMatchObject({ adapterId: "srcadp_https", version: "1.0.0" });
    const consent = call?.consent as Record<string, unknown>;
    expect(consent["consentId"]).toMatch(/^sconsent_/);
    expect(consent["matchId"]).toBe(record.matchId);
    expect(consent["requestId"]).toBe("src-req-1");
    expect(consent["adapterId"]).toBe("srcadp_https");
    expect(consent["adapterVersion"]).toBe("1.0.0");
    expect(consent["reference"]).toBe(REFERENCE);
    expect(consent["granted"]).toBe(true);
    expect(consent["confirmedByUserAction"]).toBe(true);

    const stored = await loadMatchRecord(record.matchId);
    expect(stored).toBeDefined();
    // Original verdict/terminal state and challenge list are untouched.
    expect(stored?.terminal).toBe("completed");
    expect(stored?.verdict).toBeNull();
    expect(stored?.challenges).toEqual([]);
    // The bundle holds the immutable hash-pinned snapshot + evidence item.
    const snapshot = stored?.evidence?.sourceSnapshots?.[0];
    expect(snapshot?.id).toBe(body.sourceSnapshot?.id);
    expect(snapshot?.adapterId).toBe("srcadp_https");
    expect(snapshot?.reference).toBe(REFERENCE);
    expect(snapshot?.freshness).toEqual({ mode: "snapshot-only", maxAgeSeconds: 86400 });
    expect(snapshot?.freshUntil).toBeNull();
    expect(snapshot?.metadata?.["requestId"]).toBe("src-req-1");
    expect(snapshot?.metadata?.["label"]).toBe("Quarterly report");
    expect(snapshot?.contentHash).toBe(createHash("sha256").update(CAPTURE_CONTENT, "utf8").digest("hex"));
    const item = stored?.evidence?.items?.find(
      (entry) => entry.provenance.sourceSnapshotId === snapshot?.id,
    );
    expect(item?.status).toBe("unverified");
    expect(item?.provenance.kind).toBe("external-source");
    // A granted source audit with the single-use consent id, safe detail only.
    const audit = stored?.sourceAudits?.[0];
    expect(audit?.outcome).toBe("granted");
    expect(audit?.sourceSnapshotId).toBe(snapshot?.id);
    expect(audit?.consentId).toBe(consent["consentId"]);
    expect(audit?.detail).toBe("requestId:src-req-1");
    // Safe lifecycle events (ids/enums only).
    const events = stored?.evidenceEvents ?? [];
    expect(events.some((entry) => entry.type === "source-snapshot-captured")).toBe(true);
    expect(events.some((entry) => entry.type === "source-evidence-added")).toBe(true);
    // No capability grants or full consent records are persisted anywhere —
    // only the audit's bounded consentId linkage.
    const storedJson = JSON.stringify(stored);
    expect(storedJson).not.toContain("grantedCapabilities");
    expect(storedJson).not.toContain("requestedCapabilities");
    expect(storedJson).not.toContain("confirmedByUserAction");
    expect(storedJson).not.toContain("expiresAt");
  });

  it("works on legacy records without an evidence bundle (bundle initialized)", async () => {
    const legacy = baseRecord("src-legacy");
    const { evidence: _evidence, challenges: _challenges, evidenceEvents: _events, sourceAudits: _audits, ...bare } = legacy;
    await seed(bare as MatchRecord);
    fetchMock.mockResolvedValue(okCapture());

    const res = await postSourceRequest("src-legacy", sourceBody());
    expect(res.status).toBe(200);

    const stored = await loadMatchRecord("src-legacy");
    expect(stored?.evidence?.sourceSnapshots).toHaveLength(1);
    expect(stored?.evidence?.items).toHaveLength(1);
    expect(stored?.sourceAudits).toHaveLength(1);
    expect(stored?.terminal).toBe("completed");
  });

  it("rejects non-completed matches without touching the network", async () => {
    await seed({ ...baseRecord("src-cancelled"), terminal: "cancelled", terminalReason: "cancelled" });
    fetchMock.mockResolvedValue(okCapture());

    const res = await postSourceRequest("src-cancelled", sourceBody());
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    const stored = await loadMatchRecord("src-cancelled");
    expect(stored?.sourceAudits ?? []).toHaveLength(0);
    expect(stored?.evidence ?? undefined).toBeUndefined();
  });

  it("returns 404 for unknown matches and malformed match ids", async () => {
    fetchMock.mockResolvedValue(okCapture());
    expect((await postSourceRequest("does-not-exist", sourceBody())).status).toBe(404);
    expect((await postSourceRequest("../escape", sourceBody())).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------- */
  /* Malformed / unknown fields                                        */
  /* ---------------------------------------------------------------- */

  it("rejects malformed, missing, and client-forbidden fields with 400 and persists nothing", async () => {
    const record = await seed(baseRecord("src-bad"));
    fetchMock.mockResolvedValue(okCapture());

    const invalid: readonly Record<string, unknown>[] = [
      { ...sourceBody(), version: 2 },
      { ...sourceBody(), requestId: "" },
      { ...sourceBody(), requestId: "bad id!" },
      { ...sourceBody(), requestId: "x".repeat(129) },
      { ...sourceBody(), adapterId: "srcadp_other" },
      { ...sourceBody(), adapterVersion: "9.9.9" },
      { ...sourceBody(), reference: "http://example.com/report" },
      { ...sourceBody(), reference: "https://127.0.0.1/report" },
      { ...sourceBody(), reference: "https://localhost/report" },
      { ...sourceBody(), reference: "https://user:pass@example.com/report" },
      { ...sourceBody(), label: "bad\nlabel" },
      { ...sourceBody(), label: "x".repeat(129) },
      { ...sourceBody(), freshness: "snapshot-only" },
      { ...sourceBody(), freshness: { mode: "reuse-if-fresh", maxAgeSeconds: 86400 } },
      { ...sourceBody(), freshness: { mode: "snapshot-only", maxAgeSeconds: 1 } },
      { ...sourceBody(), confirm: false },
      { ...sourceBody({ confirm: undefined }) },
      // Client-forbidden decision/capability/consent/content fields:
      { ...sourceBody(), manifest: { schemaVersion: 1, adapterId: "srcadp_https" } },
      { ...sourceBody(), requestedCapabilities: { "net.fetch": true } },
      { ...sourceBody(), grantedCapabilities: { "net.fetch": true } },
      { ...sourceBody(), consent: { consentId: "sconsent_forged" } },
      { ...sourceBody(), consentId: "sconsent_forged" },
      { ...sourceBody(), headers: { authorization: "Bearer x" } },
      { ...sourceBody(), content: "forged capture" },
      { ...sourceBody(), contentHash: "0".repeat(64) },
      { ...sourceBody(), providerId: "p1" },
      { ...sourceBody(), decision: "allow" },
    ];
    for (const body of invalid) {
      const res = await postSourceRequest(record.matchId, body);
      if (res.status !== 400) {
        throw new Error(`expected 400 for body: ${JSON.stringify(body)} (got ${res.status})`);
      }
      expect(res.status).toBe(400);
    }

    expect(fetchMock).not.toHaveBeenCalled();
    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.sourceAudits ?? []).toHaveLength(0);
    expect(stored?.evidence ?? undefined).toBeUndefined();
    expect(stored?.evidenceEvents ?? []).toHaveLength(0);
  });

  it("rejects oversized bodies and malformed JSON with 400 before any processing", async () => {
    const record = await seed(baseRecord("src-oversize"));
    fetchMock.mockResolvedValue(okCapture());
    expect(
      (
        await postRaw(
          record.matchId,
          JSON.stringify({ ...sourceBody(), padding: "x".repeat(70 * 1024) }),
        )
      ).status,
    ).toBe(400);
    expect((await postRaw(record.matchId, "{not-json")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------- */
  /* Idempotency + consent replay                                      */
  /* ---------------------------------------------------------------- */

  it("is idempotent: a repeated requestId returns the stored result without refetching", async () => {
    const record = await seed(baseRecord("src-idem"));
    fetchMock.mockResolvedValue(okCapture());

    const first = await postSourceRequest(record.matchId, sourceBody());
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as SourceResponseBody;

    const second = await postSourceRequest(record.matchId, sourceBody());
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as SourceResponseBody;
    expect(secondBody.sourceSnapshot?.id).toBe(firstBody.sourceSnapshot?.id);
    expect(secondBody.evidence?.id).toBe(firstBody.evidence?.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence?.sourceSnapshots).toHaveLength(1);
    expect(stored?.sourceAudits).toHaveLength(1);
    expect((stored?.evidenceEvents ?? []).filter((entry) => entry.type === "source-snapshot-captured")).toHaveLength(1);
  });

  it("safely returns the stored source result when a requestId is replayed against a different reference (no refetch)", async () => {
    const record = await seed(baseRecord("src-replay"));
    fetchMock.mockResolvedValue(okCapture());
    const first = await postSourceRequest(record.matchId, sourceBody());
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as SourceResponseBody;

    const replay = await postSourceRequest(
      record.matchId,
      sourceBody({ reference: "https://example.com/other-report" }),
    );
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as SourceResponseBody;
    expect(replayBody.sourceSnapshot?.id).toBe(firstBody.sourceSnapshot?.id);
    expect(replayBody.sourceSnapshot?.reference).toBe(REFERENCE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a duplicate (adapter, reference) capture under a new requestId with a safe 409", async () => {
    const record = await seed(baseRecord("src-dup"));
    fetchMock.mockResolvedValue(okCapture());
    expect((await postSourceRequest(record.matchId, sourceBody({ requestId: "src-req-1" }))).status).toBe(200);

    const dup = await postSourceRequest(record.matchId, sourceBody({ requestId: "src-req-2" }));
    expect(dup.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence?.sourceSnapshots).toHaveLength(1);
    expect(stored?.sourceAudits).toHaveLength(1);
  });

  it("serializes concurrent duplicate requestIds under the record lock: exactly one capture", async () => {
    const record = await seed(baseRecord("src-concurrent"));
    fetchMock.mockResolvedValue(okCapture());
    const [first, second] = await Promise.all([
      postSourceRequest(record.matchId, sourceBody()),
      postSourceRequest(record.matchId, sourceBody()),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as SourceResponseBody;
    const secondBody = (await second.json()) as SourceResponseBody;
    expect(secondBody.sourceSnapshot?.id).toBe(firstBody.sourceSnapshot?.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence?.sourceSnapshots).toHaveLength(1);
    expect(stored?.sourceAudits).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- */
  /* Safe failures                                                     */
  /* ---------------------------------------------------------------- */

  it("persists a safe failed audit and returns only a reason code on capture failure", async () => {
    const record = await seed(baseRecord("src-fail"));
    fetchMock.mockResolvedValue(failCapture("status-not-ok"));

    const res = await postSourceRequest(record.matchId, sourceBody());
    expect(res.status).toBe(502);
    const body = (await res.json()) as SourceResponseBody;
    expect(body.reason).toBe("status-not-ok");
    // No raw URL, IP, or network error text in the response.
    expect(JSON.stringify(body)).not.toContain("example.com");
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.sourceAudits).toHaveLength(1);
    expect(stored?.sourceAudits?.[0]?.outcome).toBe("failed");
    expect(stored?.sourceAudits?.[0]?.detail).toBe("status-not-ok");
    expect(stored?.evidence ?? undefined).toBeUndefined();
    expect(stored?.evidenceEvents ?? []).toHaveLength(0);
    expect(stored?.terminal).toBe("completed");
    expect(JSON.stringify(stored)).not.toContain(CAPTURE_CONTENT);
  });

  it("maps timeout failures to 408 and body-too-large to 413 with safe audits", async () => {
    const record = await seed(baseRecord("src-timeout"));
    fetchMock.mockResolvedValue(failCapture("timeout"));
    const timeoutRes = await postSourceRequest(record.matchId, sourceBody({ requestId: "r1" }));
    expect(timeoutRes.status).toBe(408);

    fetchMock.mockResolvedValue(failCapture("body-too-large"));
    const largeRes = await postSourceRequest(record.matchId, sourceBody({ requestId: "r2" }));
    expect(largeRes.status).toBe(413);

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.sourceAudits).toHaveLength(2);
    expect(stored?.sourceAudits?.every((audit) => audit.outcome === "failed")).toBe(true);
  });

  it("persists a denied audit and a safe source-access-denied event for gate failures", async () => {
    const record = await seed(baseRecord("src-denied"));
    fetchMock.mockResolvedValue(failCapture("consent-expired"));

    const res = await postSourceRequest(record.matchId, sourceBody());
    expect(res.status).toBe(403);
    const body = (await res.json()) as SourceResponseBody;
    expect(body.reason).toBe("consent-expired");

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.sourceAudits?.[0]?.outcome).toBe("expired");
    const event = (stored?.evidenceEvents ?? []).find((entry) => entry.type === "source-access-denied");
    expect(event).toBeDefined();
    expect(event?.adapterId).toBe("srcadp_https");
    expect(event?.reason).toBe("consent-expired");
    expect(JSON.stringify(stored)).not.toContain("example.com");
  });

  it("never leaks raw errors when the fetch host throws unexpectedly", async () => {
    const record = await seed(baseRecord("src-throw"));
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED 10.1.2.3 raw socket details"));

    const res = await postSourceRequest(record.matchId, sourceBody());
    expect(res.status).toBe(502);
    const body = (await res.json()) as SourceResponseBody;
    expect(body.reason).toBe("capture-failed");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(body)).not.toContain("10.1.2.3");

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.sourceAudits?.[0]?.outcome).toBe("failed");
    expect(stored?.sourceAudits?.[0]?.detail).toBe("capture-failed");
    expect(JSON.stringify(stored)).not.toContain("ECONNREFUSED");
  });

  it("rejects a tampered capture at the pure ingest boundary and persists only safe codes", async () => {
    const record = await seed(baseRecord("src-tamper"));
    const bad = okCapture();
    if (!bad.ok) throw new Error("unreachable");
    fetchMock.mockResolvedValue({
      ...bad,
      capture: { ...bad.capture, contentHash: "0".repeat(64) },
    });

    const res = await postSourceRequest(record.matchId, sourceBody());
    expect(res.status).toBe(409);
    const body = (await res.json()) as SourceResponseBody;
    expect(body.error).toBe("source-capture-rejected");
    // The raw ingest rejection reason (hash details) is never exposed.
    expect(JSON.stringify(body)).not.toContain("hash");

    const stored = await loadMatchRecord(record.matchId);
    expect(stored?.evidence?.sourceSnapshots ?? []).toHaveLength(0);
    expect(stored?.sourceAudits?.[0]?.outcome).toBe("failed");
    expect(stored?.sourceAudits?.[0]?.detail).toBe("ingest-rejected");
  });

  /* ---------------------------------------------------------------- */
  /* No automatic refresh / no GET surface                             */
  /* ---------------------------------------------------------------- */

  it("has no GET handler and never refetches stored results (no automatic refresh)", async () => {
    const route = await import("./route");
    expect((route as Record<string, unknown>).GET).toBeUndefined();
    expect((route as Record<string, unknown>).PUT).toBeUndefined();

    const record = await seed(baseRecord("src-noauto"));
    fetchMock.mockResolvedValue(okCapture());
    expect((await postSourceRequest(record.matchId, sourceBody())).status).toBe(200);
    // Replays and duplicate-reference attempts never open a second socket.
    await postSourceRequest(record.matchId, sourceBody());
    await postSourceRequest(record.matchId, sourceBody({ requestId: "src-req-2" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
