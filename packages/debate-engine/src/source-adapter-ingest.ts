/**
 * Source-adapter ingest (v0.4 F10-09/F10-10 foundation).
 *
 * Pure, I/O-free merge of one validated adapter capture into the current
 * evidence bundle. This module NEVER calls adapters, the network, the
 * filesystem, or any tool — the caller performs the (already consented)
 * capture and hands over the raw result; everything below is validation,
 * hashing, and immutable record construction.
 *
 * Guarantees:
 * - Manifest, consent, and gate are re-validated (explicit user action,
 *   granted consent, unexpired, exact adapter id/version, match/request/
 *   reference binding, capabilities/permissions covered).
 * - The consent record's `consentId` must exactly match the server-issued
 *   consent id in the ingest context — replaying a consent under another id
 *   is rejected.
 * - The adapter result's reference/content/hash/bytes are verified against
 *   the exact UTF-8 bytes; a mismatch rejects the whole capture.
 * - The FULLY DERIVED SourceSnapshot is re-validated through the strict
 *   schema (which recomputes hash, byte count, freshness derivation, and
 *   rejects future captures) BEFORE any bundle merge; a malformed derived
 *   snapshot rejects the whole capture.
 * - The resulting EvidenceBundle is validated through the canonical bundle
 *   schema before being returned — persistence never sees an invalid bundle.
 * - The created EvidenceItem is `unverified`, carries `sourceSnapshotId`,
 *   and gets server-assigned ids/timestamps.
 * - The SourceSnapshot and SourceAccessAudit are immutable records.
 * - Existing bundle entities are preserved; duplicate snapshot ids, duplicate
 *   evidence ids, and duplicate (adapter, reference) captures are rejected.
 * - Only safe lifecycle event bodies (ids/enums, never content/secrets).
 */
import { randomUUID } from "node:crypto";
import type {
  EvidenceBundle,
  EvidenceEventBody,
  EvidenceItem,
  SourceAccessAudit,
  SourceSnapshot,
} from "@arena/types";
import {
  SOURCE_ADAPTER_SCHEMA_VERSION,
  SOURCE_ADAPTER_LIMITS,
  computeSourceContentHash,
  sourceContentBytes,
  deriveFreshUntil,
  newSourceAccessAuditId,
  newSourceSnapshotId,
  sourceAdapterManifestSchema,
  sourceConsentSchema,
  sourceSnapshotSchema,
  validateSourceGate,
} from "./source-adapter-contract";
import { validateEvidenceBundle } from "./evidence-contract";

/** Raw capture handed over by the caller after the user's explicit action. */
export interface SourceCaptureInput {
  /** The registered manifest the capture ran under. */
  readonly manifest: unknown;
  /** The validated consent decision for this capture. */
  readonly consent: unknown;
  /** Bounded source reference (already schema-safe). */
  readonly reference: string;
  /** Captured text content (bounded to `SOURCE_ADAPTER_LIMITS.maxContentBytes`). */
  readonly content: string;
  /** Content type claimed by the adapter (text-only). */
  readonly contentType: string;
  /** Hash claimed by the adapter; verified against recomputation. */
  readonly contentHash: string;
  /** Byte count claimed by the adapter; verified against recomputation when present. */
  readonly contentBytes?: number;
  /** Freshness policy under which the capture was made. */
  readonly freshness: { readonly mode: "snapshot-only" | "reuse-if-fresh" | "refresh-on-user-action"; readonly maxAgeSeconds: number };
  /** Bounded, credential-free metadata (optional). */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  /** Effective sandbox permissions granted for this capture (deny-by-default). */
  readonly grantedPermissions: Readonly<Partial<Record<string, boolean>>>;
}

export interface SourceIngestContext {
  readonly matchId: string;
  /** The exact server-issued consent id the capture runs under. */
  readonly consentId: string;
  /** Validation instant (defaults to now); captures in the future are rejected. */
  readonly now?: string;
}

export type SourceIngestResult =
  | {
      readonly ok: true;
      readonly bundle: EvidenceBundle;
      readonly snapshot: SourceSnapshot;
      readonly audit: SourceAccessAudit;
      readonly eventBodies: readonly EvidenceEventBody[];
    }
  | { readonly ok: false; readonly reason: string };

/** Maximum clock skew tolerated between capture and validation (ms). */
const CLOCK_SKEW_MS = SOURCE_ADAPTER_LIMITS.clockSkewSeconds * 1000;

/**
 * Merge one validated adapter capture into `bundle`. Pure: no adapter calls,
 * no I/O, no refresh. Returns a NEW bundle with the snapshot, evidence item,
 * and audit appended, plus the safe lifecycle event bodies to persist.
 */
export function ingestSourceCapture(
  bundle: EvidenceBundle,
  capture: SourceCaptureInput,
  context: SourceIngestContext,
): SourceIngestResult {
  const now = context.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return { ok: false, reason: "invalid validation timestamp" };

  // 1. Manifest + consent gate (explicit action, granted, unexpired, exact
  //    adapter id/version, match/request/reference binding, capabilities +
  //    permissions covered). The gate runs against the capture's reference so
  //    a consent issued for another reference can never authorize it.
  const gate = validateSourceGate(
    capture.manifest,
    capture.consent,
    capture.grantedPermissions,
    nowMs,
    { matchId: context.matchId, reference: capture.reference },
  );
  if (!gate.ok) {
    return { ok: false, reason: gate.error };
  }
  const manifest = gate.manifest;

  // 2. The consent record's server-issued id must exactly match the consent
  //    id in the ingest context — replaying a consent under another id (or a
  //    forged consent) is rejected before anything else is trusted.
  const consentParsed = sourceConsentSchema.safeParse(capture.consent);
  if (!consentParsed.success) {
    return { ok: false, reason: "invalid consent" };
  }
  if (consentParsed.data.consentId !== context.consentId) {
    return { ok: false, reason: "consent id mismatch" };
  }

  // 3. Verify the capture: hash/bytes against the exact UTF-8 content.
  const actualHash = computeSourceContentHash(capture.content);
  if (actualHash !== capture.contentHash) {
    return { ok: false, reason: "content hash mismatch" };
  }
  const actualBytes = sourceContentBytes(capture.content);
  if (actualBytes > SOURCE_ADAPTER_LIMITS.maxContentBytes) {
    return { ok: false, reason: `snapshot content exceeds ${SOURCE_ADAPTER_LIMITS.maxContentBytes} UTF-8 bytes` };
  }
  if (capture.content.trim().length === 0) {
    return { ok: false, reason: "snapshot content is empty" };
  }
  if (!/^[0-9a-f]{64}$/.test(capture.contentHash)) {
    return { ok: false, reason: "contentHash must be a lowercase 64-hex SHA-256" };
  }
  const declaredBytes = capture.contentBytes;
  if (declaredBytes !== undefined && declaredBytes !== actualBytes) {
    return { ok: false, reason: "declared contentBytes does not match the exact UTF-8 byte count" };
  }

  // 4. The capture instant is server-assigned (never future): `now`.
  const capturedAt = now;

  // 5. Duplicate checks: snapshot id (fresh per ingest), evidence id, and
  //    (adapterId, reference) captures already present in the bundle.
  const snapshotId = newSourceSnapshotId();
  const existingIds = new Set<string>([
    ...(bundle.claims ?? []).map((claim) => claim.id),
    ...(bundle.items ?? []).map((item) => item.id),
    ...(bundle.challenges ?? []).map((challenge) => challenge.id),
    ...(bundle.responses ?? []).map((response) => response.id),
  ]);
  if ((bundle.sourceSnapshots ?? []).length >= SOURCE_ADAPTER_LIMITS.maxSnapshots) {
    return { ok: false, reason: `bundle already holds ${SOURCE_ADAPTER_LIMITS.maxSnapshots} source snapshots` };
  }
  const duplicateCapture = (bundle.sourceSnapshots ?? []).some(
    (snapshot) => snapshot.adapterId === manifest.adapterId && snapshot.reference === capture.reference,
  );
  if (duplicateCapture) {
    return { ok: false, reason: `source already captured: ${capture.reference}` };
  }

  // 6. Immutable snapshot record (server-assigned id, derived freshness).
  //    The fully derived snapshot is then re-validated through the strict
  //    schema — hash, byte count, freshness derivation, reference/contentType/
  //    metadata safety, and no future capture are all recomputed from the
  //    stored content; a mismatch rejects the whole capture before any
  //    persistence/import/merge can see it.
  const snapshot: SourceSnapshot = {
    schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
    id: snapshotId,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.version,
    kind: manifest.kind,
    reference: capture.reference,
    contentType: capture.contentType,
    contentBytes: actualBytes,
    contentHash: actualHash,
    content: capture.content,
    capturedAt,
    freshness: capture.freshness,
    freshUntil: deriveFreshUntil(capture.freshness, capturedAt),
    ...(capture.metadata !== undefined ? { metadata: capture.metadata } : {}),
  };
  const snapshotValidated = sourceSnapshotSchema.safeParse(snapshot);
  if (!snapshotValidated.success) {
    const issue = snapshotValidated.error.issues[0];
    return {
      ok: false,
      reason: `derived source snapshot rejected: ${issue?.message ?? "invalid snapshot"}`,
    };
  }

  // 7. Unverified evidence item pointing at the snapshot.
  const evidenceId = `ev_${randomUUID()}`;
  const item: EvidenceItem = {
    id: evidenceId,
    text: capture.content,
    claimIds: [],
    provenance: {
      kind: "external-source",
      origin: manifest.adapterId,
      reference: capture.reference,
      retrievedAt: capturedAt,
      contentHash: actualHash,
      extractionMethod: `source-adapter:${manifest.adapterId}`,
      sourceSnapshotId: snapshotId,
    },
    status: "unverified",
    createdAt: capturedAt,
  };
  if (existingIds.has(evidenceId)) {
    return { ok: false, reason: "duplicate evidence id" };
  }

  // 8. Immutable audit record (no content, no secrets).
  const audit: SourceAccessAudit = {
    schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
    id: newSourceAccessAuditId(),
    matchId: context.matchId,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.version,
    outcome: "granted",
    sourceSnapshotId: snapshotId,
    consentId: context.consentId,
    accessedAt: capturedAt,
  };

  // 9. Safe lifecycle event bodies (ids/enums only — never content/secrets).
  const eventBodies: EvidenceEventBody[] = [
    { type: "source-snapshot-captured", sourceSnapshotId: snapshotId, adapterId: manifest.adapterId },
    { type: "source-evidence-added", evidenceId, sourceSnapshotId: snapshotId },
  ];

  // 10. Preserve every existing entity; append the new ones. The resulting
  //     bundle is validated through the canonical bundle schema — persistence
  //     never sees an invalid merge.
  const nextBundle: EvidenceBundle = {
    schemaVersion: bundle.schemaVersion,
    claims: bundle.claims ?? [],
    items: [...(bundle.items ?? []), item],
    challenges: bundle.challenges ?? [],
    responses: bundle.responses ?? [],
    proofs: bundle.proofs ?? [],
    sourceSnapshots: [...(bundle.sourceSnapshots ?? []), snapshot],
  };
  const bundleValidated = validateEvidenceBundle(nextBundle);
  if (!bundleValidated.success) {
    return { ok: false, reason: `resulting evidence bundle rejected: ${bundleValidated.error}` };
  }

  return { ok: true, bundle: bundleValidated.data, snapshot, audit, eventBodies };
}

/**
 * Build the audit record for a DENIED access (consent missing/expired,
 * capability denied, permission unmet). Pure; no I/O.
 */
export function buildDeniedSourceAudit(
  matchId: string,
  manifest: unknown,
  consentId: string,
  reason: "consent-missing" | "consent-expired" | "consent-replayed" | "capability-denied" | "permission-unmet",
  detail: string,
  now: string = new Date().toISOString(),
): SourceAccessAudit | undefined {
  const manifestParsed = sourceAdapterManifestSchema.safeParse(manifest);
  if (!manifestParsed.success) return undefined;
  if (consentId.length === 0 || consentId.length > SOURCE_ADAPTER_LIMITS.idChars) return undefined;
  const m = manifestParsed.data;
  return {
    schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
    id: newSourceAccessAuditId(),
    matchId,
    adapterId: m.adapterId,
    adapterVersion: m.version,
    outcome: reason === "consent-expired" ? "expired" : "denied",
    consentId,
    accessedAt: now,
    detail: detail.slice(0, SOURCE_ADAPTER_LIMITS.detailChars),
  };
}

/**
 * Safe lifecycle event body for a denied access (ids/enums only).
 */
export function deniedSourceEventBody(
  adapterId: string,
  reason: "consent-missing" | "consent-expired" | "consent-replayed" | "capability-denied" | "permission-unmet",
): EvidenceEventBody {
  return { type: "source-access-denied", adapterId, reason };
}

// Re-exported for callers that need the raw capture-time skew constant.
export { CLOCK_SKEW_MS };
