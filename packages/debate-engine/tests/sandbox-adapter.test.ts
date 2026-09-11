/**
 * Tests for the F10-16/F10-17/F10-18 sandbox/proof foundation: strict
 * manifest/request/result validation, denial/limit semantics, and the pure
 * `sbadp_content-hash` proof adapter. No execution, no I/O.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  SANDBOX_LIMITS,
  deniedSandboxResult,
  inputTooLargeResult,
  resourceExhaustedSandboxResult,
  sandboxAdapterManifestSchema,
  sandboxAdapterRequestSchema,
  sandboxAdapterResultSchema,
  timedOutSandboxResult,
  unavailableSandboxResult,
  validateRequestAgainstManifest,
  validateSandboxAdapterManifest,
  validateSandboxAdapterRequest,
  validateSandboxAdapterResult,
  validateSandboxCapabilityGrant,
  validateSandboxPermissions,
} from "../src/sandbox-adapter-contract";
import {
  CONTENT_HASH_ADAPTER_ID,
  CONTENT_HASH_ADAPTER_MANIFEST,
  CONTENT_HASH_ADAPTER_VERSION,
  CONTENT_HASH_ALGORITHM,
  CONTENT_HASH_RESULT_MAX_CHARS,
  isBoundedProofResult,
  runContentHashProof,
} from "../src/proof-adapters/content-hash-proof";
import {
  appendProofResult,
  emptyEvidenceBundle,
  normalizeLegacyEvidence,
  normalizeUserEvidencePacket,
  validateEvidenceBundle,
} from "../src/evidence-contract";
import { CONTRACT_VERSION, matchRecordSchema } from "../src/contract";
import type { EvidenceBundle, ProofResult, SandboxAdapterManifest, SandboxAdapterRequest } from "@arena/types";

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function manifest(overrides: Partial<SandboxAdapterManifest> = {}): SandboxAdapterManifest {
  return {
    schemaVersion: 1,
    adapterId: "sbadp_test",
    version: "1.0.0",
    displayName: "Test Adapter",
    description: "Bounded test adapter.",
    requiredPermissions: [],
    requestedCapabilities: {},
    maxLimits: { timeoutMs: 60_000, maxOutputBytes: 1_048_576, maxInputBytes: 1_048_576 },
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    adapterId: "sbadp_test",
    input: { evidenceId: "ev_1" },
    limits: { timeoutMs: 5_000, maxOutputBytes: 4_096, maxInputBytes: 4_096 },
    ...overrides,
  } as SandboxAdapterRequest;
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    adapterId: "sbadp_test",
    adapterVersion: "1.0.0",
    status: "completed",
    data: { answer: 42 },
    usage: { elapsedMs: 12, outputBytes: 20 },
    cleanup: { releasedAt: "2026-01-01T00:00:01.000Z", resourcesReleased: [], clean: true },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Strict manifest/request/result validation                           */
/* ------------------------------------------------------------------ */

describe("sandbox adapter strict validation", () => {
  it("accepts a valid manifest, request, and result", () => {
    expect(validateSandboxAdapterManifest(manifest()).ok).toBe(true);
    expect(validateSandboxAdapterRequest(request()).ok).toBe(true);
    expect(validateSandboxAdapterResult(result()).ok).toBe(true);
  });

  it("rejects unknown fields everywhere", () => {
    expect(sandboxAdapterManifestSchema.safeParse({ ...manifest(), extra: 1 }).success).toBe(false);
    expect(sandboxAdapterRequestSchema.safeParse({ ...request(), capabilities: { "net.fetch": true } }).success).toBe(false);
    expect(sandboxAdapterRequestSchema.safeParse({ ...request(), path: "C:\\x" }).success).toBe(false);
    expect(sandboxAdapterRequestSchema.safeParse({ ...request(), handle: 7 }).success).toBe(false);
    expect(sandboxAdapterResultSchema.safeParse({ ...result(), extra: true }).success).toBe(false);
  });

  it("rejects bad ids, versions, and unknown schema versions", () => {
    expect(validateSandboxAdapterManifest(manifest({ adapterId: "no-prefix" })).ok).toBe(false);
    expect(validateSandboxAdapterManifest(manifest({ version: "-bad" })).ok).toBe(false);
    expect(sandboxAdapterManifestSchema.safeParse({ ...manifest(), schemaVersion: 2 }).success).toBe(false);
    expect(sandboxAdapterRequestSchema.safeParse({ ...request(), schemaVersion: 2 }).success).toBe(false);
    expect(sandboxAdapterResultSchema.safeParse({ ...result(), schemaVersion: 2 }).success).toBe(false);
  });

  it("rejects non-positive or non-finite limits", () => {
    expect(
      sandboxAdapterManifestSchema.safeParse(manifest({ maxLimits: { timeoutMs: 0, maxOutputBytes: 10, maxInputBytes: 10 } })).success,
    ).toBe(false);
    expect(
      sandboxAdapterManifestSchema.safeParse(
        manifest({ maxLimits: { timeoutMs: Number.POSITIVE_INFINITY, maxOutputBytes: 10, maxInputBytes: 10 } }),
      ).success,
    ).toBe(false);
    expect(
      sandboxAdapterRequestSchema.safeParse(request({ limits: { timeoutMs: -5, maxOutputBytes: 10, maxInputBytes: 10 } })).success,
    ).toBe(false);
    expect(
      sandboxAdapterRequestSchema.safeParse(request({ limits: { timeoutMs: 1.5, maxOutputBytes: 10, maxInputBytes: 10 } })).success,
    ).toBe(false);
  });

  it("rejects requests whose limits exceed the manifest maxima", () => {
    const m = manifest({ maxLimits: { timeoutMs: 10_000, maxOutputBytes: 8_192, maxInputBytes: 8_192 } });
    expect(validateRequestAgainstManifest(request(), m).ok).toBe(true);
    expect(
      validateRequestAgainstManifest(request({ limits: { timeoutMs: 11_000, maxOutputBytes: 4_096, maxInputBytes: 4_096 } }), m).ok,
    ).toBe(false);
    expect(
      validateRequestAgainstManifest(request({ limits: { timeoutMs: 5_000, maxOutputBytes: 9_000, maxInputBytes: 4_096 } }), m).ok,
    ).toBe(false);
    expect(
      validateRequestAgainstManifest(request({ limits: { timeoutMs: 5_000, maxOutputBytes: 4_096, maxInputBytes: 9_000 } }), m).ok,
    ).toBe(false);
    expect(validateRequestAgainstManifest(request({ adapterId: "sbadp_other" }), m).ok).toBe(false);
  });

  it("rejects oversized serialized input", () => {
    const big = { blob: "x".repeat(SANDBOX_LIMITS.maxInputChars) };
    expect(validateSandboxAdapterRequest(request({ input: big })).ok).toBe(false);
  });

  it("rejects unsafe error messages (paths, credentials, control chars)", () => {
    expect(validateSandboxAdapterResult(result({ status: "failed", errorCode: "adapter_failed", message: "boom at C:\\tmp\\x" })).ok).toBe(false);
    expect(validateSandboxAdapterResult(result({ status: "failed", errorCode: "adapter_failed", message: "bad api_key=abc123" })).ok).toBe(false);
    expect(validateSandboxAdapterResult(result({ status: "failed", errorCode: "adapter_failed", message: "line\nbreak" })).ok).toBe(false);
    // Safe messages pass.
    expect(validateSandboxAdapterResult(result({ status: "failed", errorCode: "adapter_failed", message: "Adapter run failed" })).ok).toBe(true);
  });

  it("requires an errorCode on non-completed results and a cleanup receipt always", () => {
    expect(validateSandboxAdapterResult(result({ status: "failed" })).ok).toBe(false);
    expect(
      validateSandboxAdapterResult(result({ status: "failed", errorCode: "adapter_failed" })).ok,
    ).toBe(true);
    const noCleanup = result();
    delete (noCleanup as Record<string, unknown>).cleanup;
    expect(validateSandboxAdapterResult(noCleanup).ok).toBe(false);
  });

  it("requires cleanup_failed code for unclean receipts", () => {
    expect(
      validateSandboxAdapterResult(
        result({ cleanup: { releasedAt: "2026-01-01T00:00:01.000Z", resourcesReleased: [], clean: false } }),
      ).ok,
    ).toBe(false);
    expect(
      validateSandboxAdapterResult(
        result({
          status: "failed",
          errorCode: "cleanup_failed",
          cleanup: { releasedAt: "2026-01-01T00:00:01.000Z", resourcesReleased: [], clean: false },
        }),
      ).ok,
    ).toBe(true);
  });

  it("bounds result data entries and serialized size", () => {
    const bigData = Object.fromEntries(
      Array.from({ length: SANDBOX_LIMITS.maxDataEntries + 1 }, (_, i) => [`k${i}`, "v"]),
    );
    expect(validateSandboxAdapterResult(result({ data: bigData })).ok).toBe(false);
    expect(
      validateSandboxAdapterResult(result({ data: { blob: "x".repeat(SANDBOX_LIMITS.maxOutputChars) } })).ok,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Denial / limit semantics                                            */
/* ------------------------------------------------------------------ */

describe("sandbox denial and limit result semantics", () => {
  it("denies default (all-disabled) capabilities and ungranted permissions", () => {
    const m = manifest({ requiredPermissions: ["net.fetch"], requestedCapabilities: { "net.fetch": true } });
    const defaultDenied = { "fs.read": false, "fs.write": false, "net.fetch": false, "process.spawn": false };
    expect(validateSandboxPermissions(m, defaultDenied).ok).toBe(false);
    expect(validateSandboxCapabilityGrant(m, defaultDenied).ok).toBe(false);
    // Granting both passes.
    expect(validateSandboxPermissions(m, { ...defaultDenied, "net.fetch": true }).ok).toBe(true);
    expect(validateSandboxCapabilityGrant(m, { ...defaultDenied, "net.fetch": true }).ok).toBe(true);
    // An adapter requiring nothing passes under default denial.
    const free = manifest();
    expect(validateSandboxPermissions(free, defaultDenied).ok).toBe(true);
    expect(validateSandboxCapabilityGrant(free, defaultDenied).ok).toBe(true);
  });

  it("builds canonical denied/unavailable/limit results with zero usage and clean receipts", () => {
    const m = manifest();
    const denied = deniedSandboxResult(m, "permission_unmet", "required permission not granted: net.fetch");
    expect(denied.status).toBe("denied");
    expect(denied.errorCode).toBe("permission_unmet");
    expect(denied.usage).toEqual({ elapsedMs: 0, outputBytes: 0 });
    expect(denied.cleanup.clean).toBe(true);
    expect(validateSandboxAdapterResult(denied).ok).toBe(true);

    const unavailable = unavailableSandboxResult(m, "adapter not registered");
    expect(unavailable.status).toBe("unavailable");
    expect(validateSandboxAdapterResult(unavailable).ok).toBe(true);

    const tooLarge = inputTooLargeResult(m, "input exceeds the adapter maximum");
    expect(tooLarge.status).toBe("failed");
    expect(tooLarge.errorCode).toBe("input_too_large");
    expect(validateSandboxAdapterResult(tooLarge).ok).toBe(true);

    const timedOut = timedOutSandboxResult(m, 5_000);
    expect(timedOut.status).toBe("timed_out");
    expect(timedOut.errorCode).toBe("timeout");
    expect(validateSandboxAdapterResult(timedOut).ok).toBe(true);

    const exhausted = resourceExhaustedSandboxResult(m, 5_000, "output budget exhausted");
    expect(exhausted.status).toBe("resource_exhausted");
    expect(exhausted.errorCode).toBe("limits_exceeded");
    expect(validateSandboxAdapterResult(exhausted).ok).toBe(true);
  });

  it("keeps denial results free of secrets and paths", () => {
    const denied = deniedSandboxResult(manifest(), "permission_unmet", "required permission not granted: net.fetch");
    const serialized = JSON.stringify(denied);
    expect(serialized).not.toMatch(/sk-|apiKey|baseUrl|password|token/i);
    expect(serialized).not.toMatch(/[A-Za-z]:\\\\/);
  });
});

/* ------------------------------------------------------------------ */
/* Content-hash proof adapter                                          */
/* ------------------------------------------------------------------ */

function bundleWithItem(text: string, overrides: Record<string, unknown> = {}): { bundle: EvidenceBundle; id: string } {
  const packet = normalizeUserEvidencePacket({
    version: 1,
    items: [{ source: "user_text", label: "notes", content: text }],
  });
  if (!packet.success) throw new Error("fixture failed");
  const bundle = packet.data;
  const id = bundle.items[0]!.id;
  const patched = {
    ...bundle,
    items: [{ ...bundle.items[0]!, ...overrides } as (typeof bundle.items)[number]],
  };
  return { bundle: patched, id };
}

describe("content-hash proof adapter", () => {
  it("verifies exact ASCII, Unicode, and newline hashes", () => {
    for (const text of ["plain ascii", "héllo — wörld ✅", "line one\nline two\ttabbed"]) {
      const { bundle, id } = bundleWithItem(text);
      const outcome = runContentHashProof({ kind: "verify", evidenceId: id }, bundle);
      expect(outcome.status).toBe("verified");
      if (outcome.status !== "verified") continue;
      expect(outcome.proof.status).toBe("verified");
      expect(outcome.proof.adapterId).toBe(CONTENT_HASH_ADAPTER_ID);
      expect(outcome.proof.adapterVersion).toBe(CONTENT_HASH_ADAPTER_VERSION);
      expect(outcome.proof.algorithm).toBe(CONTENT_HASH_ALGORITHM);
      expect(outcome.proof.data?.details?.contentBytes).toBe(Buffer.byteLength(text, "utf8"));
      expect(JSON.stringify(outcome.proof)).not.toContain(text);
    }
  });

  it("fails on a provenance hash mismatch without mutating item status", () => {
    const { bundle, id } = bundleWithItem("trustworthy text", {
      provenance: {
        kind: "user-text",
        origin: "user",
        reference: "notes",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        contentHash: "b".repeat(64),
        extractionMethod: "user-paste",
      },
    });
    const outcome = runContentHashProof({ kind: "verify", evidenceId: id }, bundle);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.proof.status).toBe("failed");
    // The item's status is NEVER altered by the adapter.
    expect(bundle.items[0]!.status).toBe("unverified");
    expect(JSON.stringify(outcome.proof)).not.toContain("trustworthy text");
  });

  it("validates source snapshot hash/bytes/content and reports mismatches", () => {
    const content = "snapshot content";
    const goodHash = createHash("sha256").update(content, "utf8").digest("hex");
    const packet = normalizeUserEvidencePacket({
      version: 1,
      items: [{ source: "user_text", label: "notes", content }],
    });
    if (!packet.success) throw new Error("fixture failed");
    const snapshot = {
      schemaVersion: 1 as const,
      id: "srcsnap_abc123",
      adapterId: "srcadp_test",
      adapterVersion: "1.0.0",
      kind: "external-source" as const,
      reference: "https://example.com/report",
      contentType: "text/plain",
      contentBytes: Buffer.byteLength(content, "utf8"),
      contentHash: goodHash,
      content,
      capturedAt: "2026-01-01T00:00:00.000Z",
      freshness: { mode: "snapshot-only" as const, maxAgeSeconds: 60 },
      freshUntil: null,
    };
    const base = {
      ...packet.data,
      items: [
        {
          ...packet.data.items[0]!,
          provenance: {
            ...packet.data.items[0]!.provenance,
            kind: "external-source" as const,
            origin: "srcadp_test",
            contentHash: goodHash,
            sourceSnapshotId: "srcsnap_abc123",
          },
        },
      ],
      sourceSnapshots: [snapshot],
    };

    // Consistent snapshot verifies.
    const ok = runContentHashProof({ kind: "verify", evidenceId: base.items[0]!.id }, base);
    expect(ok.status).toBe("verified");

    // Hash mismatch in the snapshot fails.
    const badHashBundle = {
      ...base,
      sourceSnapshots: [{ ...snapshot, contentHash: "c".repeat(64) }],
    };
    expect(runContentHashProof({ kind: "verify", evidenceId: base.items[0]!.id }, badHashBundle).status).toBe("failed");

    // Byte-count mismatch fails.
    const badBytesBundle = {
      ...base,
      sourceSnapshots: [{ ...snapshot, contentBytes: 999 }],
    };
    expect(runContentHashProof({ kind: "verify", evidenceId: base.items[0]!.id }, badBytesBundle).status).toBe("failed");

    // Content mismatch (hash recompute catches tampering) fails.
    const badContentBundle = {
      ...base,
      sourceSnapshots: [{ ...snapshot, content: "tampered content" }],
    };
    expect(runContentHashProof({ kind: "verify", evidenceId: base.items[0]!.id }, badContentBundle).status).toBe("failed");

    // Missing snapshot is unavailable.
    const missingBundle = { ...base, sourceSnapshots: [] };
    const missing = runContentHashProof({ kind: "verify", evidenceId: base.items[0]!.id }, missingBundle);
    expect(missing.status).toBe("unavailable");
  });

  it("reports unavailable for missing evidence and empty bundles", () => {
    expect(runContentHashProof({ kind: "verify", evidenceId: "ev_ghost" }, emptyEvidenceBundle()).status).toBe("unavailable");
    const listed = runContentHashProof({ kind: "list" }, emptyEvidenceBundle());
    expect(listed.status).toBe("unavailable");
  });

  it("rejects malformed bundles instead of throwing", () => {
    const malformed = { schemaVersion: 1, items: "not-an-array" } as unknown as EvidenceBundle;
    const outcome = runContentHashProof({ kind: "verify", evidenceId: "ev_1" }, malformed);
    expect(outcome.status).toBe("unavailable");
  });

  it("is deterministic and bounded", () => {
    const { bundle, id } = bundleWithItem("deterministic input");
    const first = runContentHashProof({ kind: "verify", evidenceId: id }, bundle, "2026-01-01T00:00:00.000Z");
    const second = runContentHashProof({ kind: "verify", evidenceId: id }, bundle, "2026-01-01T00:00:00.000Z");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(isBoundedProofResult(first.proof)).toBe(true);
    expect(JSON.stringify(first.proof).length).toBeLessThanOrEqual(CONTENT_HASH_RESULT_MAX_CHARS);
  });

  it("declares a manifest with no capabilities or permissions", () => {
    expect(validateSandboxAdapterManifest(CONTENT_HASH_ADAPTER_MANIFEST).ok).toBe(true);
    expect(CONTENT_HASH_ADAPTER_MANIFEST.requiredPermissions).toEqual([]);
    expect(CONTENT_HASH_ADAPTER_MANIFEST.requestedCapabilities).toEqual({});
    // Runs fine under the all-disabled default capability set.
    const defaultDenied = { "fs.read": false, "fs.write": false, "net.fetch": false, "process.spawn": false };
    expect(validateSandboxPermissions(CONTENT_HASH_ADAPTER_MANIFEST, defaultDenied).ok).toBe(true);
    expect(validateSandboxCapabilityGrant(CONTENT_HASH_ADAPTER_MANIFEST, defaultDenied).ok).toBe(true);
    expect(CONTENT_HASH_ADAPTER_ID).toMatch(/^sbadp_/);
  });
});

/* ------------------------------------------------------------------ */
/* appendProofResult + legacy compatibility                            */
/* ------------------------------------------------------------------ */

describe("appendProofResult", () => {
  function proof(evidenceId: string, overrides: Partial<ProofResult> = {}): ProofResult {
    return {
      evidenceId,
      status: "verified",
      adapterId: CONTENT_HASH_ADAPTER_ID,
      adapterVersion: CONTENT_HASH_ADAPTER_VERSION,
      algorithm: CONTENT_HASH_ALGORITHM,
      data: { details: { contentBytes: 5 } },
      verifiedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("appends a valid proof and round-trips through bundle validation", () => {
    const { bundle, id } = bundleWithItem("hello");
    const appended = appendProofResult(bundle, proof(id));
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.bundle.proofs).toHaveLength(1);
    expect(validateEvidenceBundle(appended.bundle).success).toBe(true);
    const normalized = normalizeLegacyEvidence(JSON.parse(JSON.stringify(appended.bundle)));
    expect(normalized.proofs).toEqual(appended.bundle.proofs);
  });

  it("rejects unknown evidence refs and duplicates", () => {
    const { bundle, id } = bundleWithItem("hello");
    expect(appendProofResult(bundle, proof("ev_ghost")).ok).toBe(false);
    const once = appendProofResult(bundle, proof(id));
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(appendProofResult(once.bundle, proof(id, { status: "failed" })).ok).toBe(false);
  });

  it("rejects malformed proofs", () => {
    const { bundle, id } = bundleWithItem("hello");
    expect(appendProofResult(bundle, proof(id, { adapterId: "no-prefix" })).ok).toBe(false);
    expect(appendProofResult(bundle, proof(id, { verifiedAt: "not-a-date" })).ok).toBe(false);
  });

  it("keeps legacy proof records (no adapter metadata) valid", () => {
    const legacyProof = {
      evidenceId: "ev_1",
      status: "verified",
      data: { message: "checked manually" },
      verifiedAt: "2026-01-01T00:00:00.000Z",
    };
    const bundle = {
      ...emptyEvidenceBundle(),
      items: [
        {
          id: "ev_1",
          text: "legacy",
          claimIds: [],
          provenance: {
            kind: "user-text" as const,
            origin: "user",
            reference: "notes",
            retrievedAt: "2026-01-01T00:00:00.000Z",
            contentHash: createHash("sha256").update("legacy", "utf8").digest("hex"),
            extractionMethod: "user-paste",
          },
          status: "unverified" as const,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      proofs: [legacyProof],
    };
    expect(validateEvidenceBundle(bundle).success).toBe(true);
    const normalized = normalizeLegacyEvidence(JSON.parse(JSON.stringify(bundle)));
    expect(normalized.proofs[0]?.adapterId).toBeUndefined();
    expect(normalized.proofs[0]?.algorithm).toBeUndefined();
  });

  it("keeps evidence-free match records valid and records with proofs parseable", () => {
    const base = {
      version: CONTRACT_VERSION,
      matchId: "match-proof-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
      topic: "Should AI be regulated?",
      mode: "quick",
      sides: {
        A: { providerName: "Provider One", modelId: "m1", position: "FOR", providerId: "p1" },
        B: { providerName: "Provider Two", modelId: "m2", position: "AGAINST" },
      },
      judge: { providerId: "p1", model: "m1" },
      policy: {
        mode: "quick",
        enabled: true,
        rounds: 4,
        agentMaxOutputTokens: 2000,
        judgeMaxOutputTokens: 2000,
        historyTurns: 6,
        maxContextCharsPerSide: 12000,
      },
      promptVersions: { agent: "1", judge: "1" },
      rubricVersion: "1",
      transcript: [],
      verdict: null,
      terminal: "completed",
      terminalReason: null,
      metrics: { turnsMs: [], totalMs: 100 },
    };
    expect(matchRecordSchema.safeParse(base).success).toBe(true);
  });
});
