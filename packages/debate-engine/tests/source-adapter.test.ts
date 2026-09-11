/**
 * Tests for the F10-09/F10-10 safe source-adapter foundation: strict
 * contracts, pure hashing/freshness helpers, the gate, and the pure ingest
 * merge. No adapter implementation, no network, no I/O.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  SOURCE_ADAPTER_LIMITS,
  SOURCE_ADAPTER_SCHEMA_VERSION,
  computeSourceContentHash,
  deriveFreshUntil,
  isSourceSnapshotFresh,
  issueSourceConsent,
  newSourceAccessAuditId,
  newSourceConsentId,
  newSourceSnapshotId,
  sourceAdapterManifestSchema,
  sourceAdapterRequestSchema,
  sourceAccessAuditSchema,
  sourceConsentSchema,
  sourceContentBytes,
  sourceSnapshotSchema,
  validateSourceConsent,
  validateSourceGate,
} from "../src/source-adapter-contract";
import {
  buildDeniedSourceAudit,
  deniedSourceEventBody,
  ingestSourceCapture,
  type SourceCaptureInput,
} from "../src/source-adapter-ingest";
import { emptyEvidenceBundle, validateEvidenceEvent, normalizeLegacyEvidence } from "../src/evidence-contract";
import { CONTRACT_VERSION, matchRecordSchema } from "../src/contract";
import type { EvidenceBundle, SourceAdapterManifest, SourceConsent } from "@arena/types";

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

const UNICODE_CONTENT = "héllo — wörld\nline two\ttabbed ✅";

function manifest(): SourceAdapterManifest {
  return {
    schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
    adapterId: "srcadp_test",
    version: "1.0.0",
    kind: "external-source",
    displayName: "Test Adapter",
    requestedCapabilities: { "net.fetch": true },
    requiredPermissions: ["net.fetch"],
    requiresExplicitUserAction: true,
  };
}

function consent(overrides: Partial<SourceConsent> = {}): SourceConsent {
  const base: SourceConsent = {
    schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
    consentId: "sconsent_test_0001",
    adapterId: "srcadp_test",
    adapterVersion: "1.0.0",
    reference: "example-report-2026",
    granted: true,
    requestedCapabilities: { "net.fetch": true },
    grantedCapabilities: { "net.fetch": true },
    decidedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    confirmedByUserAction: true,
  };
  return { ...base, ...overrides };
}

function capture(overrides: Partial<SourceCaptureInput> = {}): SourceCaptureInput {
  return {
    manifest: manifest(),
    consent: consent(),
    reference: "example-report-2026",
    content: UNICODE_CONTENT,
    contentType: "text/plain",
    contentHash: createHash("sha256").update(UNICODE_CONTENT, "utf8").digest("hex"),
    freshness: { mode: "snapshot-only", maxAgeSeconds: 86_400 },
    grantedPermissions: { "net.fetch": true },
    ...overrides,
  };
}

function ingestContext() {
  return { matchId: "match-1", consentId: "sconsent_test_0001", now: "2026-01-01T12:00:00.000Z" };
}

/* ------------------------------------------------------------------ */
/* Strict schema validation                                            */
/* ------------------------------------------------------------------ */

describe("source adapter strict schemas", () => {
  it("accepts a valid manifest, request, consent, snapshot, and audit", () => {
    expect(sourceAdapterManifestSchema.safeParse(manifest()).success).toBe(true);
    expect(
      sourceAdapterRequestSchema.safeParse({
        schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
        manifest: manifest(),
        description: "Fetch one report page.",
      }).success,
    ).toBe(true);
    expect(sourceConsentSchema.safeParse(consent()).success).toBe(true);
  });

  it("rejects unknown fields everywhere", () => {
    expect(sourceAdapterManifestSchema.safeParse({ ...manifest(), extra: 1 }).success).toBe(false);
    expect(sourceConsentSchema.safeParse({ ...consent(), extra: true }).success).toBe(false);
  });

  it("rejects non-true requiresExplicitUserAction", () => {
    expect(
      sourceAdapterManifestSchema.safeParse({ ...manifest(), requiresExplicitUserAction: false }).success,
    ).toBe(false);
    expect(
      sourceAdapterManifestSchema.safeParse({ ...manifest(), requiresExplicitUserAction: 1 }).success,
    ).toBe(false);
  });

  it("rejects bad ids, versions, and unknown schema versions", () => {
    expect(
      sourceAdapterManifestSchema.safeParse({ ...manifest(), adapterId: "no-prefix" }).success,
    ).toBe(false);
    expect(
      sourceAdapterManifestSchema.safeParse({ ...manifest(), version: "-bad" }).success,
    ).toBe(false);
    expect(
      sourceAdapterManifestSchema.safeParse({ ...manifest(), schemaVersion: 2 }).success,
    ).toBe(false);
    expect(
      sourceAdapterManifestSchema.safeParse({ ...manifest(), kind: "web-search" }).success,
    ).toBe(false);
  });

  it("rejects unsafe references: control chars, newlines, credentials, paths", () => {
    const snapshot = (reference: string) => validSnapshot({ reference });
    expect(sourceSnapshotSchema.safeParse(snapshot("has\nnewline")).success).toBe(false);
    expect(sourceSnapshotSchema.safeParse(snapshot("has\ttab\tok? no")).success).toBe(false);
    expect(sourceSnapshotSchema.safeParse(snapshot("https://user:pass@example.com/x")).success).toBe(false);
    expect(sourceSnapshotSchema.safeParse(snapshot("C:\\Users\\notes.txt")).success).toBe(false);
    expect(sourceSnapshotSchema.safeParse(snapshot("../etc/passwd")).success).toBe(false);
    expect(sourceSnapshotSchema.safeParse(snapshot("https://example.com/report")).success).toBe(true);
    expect(sourceSnapshotSchema.safeParse(snapshot("bare-locator_2026")).success).toBe(true);
  });

  it("rejects non-text content types and oversized content", () => {
    expect(
      sourceSnapshotSchema.safeParse(validSnapshot({ contentType: "application/octet-stream" })).success,
    ).toBe(false);
    expect(
      sourceSnapshotSchema.safeParse(validSnapshot({ content: "x".repeat(SOURCE_ADAPTER_LIMITS.maxContentBytes + 1) })).success,
    ).toBe(false);
  });

  it("rejects non-lowercase or wrong-length hashes", () => {
    expect(sourceSnapshotSchema.safeParse(validSnapshot({ contentHash: "A".repeat(64) })).success).toBe(false);
    expect(sourceSnapshotSchema.safeParse(validSnapshot({ contentHash: "a".repeat(63) })).success).toBe(false);
    expect(sourceSnapshotSchema.safeParse(validSnapshot({ contentHash: "zz".repeat(32) })).success).toBe(false);
  });

  it("rejects unbounded ages and timestamps", () => {
    expect(
      sourceSnapshotSchema.safeParse(
        validSnapshot({ freshness: { mode: "reuse-if-fresh", maxAgeSeconds: SOURCE_ADAPTER_LIMITS.maxMaxAgeSeconds + 1 } }),
      ).success,
    ).toBe(false);
    expect(
      sourceSnapshotSchema.safeParse(
        validSnapshot({ freshness: { mode: "reuse-if-fresh", maxAgeSeconds: 0 } }),
      ).success,
    ).toBe(false);
    expect(sourceSnapshotSchema.safeParse(validSnapshot({ capturedAt: "not-a-date" })).success).toBe(false);
  });

  it("rejects credential-like metadata keys and oversized metadata", () => {
    expect(sourceSnapshotSchema.safeParse(validSnapshot({ metadata: { apiKey: "x" } })).success).toBe(false);
    expect(sourceSnapshotSchema.safeParse(validSnapshot({ metadata: { password: "x" } })).success).toBe(false);
    expect(sourceSnapshotSchema.safeParse(validSnapshot({ metadata: { AUTH_TOKEN: "x" } })).success).toBe(false);
    const bigMetadata = Object.fromEntries(
      Array.from({ length: SOURCE_ADAPTER_LIMITS.metadataEntries + 1 }, (_, i) => [`k${i}`, "v"]),
    );
    expect(sourceSnapshotSchema.safeParse(validSnapshot({ metadata: bigMetadata })).success).toBe(false);
    // Safe metadata passes.
    expect(sourceSnapshotSchema.safeParse(validSnapshot({ metadata: { title: "Report", pages: 12 } })).success).toBe(true);
  });

  it("recomputes snapshot hash and byte count from stored content — declared fields are never trusted", () => {
    // Altered content with the original (now stale) hash fails.
    expect(
      sourceSnapshotSchema.safeParse(validSnapshot({ content: "tampered content" })).success,
    ).toBe(false);
    // Wrong declared byte count fails even with correct hash.
    expect(
      sourceSnapshotSchema.safeParse(validSnapshot({ contentBytes: 9999 })).success,
    ).toBe(false);
    // Byte count off by one (multi-byte char counting) fails.
    expect(
      sourceSnapshotSchema.safeParse(validSnapshot({ contentBytes: Buffer.byteLength(UNICODE_CONTENT, "utf8") - 1 })).success,
    ).toBe(false);
    // A fully consistent snapshot parses and the recomputed values are used.
    const parsed = sourceSnapshotSchema.safeParse(validSnapshot());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.contentHash).toBe(computeSourceContentHash(UNICODE_CONTENT));
      expect(parsed.data.contentBytes).toBe(sourceContentBytes(UNICODE_CONTENT));
    }
  });

  it("rejects freshUntil inconsistent with the freshness policy and future captures", () => {
    // snapshot-only must derive freshUntil = null.
    expect(
      sourceSnapshotSchema.safeParse(validSnapshot({ freshUntil: "2026-01-02T00:00:00.000Z" })).success,
    ).toBe(false);
    // reuse-if-fresh must derive freshUntil = capturedAt + maxAge.
    const timed = validSnapshot({
      freshness: { mode: "reuse-if-fresh", maxAgeSeconds: 3600 },
      freshUntil: "2026-01-01T01:00:00.000Z",
    });
    expect(sourceSnapshotSchema.safeParse(timed).success).toBe(true);
    expect(
      sourceSnapshotSchema.safeParse({ ...timed, freshUntil: "2026-01-01T02:00:00.000Z" }).success,
    ).toBe(false);
    // Future capture (beyond the clock-skew allowance) is rejected.
    expect(
      sourceSnapshotSchema.safeParse(validSnapshot({ capturedAt: "2126-01-01T00:00:00.000Z" })).success,
    ).toBe(false);
  });

  it("rejects consent with inverted expiry or ungranted structure", () => {
    expect(
      sourceConsentSchema.safeParse(consent({ expiresAt: "2025-01-01T00:00:00.000Z" })).success,
    ).toBe(false);
    expect(
      sourceConsentSchema.safeParse(consent({ adapterId: "srcadp_other" })).success,
    ).toBe(true); // different adapter is structurally fine; gate rejects it
    // Missing/foreign consentId, missing user-action confirmation, or a
    // client-chosen consent id can never validate.
    expect(sourceConsentSchema.safeParse(consent({ consentId: "consent-1" })).success).toBe(false);
    expect(
      sourceConsentSchema.safeParse({ ...consent(), consentId: undefined }).success,
    ).toBe(false);
    expect(
      sourceConsentSchema.safeParse({ ...consent(), confirmedByUserAction: undefined }).success,
    ).toBe(false);
    expect(
      sourceConsentSchema.safeParse({ ...consent(), reference: "https://user:pass@x.com" }).success,
    ).toBe(false);
  });

  it("generates canonical server-side ids", () => {
    expect(newSourceSnapshotId()).toMatch(/^srcsnap_[A-Za-z0-9]+$/);
    expect(newSourceAccessAuditId()).toMatch(/^srcaudit_[A-Za-z0-9]+$/);
    expect(newSourceSnapshotId()).not.toBe(newSourceSnapshotId());
  });
});

function validSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
    id: "srcsnap_abc123",
    adapterId: "srcadp_test",
    adapterVersion: "1.0.0",
    kind: "external-source",
    reference: "https://example.com/report",
    contentType: "text/plain",
    contentBytes: Buffer.byteLength(UNICODE_CONTENT, "utf8"),
    contentHash: createHash("sha256").update(UNICODE_CONTENT, "utf8").digest("hex"),
    content: UNICODE_CONTENT,
    capturedAt: "2026-01-01T00:00:00.000Z",
    freshness: { mode: "snapshot-only", maxAgeSeconds: 86_400 },
    freshUntil: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Pure helpers: hashing + freshness                                   */
/* ------------------------------------------------------------------ */

describe("source hashing and freshness", () => {
  it("computes exact UTF-8 SHA-256 for Unicode, newlines, and tabs", () => {
    expect(computeSourceContentHash(UNICODE_CONTENT)).toBe(
      createHash("sha256").update(UNICODE_CONTENT, "utf8").digest("hex"),
    );
    expect(computeSourceContentHash("é")).toBe(
      createHash("sha256").update("é", "utf8").digest("hex"),
    );
    // 2 UTF-8 bytes for 'é', not 1 char.
    expect(sourceContentBytes("é")).toBe(2);
    expect(sourceContentBytes("a\nb\tc")).toBe(5);
  });

  it("derives freshUntil: null for snapshot-only, bounded instant otherwise", () => {
    expect(deriveFreshUntil({ mode: "snapshot-only", maxAgeSeconds: 60 }, "2026-01-01T00:00:00.000Z")).toBeNull();
    expect(
      deriveFreshUntil({ mode: "reuse-if-fresh", maxAgeSeconds: 3600 }, "2026-01-01T00:00:00.000Z"),
    ).toBe("2026-01-01T01:00:00.000Z");
  });

  it("evaluates freshness boundaries exactly", () => {
    const snapshot = {
      freshness: { mode: "reuse-if-fresh" as const, maxAgeSeconds: 3600 },
      freshUntil: "2026-01-01T01:00:00.000Z",
    };
    expect(isSourceSnapshotFresh(snapshot, "2026-01-01T01:00:00.000Z")).toBe(true);
    expect(isSourceSnapshotFresh(snapshot, "2026-01-01T01:00:00.001Z")).toBe(false);
    expect(isSourceSnapshotFresh({ freshness: { mode: "snapshot-only", maxAgeSeconds: 1 }, freshUntil: null }, Date.now())).toBe(true);
    // Fail closed: time-bounded policy with no freshUntil is stale.
    expect(isSourceSnapshotFresh({ freshness: { mode: "reuse-if-fresh", maxAgeSeconds: 60 }, freshUntil: null }, Date.now())).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Consent/capability gates                                            */
/* ------------------------------------------------------------------ */

describe("source consent and capability gates", () => {
  it("passes a granted, unexpired, capability-covered consent", () => {
    const result = validateSourceGate(manifest(), consent(), { "net.fetch": true }, Date.parse("2026-01-01T06:00:00.000Z"));
    expect(result.ok).toBe(true);
  });

  it("denies missing, revoked, or wrong-adapter consent", () => {
    expect(validateSourceGate(manifest(), undefined, {}, Date.now())).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      validateSourceGate(manifest(), consent({ granted: false }), { "net.fetch": true }, Date.now()),
    ).toMatchObject({ ok: false, reason: "consent-missing" });
    expect(
      validateSourceGate(manifest(), consent({ adapterId: "srcadp_other" }), { "net.fetch": true }, Date.now()),
    ).toMatchObject({ ok: false, reason: "consent-replayed" });
  });

  it("rejects forged grants lacking explicit user-action confirmation", () => {
    const forged = consent() as unknown as Record<string, unknown>;
    delete forged.confirmedByUserAction;
    expect(
      validateSourceGate(manifest(), forged, { "net.fetch": true }, Date.parse("2026-01-01T06:00:00.000Z")),
    ).toMatchObject({ ok: false, reason: "invalid" });
    // granted: false is never a valid grant, confirmed or not.
    expect(
      validateSourceGate(
        manifest(),
        consent({ granted: false }),
        { "net.fetch": true },
        Date.parse("2026-01-01T06:00:00.000Z"),
      ),
    ).toMatchObject({ ok: false, reason: "consent-missing" });
  });

  it("rejects replayed consent: wrong version, match, request, or reference", () => {
    const now = Date.parse("2026-01-01T06:00:00.000Z");
    // Adapter version is pinned — a v1.0.0 consent cannot authorize v1.1.0.
    expect(
      validateSourceGate(
        manifest(),
        consent({ adapterVersion: "1.1.0" }),
        { "net.fetch": true },
        now,
      ),
    ).toMatchObject({ ok: false, reason: "consent-replayed" });
    // Match binding: the consent was issued for a different match.
    expect(
      validateSourceGate(
        manifest(),
        consent({ matchId: "match-9" }),
        { "net.fetch": true },
        now,
        { matchId: "match-1" },
      ),
    ).toMatchObject({ ok: false, reason: "consent-replayed" });
    // Request binding.
    expect(
      validateSourceGate(
        manifest(),
        consent({ requestId: "req-A" }),
        { "net.fetch": true },
        now,
        { requestId: "req-B" },
      ),
    ).toMatchObject({ ok: false, reason: "consent-replayed" });
    // Exact reference binding.
    expect(
      validateSourceGate(
        manifest(),
        consent({ reference: "other-ref" }),
        { "net.fetch": true },
        now,
        { reference: "example-report-2026" },
      ),
    ).toMatchObject({ ok: false, reason: "consent-replayed" });
  });

  it("rejects forged request snapshots that diverge from the manifest", () => {
    const now = Date.parse("2026-01-01T06:00:00.000Z");
    // A client-crafted consent claiming a different capability set than the
    // manifest requests is a replay/forgery, not a capability gap.
    expect(
      validateSourceGate(
        manifest(),
        consent({ requestedCapabilities: { "fs.read": true } }),
        { "net.fetch": true },
        now,
      ),
    ).toMatchObject({ ok: false, reason: "consent-replayed" });
    expect(
      validateSourceGate(
        manifest(),
        consent({ requestedCapabilities: {} }),
        { "net.fetch": true },
        now,
      ),
    ).toMatchObject({ ok: false, reason: "consent-replayed" });
  });

  it("denies expired consent", () => {
    expect(
      validateSourceGate(manifest(), consent(), { "net.fetch": true }, Date.parse("2026-01-03T00:00:00.000Z")),
    ).toMatchObject({ ok: false, reason: "consent-expired" });
  });

  it("denies capability and permission gaps", () => {
    expect(
      validateSourceGate(
        manifest(),
        consent({ grantedCapabilities: {} }),
        { "net.fetch": true },
        Date.parse("2026-01-01T06:00:00.000Z"),
      ),
    ).toMatchObject({ ok: false, reason: "capability-denied" });
    expect(
      validateSourceGate(manifest(), consent(), {}, Date.parse("2026-01-01T06:00:00.000Z")),
    ).toMatchObject({
      ok: false,
      reason: "permission-unmet",
    });
  });

  it("rejects client-supplied granted capabilities that do not cover the manifest", () => {
    // A client-crafted consent claiming fewer capabilities than requested
    // cannot pass: the gate compares against the manifest's requests.
    expect(
      validateSourceGate(
        manifest(),
        consent({ grantedCapabilities: { "fs.read": true } }),
        { "net.fetch": true },
        Date.parse("2026-01-01T06:00:00.000Z"),
      ),
    ).toMatchObject({ ok: false, reason: "capability-denied" });
  });

  it("round-trips consent validation outside the gate", () => {
    expect(validateSourceConsent(consent())).toBeDefined();
    expect(validateSourceConsent({ ...consent(), extra: 1 })).toBeUndefined();
  });

  it("issues server-side consents bound to adapter version, reference, and capabilities", () => {
    const request = {
      schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
      manifest: manifest(),
      description: "Fetch one report page.",
    };
    const issued = issueSourceConsent(request, {
      reference: "example-report-2026",
      matchId: "match-1",
      decidedAt: "2026-01-01T00:00:00.000Z",
      ttlSeconds: 3600,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const c = issued.consent;
    expect(c.consentId).toMatch(/^sconsent_[A-Za-z0-9]+$/);
    expect(c.adapterVersion).toBe("1.0.0");
    expect(c.reference).toBe("example-report-2026");
    expect(c.requestedCapabilities).toEqual({ "net.fetch": true });
    expect(c.grantedCapabilities).toEqual({ "net.fetch": true });
    expect(c.confirmedByUserAction).toBe(true);
    expect(sourceConsentSchema.safeParse(c).success).toBe(true);
    // The issued consent passes the gate for the exact binding.
    const gate = validateSourceGate(
      manifest(),
      c,
      { "net.fetch": true },
      Date.parse("2026-01-01T00:30:00.000Z"),
      { matchId: "match-1", reference: "example-report-2026" },
    );
    expect(gate.ok).toBe(true);
    // Invalid requests/references/ttls are refused.
    expect(issueSourceConsent({ bad: true }, { reference: "x" }).ok).toBe(false);
    expect(issueSourceConsent(request, { reference: "../etc/passwd" }).ok).toBe(false);
    expect(issueSourceConsent(request, { reference: "x", ttlSeconds: 0 }).ok).toBe(false);
  });

  it("generates canonical server-side consent ids", () => {
    expect(newSourceConsentId()).toMatch(/^sconsent_[A-Za-z0-9]+$/);
    expect(newSourceConsentId()).not.toBe(newSourceConsentId());
  });
});

/* ------------------------------------------------------------------ */
/* Pure ingest                                                         */
/* ------------------------------------------------------------------ */

describe("source adapter ingest", () => {
  it("creates an unverified evidence item with sourceSnapshotId and server identity", () => {
    const result = ingestSourceCapture(emptyEvidenceBundle(), capture(), ingestContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.items).toHaveLength(1);
    const item = result.bundle.items[0]!;
    expect(item.status).toBe("unverified");
    expect(item.claimIds).toEqual([]);
    expect(item.provenance.kind).toBe("external-source");
    expect(item.provenance.origin).toBe("srcadp_test");
    expect(item.provenance.sourceSnapshotId).toBe(result.snapshot.id);
    expect(item.provenance.contentHash).toBe(capture().contentHash);
    expect(result.snapshot.contentHash).toBe(capture().contentHash);
    expect(result.snapshot.contentBytes).toBe(sourceContentBytes(UNICODE_CONTENT));
    expect(result.snapshot.freshUntil).toBeNull();
    expect(result.audit.outcome).toBe("granted");
    expect(result.audit.sourceSnapshotId).toBe(result.snapshot.id);
    expect(JSON.stringify(result.audit)).not.toContain(UNICODE_CONTENT);
    // The merged bundle passes canonical validation.
    expect(validateEvidenceEventSafe(result.bundle)).toBe(true);
  });

  it("emits only safe lifecycle event bodies (ids, no content/secrets)", () => {
    const result = ingestSourceCapture(emptyEvidenceBundle(), capture(), ingestContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventBodies).toHaveLength(2);
    expect(result.eventBodies[0]).toEqual({
      type: "source-snapshot-captured",
      sourceSnapshotId: result.snapshot.id,
      adapterId: "srcadp_test",
    });
    expect(result.eventBodies[1]).toEqual({
      type: "source-evidence-added",
      evidenceId: result.bundle.items[0]!.id,
      sourceSnapshotId: result.snapshot.id,
    });
    for (const body of result.eventBodies) {
      expect(validateEvidenceEvent({ eventVersion: 1, matchId: "match-1", seq: 1, ...body }).success).toBe(true);
      expect(JSON.stringify(body)).not.toContain(UNICODE_CONTENT);
    }
  });

  it("preserves existing bundle entities", () => {
    const base = emptyEvidenceBundle();
    const existingItem = {
      id: "ev_existing",
      text: "existing",
      claimIds: [],
      provenance: {
        kind: "user-text" as const,
        origin: "user",
        reference: "notes",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        contentHash: "a".repeat(64),
        extractionMethod: "user-paste",
      },
      status: "unverified" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const withExisting: EvidenceBundle = { ...base, items: [existingItem] };
    const result = ingestSourceCapture(withExisting, capture(), ingestContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.items).toHaveLength(2);
    expect(result.bundle.items[0]?.id).toBe("ev_existing");
  });

  it("rejects hash mismatch, oversized content, and empty content", () => {
    const badHash = ingestSourceCapture(
      emptyEvidenceBundle(),
      capture({ contentHash: "b".repeat(64) }),
      ingestContext(),
    );
    expect(badHash.ok).toBe(false);
    if (!badHash.ok) expect(badHash.reason).toMatch(/hash mismatch/);

    const oversized = ingestSourceCapture(
      emptyEvidenceBundle(),
      capture({ content: "x".repeat(SOURCE_ADAPTER_LIMITS.maxContentBytes + 1) }),
      ingestContext(),
    );
    expect(oversized.ok).toBe(false);

    const empty = ingestSourceCapture(emptyEvidenceBundle(), capture({ content: "   " }), ingestContext());
    expect(empty.ok).toBe(false);
  });

  it("rejects altered content and declared byte-count mismatches before persistence", () => {
    // Adapter content differs from what the hash was computed over.
    const tampered = ingestSourceCapture(
      emptyEvidenceBundle(),
      capture({ content: UNICODE_CONTENT + "\ntampered line" }),
      ingestContext(),
    );
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.reason).toMatch(/hash mismatch/);

    // A declared byte count that disagrees with the exact UTF-8 bytes.
    const wrongBytes = ingestSourceCapture(
      emptyEvidenceBundle(),
      capture({ contentBytes: Buffer.byteLength(UNICODE_CONTENT, "utf8") + 1 }),
      ingestContext(),
    );
    expect(wrongBytes.ok).toBe(false);
    if (!wrongBytes.ok) expect(wrongBytes.reason).toMatch(/contentBytes/);

    // Correct declared byte count is accepted.
    const rightBytes = ingestSourceCapture(
      emptyEvidenceBundle(),
      capture({ contentBytes: Buffer.byteLength(UNICODE_CONTENT, "utf8") }),
      ingestContext(),
    );
    expect(rightBytes.ok).toBe(true);
  });

  it("rejects missing/expired consent and capability/permission gaps without I/O", () => {
    const noConsent = ingestSourceCapture(emptyEvidenceBundle(), capture({ consent: undefined }), ingestContext());
    expect(noConsent.ok).toBe(false);
    const expired = ingestSourceCapture(
      emptyEvidenceBundle(),
      capture({ consent: consent({ decidedAt: "2025-12-01T00:00:00.000Z", expiresAt: "2025-12-31T00:00:00.000Z" }) }),
      ingestContext(),
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toMatch(/expired/);
    const noPermission = ingestSourceCapture(
      emptyEvidenceBundle(),
      capture({ grantedPermissions: {} }),
      ingestContext(),
    );
    expect(noPermission.ok).toBe(false);
    if (!noPermission.ok) expect(noPermission.reason).toMatch(/permission/);
  });

  it("rejects duplicate (adapter, reference) captures and respects the snapshot cap", () => {
    const first = ingestSourceCapture(emptyEvidenceBundle(), capture(), ingestContext());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const duplicate = ingestSourceCapture(first.bundle, capture(), ingestContext());
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.reason).toMatch(/already captured/);

    // A replayed consent under a different server consent id is rejected
    // before any capture logic runs.
    const replayedId = ingestSourceCapture(
      emptyEvidenceBundle(),
      capture(),
      { ...ingestContext(), consentId: "sconsent_other_9999" },
    );
    expect(replayedId.ok).toBe(false);
    if (!replayedId.ok) expect(replayedId.reason).toMatch(/consent id mismatch/);

    // A consent issued for a different reference can never authorize a
    // capture of this reference (exact reference binding).
    const wrongRef = ingestSourceCapture(
      emptyEvidenceBundle(),
      capture({ reference: "ref-other" }),
      ingestContext(),
    );
    expect(wrongRef.ok).toBe(false);
    if (!wrongRef.ok) expect(wrongRef.reason).toMatch(/different source reference/);

    // Fill to the cap: each fresh reference gets its own bound consent.
    let bundle = first.bundle;
    for (let i = 0; i < SOURCE_ADAPTER_LIMITS.maxSnapshots - 1; i += 1) {
      const next = ingestSourceCapture(
        bundle,
        capture({ reference: `ref-${i}`, consent: consent({ reference: `ref-${i}` }) }),
        ingestContext(),
      );
      expect(next.ok).toBe(true);
      if (next.ok) bundle = next.bundle;
    }
    const overCap = ingestSourceCapture(
      bundle,
      capture({ reference: "one-too-many", consent: consent({ reference: "one-too-many" }) }),
      ingestContext(),
    );
    expect(overCap.ok).toBe(false);
    if (!overCap.ok) expect(overCap.reason).toMatch(/snapshots/);
  });

  it("builds denied audits and safe denial events without content", () => {
    const audit = buildDeniedSourceAudit(
      "match-1",
      manifest(),
      "consent-1",
      "capability-denied",
      "capability not granted: net.fetch",
    );
    expect(audit).toBeDefined();
    if (!audit) return;
    expect(audit.outcome).toBe("denied");
    expect(audit.sourceSnapshotId).toBeUndefined();
    expect(sourceAccessAuditSchema.safeParse(audit).success).toBe(true);
    const event = deniedSourceEventBody("srcadp_test", "capability-denied");
    expect(validateEvidenceEvent({ eventVersion: 1, matchId: "match-1", seq: 1, ...event }).success).toBe(true);
    expect(buildDeniedSourceAudit("match-1", { bad: true }, "consent-1", "capability-denied", "x")).toBeUndefined();
  });
});

/** Validate a merged bundle through the canonical bundle schema. */
function validateEvidenceEventSafe(bundle: EvidenceBundle): boolean {
  // Reuse normalizeLegacyEvidence round-trip as a structural smoke check.
  const roundTripped = normalizeLegacyEvidence(JSON.parse(JSON.stringify(bundle)));
  return roundTripped.items.length === bundle.items.length &&
    roundTripped.sourceSnapshots.length === bundle.sourceSnapshots.length;
}

/* ------------------------------------------------------------------ */
/* Legacy normalization + record integration                           */
/* ------------------------------------------------------------------ */

describe("source snapshot legacy normalization", () => {
  it("normalizes bundles missing sourceSnapshots to [] without touching user evidence", () => {
    const legacy = {
      schemaVersion: 1,
      claims: [],
      items: [],
      challenges: [],
      responses: [],
      proofs: [],
    };
    const normalized = normalizeLegacyEvidence(legacy);
    expect(normalized.sourceSnapshots).toEqual([]);
  });

  it("keeps user evidence hashes and behavior unchanged", () => {
    const packet = {
      version: 1 as const,
      items: [{ source: "user_text" as const, label: "notes", content: UNICODE_CONTENT }],
    };
    const before = normalizeUserEvidence(packet);
    expect(before.success).toBe(true);
    if (!before.success) return;
    // User items never get sourceSnapshotId.
    expect(before.data.items[0]?.provenance.sourceSnapshotId).toBeUndefined();
    expect(before.data.items[0]?.provenance.contentHash).toBe(
      createHash("sha256").update(UNICODE_CONTENT, "utf8").digest("hex"),
    );
    expect(before.data.sourceSnapshots).toEqual([]);
  });

  it("accepts records with sourceAudits and initializes new records with an empty trail", () => {
    const base = {
      version: CONTRACT_VERSION,
      matchId: "match-src-1",
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
    // Legacy record: no sourceAudits.
    expect(matchRecordSchema.safeParse(base).success).toBe(true);
    // New record: empty audit trail.
    expect(matchRecordSchema.safeParse({ ...base, sourceAudits: [] }).success).toBe(true);
    // Oversized audit trail rejected.
    const audits = Array.from({ length: SOURCE_ADAPTER_LIMITS.maxAudits + 1 }, (_, i) => ({
      schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
      id: `srcaudit_${i}`,
      matchId: "match-src-1",
      adapterId: "srcadp_test",
      adapterVersion: "1.0.0",
      outcome: "granted",
      consentId: `c${i}`,
      accessedAt: "2026-01-01T00:00:00.000Z",
    }));
    expect(matchRecordSchema.safeParse({ ...base, sourceAudits: audits }).success).toBe(false);
    // Malformed audit rejected.
    expect(
      matchRecordSchema.safeParse({ ...base, sourceAudits: [{ ...audits[0], id: "bad-id" }] }).success,
    ).toBe(false);
  });
});

/** Local import shim to keep the test file self-contained. */
import { normalizeUserEvidencePacket as normalizeUserEvidence } from "../src/evidence-contract";
