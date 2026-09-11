/**
 * Source-adapter contract (v0.4 F10-09/F10-10 foundation).
 *
 * Strict Zod schemas + pure helpers for the safe source-adapter slice:
 * explicit-user-action-only adapters producing immutable, hash-pinned source
 * snapshots with server-issued, replay-proof consent. NO adapter
 * implementation, network, HTTP, DNS, filesystem, tools, or refresh logic
 * lives here — only validation and derivation.
 *
 * Safety properties enforced below:
 * - Unknown fields rejected everywhere (strict objects).
 * - References are safe: no control characters, no newlines, no URL
 *   credentials (`user:pass@`), no filesystem paths.
 * - Versions/ids use canonical prefixes; schema versions are pinned
 *   (unknown versions rejected, never parsed as v1).
 * - `requiresExplicitUserAction` must be exactly `true`.
 * - Freshness ages and timestamps are bounded; future capture instants are
 *   rejected.
 * - Metadata is bounded and credential-like keys are rejected.
 * - Only text content types are accepted.
 * - Hashes are exactly lowercase 64-hex SHA-256; the ingest path recomputes
 *   and verifies them against the exact UTF-8 bytes.
 * - Snapshot integrity is RECOMPUTED from stored content: hash, UTF-8 byte
 *   count, freshness derivation, and no future capture are verified before
 *   persistence/import/proof — declared fields are never trusted.
 */
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import type {
  SourceAdapterManifest,
  SourceConsent,
  SourceSnapshot,
} from "@arena/types";

/** Independent source-adapter schema version (separate from CONTRACT_VERSION). */
export const SOURCE_ADAPTER_SCHEMA_VERSION = 1 as const;

/** Hard limits for the source-adapter slice. */
export const SOURCE_ADAPTER_LIMITS = Object.freeze({
  /** Max chars for ids (adapterId, snapshot id, audit id, consentId). */
  idChars: 128,
  /** Max chars for adapter version tokens. */
  versionChars: 32,
  /** Max chars for display names. */
  displayNameChars: 128,
  /** Max chars for source references. */
  referenceChars: 2000,
  /** Max chars for content-type tokens. */
  contentTypeChars: 100,
  /** Max UTF-8 bytes for one snapshot's captured content. */
  maxContentBytes: 16 * 1024,
  /** Max chars for bounded detail/reason strings. */
  detailChars: 500,
  /** Max metadata entries per snapshot. */
  metadataEntries: 16,
  /** Max chars for a metadata value. */
  metadataValueChars: 500,
  /** Max snapshots per evidence bundle. */
  maxSnapshots: 8,
  /** Max audits persisted per match record. */
  maxAudits: 8,
  /** Max requested-capability keys per manifest. */
  maxCapabilityKeys: 8,
  /** Max required permissions per manifest. */
  maxPermissions: 4,
  /** Min freshness age in seconds (1 day is the coarsest sane minimum). */
  minMaxAgeSeconds: 60,
  /** Max freshness age in seconds (365 days). */
  maxMaxAgeSeconds: 31_536_000,
  /** Max skew (seconds) allowed between capture and validation clocks. */
  clockSkewSeconds: 300,
} as const);

/* ------------------------------------------------------------------ */
/* Primitive schemas                                                   */
/* ------------------------------------------------------------------ */

const sourceBoundedId = z
  .string()
  .trim()
  .min(1)
  .max(SOURCE_ADAPTER_LIMITS.idChars)
  .regex(/^[A-Za-z0-9_-]+$/, "id may only contain [A-Za-z0-9_-]");

const adapterIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SOURCE_ADAPTER_LIMITS.idChars)
  .regex(/^srcadp_[A-Za-z0-9_-]+$/, "adapterId must start with srcadp_");

const snapshotIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SOURCE_ADAPTER_LIMITS.idChars)
  .regex(/^srcsnap_[A-Za-z0-9_-]+$/, "snapshot id must start with srcsnap_");

const auditIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SOURCE_ADAPTER_LIMITS.idChars)
  .regex(/^srcaudit_[A-Za-z0-9_-]+$/, "audit id must start with srcaudit_");

const adapterVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(SOURCE_ADAPTER_LIMITS.versionChars)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "adapter version must be a bounded token");

const consentIdSchema = z
  .string()
  .min(1)
  .max(SOURCE_ADAPTER_LIMITS.idChars)
  .regex(/^sconsent_[A-Za-z0-9_-]+$/, "consentId must start with sconsent_");

const lowercaseSha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "contentHash must be a lowercase 64-hex SHA-256");

const sourceTimestamp = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), "invalid ISO timestamp");

/** No control characters, no newlines, no URL credentials, no paths. */
const safeReference = z
  .string()
  .trim()
  .min(1)
  .max(SOURCE_ADAPTER_LIMITS.referenceChars)
  .refine(
    (value) => !/[\u0000-\u001F\u007F]/.test(value),
    "reference contains control characters or newlines",
  )
  .refine((value) => !value.includes("\\"), {
    message: "reference must not be a filesystem path",
  })
  .refine((value) => !/^[A-Za-z]:[\\/]/.test(value), {
    message: "reference must not be a filesystem path",
  })
  .refine(
    (value) => !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*@/.test(value),
    "reference must not contain URL credentials",
  )
  .refine(
    (value) =>
      // Bare locator tokens or credential-free http(s) URLs only.
      /^[A-Za-z0-9._: -]+$/.test(value) || /^https?:\/\/[^\s@]+$/i.test(value),
    "reference must be a bare locator or a credential-free http(s) URL",
  );

/** Credential-like metadata keys are rejected outright. */
const CREDENTIAL_LIKE_KEY =
  /(pass(word)?|secret|token|api[-_]?key|authorization|auth|credential|cookie|session)/i;

const sourceMetadataValue = z.union([
  z.string().max(SOURCE_ADAPTER_LIMITS.metadataValueChars),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const safeSourceMetadata = z
  .record(z.string().min(1).max(SOURCE_ADAPTER_LIMITS.idChars), sourceMetadataValue)
  .refine(
    (metadata) => Object.keys(metadata).length <= SOURCE_ADAPTER_LIMITS.metadataEntries,
    `metadata exceeds ${SOURCE_ADAPTER_LIMITS.metadataEntries} entries`,
  )
  .refine(
    (metadata) => !Object.keys(metadata).some((key) => CREDENTIAL_LIKE_KEY.test(key)),
    "metadata contains a credential-like key",
  )
  .optional();

/** Only text content types are accepted in this slice. */
const TEXT_CONTENT_TYPES = Object.freeze([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

const textContentType = z
  .string()
  .trim()
  .min(1)
  .max(SOURCE_ADAPTER_LIMITS.contentTypeChars)
  .refine(
    (value) => (TEXT_CONTENT_TYPES as readonly string[]).includes(value),
    `contentType must be one of: ${TEXT_CONTENT_TYPES.join(", ")}`,
  );

/* ------------------------------------------------------------------ */
/* Manifest / request / consent                                        */
/* ------------------------------------------------------------------ */

export const sourceFreshnessPolicySchema = z
  .strictObject({
    mode: z.enum(["snapshot-only", "reuse-if-fresh", "refresh-on-user-action"]),
    maxAgeSeconds: z.number().int().min(SOURCE_ADAPTER_LIMITS.minMaxAgeSeconds).max(SOURCE_ADAPTER_LIMITS.maxMaxAgeSeconds),
  })
  .refine(
    (policy) => policy.mode === "snapshot-only" || policy.maxAgeSeconds > 0,
    "non-snapshot-only policies require a positive maxAgeSeconds",
  );

export const sourceAdapterManifestSchema = z.strictObject({
  schemaVersion: z.literal(SOURCE_ADAPTER_SCHEMA_VERSION),
  adapterId: adapterIdSchema,
  version: adapterVersionSchema,
  kind: z.enum(["external-source", "dataset", "document"]),
  displayName: z.string().trim().min(1).max(SOURCE_ADAPTER_LIMITS.displayNameChars),
  requestedCapabilities: z
    .record(z.string().min(1).max(SOURCE_ADAPTER_LIMITS.idChars), z.boolean())
    .refine(
      (capabilities) => Object.keys(capabilities).length <= SOURCE_ADAPTER_LIMITS.maxCapabilityKeys,
      `requestedCapabilities exceeds ${SOURCE_ADAPTER_LIMITS.maxCapabilityKeys} keys`,
    ),
  requiredPermissions: z
    .array(z.enum(["fs.read", "net.fetch", "process.spawn"]))
    .max(SOURCE_ADAPTER_LIMITS.maxPermissions),
  requiresExplicitUserAction: z.literal(true),
});

export const sourceAdapterRequestSchema = z.strictObject({
  schemaVersion: z.literal(SOURCE_ADAPTER_SCHEMA_VERSION),
  manifest: sourceAdapterManifestSchema,
  description: z.string().trim().min(1).max(SOURCE_ADAPTER_LIMITS.detailChars),
});

export const sourceConsentSchema = z
  .strictObject({
    schemaVersion: z.literal(SOURCE_ADAPTER_SCHEMA_VERSION),
    // Server-issued consent id — a client-crafted id can never pass the gate.
    consentId: consentIdSchema,
    adapterId: adapterIdSchema,
    // Pinned adapter version (not a range) so a consent can never be replayed
    // across adapter versions.
    adapterVersion: adapterVersionSchema,
    // Optional match/request binding: when present, the gate requires an
    // exact match so a consent cannot be replayed across matches/requests.
    matchId: z.string().trim().min(1).max(SOURCE_ADAPTER_LIMITS.idChars).optional(),
    requestId: z.string().trim().min(1).max(SOURCE_ADAPTER_LIMITS.idChars).optional(),
    // The exact reference the user approved; ingest must capture this
    // reference (or a bundle capture with the same reference already exists).
    reference: safeReference,
    granted: z.boolean(),
    // Server-copied request snapshot; the gate compares it with the manifest.
    requestedCapabilities: z.record(
      z.string().min(1).max(SOURCE_ADAPTER_LIMITS.idChars),
      z.boolean(),
    ),
    // Server-derived grant snapshot; must cover the requested capabilities.
    grantedCapabilities: z.record(
      z.string().min(1).max(SOURCE_ADAPTER_LIMITS.idChars),
      z.boolean(),
    ),
    decidedAt: sourceTimestamp,
    expiresAt: sourceTimestamp,
    // Explicit user-action semantics — silently-false grants are invalid.
    confirmedByUserAction: z.literal(true),
  })
  .refine(
    (consent) => Date.parse(consent.expiresAt) > Date.parse(consent.decidedAt),
    "consent expiresAt must be after decidedAt",
  );

/* ------------------------------------------------------------------ */
/* Snapshot / audit                                                    */
/* ------------------------------------------------------------------ */

export const sourceSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(SOURCE_ADAPTER_SCHEMA_VERSION),
    id: snapshotIdSchema,
    adapterId: adapterIdSchema,
    adapterVersion: adapterVersionSchema,
    kind: z.enum(["external-source", "dataset", "document"]),
    reference: safeReference,
    contentType: textContentType,
    contentBytes: z.number().int().min(1).max(SOURCE_ADAPTER_LIMITS.maxContentBytes),
    contentHash: lowercaseSha256,
    content: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value, "utf8") <= SOURCE_ADAPTER_LIMITS.maxContentBytes,
        `snapshot content exceeds ${SOURCE_ADAPTER_LIMITS.maxContentBytes} UTF-8 bytes`,
      ),
    capturedAt: sourceTimestamp,
    freshness: sourceFreshnessPolicySchema,
    freshUntil: sourceTimestamp.nullable(),
    metadata: safeSourceMetadata,
  })
  .superRefine((snapshot, ctx) => {
    // Integrity is recomputed from the stored content — declared fields are
    // never trusted. Mismatches are rejected before persistence/import/proof.
    const actualBytes = Buffer.byteLength(snapshot.content, "utf8");
    if (snapshot.contentBytes !== actualBytes) {
      ctx.addIssue({
        code: "custom",
        path: ["contentBytes"],
        message: `contentBytes ${snapshot.contentBytes} does not match the stored content's UTF-8 byte count (${actualBytes})`,
      });
    }
    const actualHash = createHash("sha256").update(snapshot.content, "utf8").digest("hex");
    if (snapshot.contentHash !== actualHash) {
      ctx.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: "contentHash does not match the SHA-256 of the stored snapshot content",
      });
    }
    // freshUntil must agree with the freshness policy's derivation.
    const derived = deriveFreshUntil(snapshot.freshness, snapshot.capturedAt);
    if (snapshot.freshUntil !== derived) {
      ctx.addIssue({
        code: "custom",
        path: ["freshUntil"],
        message: "freshUntil does not match the freshness policy applied to capturedAt",
      });
    }
    // No future capture instants (bounded clock-skew allowance).
    const capturedMs = Date.parse(snapshot.capturedAt);
    if (capturedMs > Date.now() + SOURCE_ADAPTER_LIMITS.clockSkewSeconds * 1000) {
      ctx.addIssue({
        code: "custom",
        path: ["capturedAt"],
        message: "capturedAt is in the future",
      });
    }
  });

export const sourceAccessAuditSchema = z.strictObject({
  schemaVersion: z.literal(SOURCE_ADAPTER_SCHEMA_VERSION),
  id: auditIdSchema,
  matchId: z.string().trim().min(1).max(128),
  adapterId: adapterIdSchema,
  adapterVersion: adapterVersionSchema,
  outcome: z.enum(["granted", "denied", "expired", "failed"]),
  sourceSnapshotId: snapshotIdSchema.optional(),
  consentId: sourceBoundedId,
  accessedAt: sourceTimestamp,
  detail: z.string().trim().max(SOURCE_ADAPTER_LIMITS.detailChars).optional(),
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Exact UTF-8 SHA-256 of a string (the only accepted hash derivation). */
export function computeSourceContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Exact UTF-8 byte length of a string. */
export function sourceContentBytes(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

/**
 * Derive `freshUntil` from a freshness policy and capture instant.
 * `snapshot-only` material never goes stale (`null`); the other modes get
 * `capturedAt + maxAgeSeconds` as an ISO 8601 instant.
 */
export function deriveFreshUntil(
  policy: { readonly mode: "snapshot-only" | "reuse-if-fresh" | "refresh-on-user-action"; readonly maxAgeSeconds: number },
  capturedAt: string,
): string | null {
  if (policy.mode === "snapshot-only") return null;
  const capturedMs = Date.parse(capturedAt);
  if (Number.isNaN(capturedMs)) return null;
  return new Date(capturedMs + policy.maxAgeSeconds * 1000).toISOString();
}

/**
 * Freshness check: `snapshot-only` snapshots are always fresh (they never
 * change); others are fresh while `now <= freshUntil`. A missing/invalid
 * `freshUntil` for a time-bounded policy counts as stale (fail closed).
 */
export function isSourceSnapshotFresh(
  snapshot: Pick<SourceSnapshot, "freshness" | "freshUntil">,
  now: string | number = Date.now(),
): boolean {
  if (snapshot.freshness.mode === "snapshot-only") return true;
  if (snapshot.freshUntil === null) return false;
  const untilMs = Date.parse(snapshot.freshUntil);
  if (Number.isNaN(untilMs)) return false;
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (Number.isNaN(nowMs)) return false;
  return nowMs <= untilMs;
}

/* ------------------------------------------------------------------ */
/* Consent / capability gates                                          */
/* ------------------------------------------------------------------ */

export type SourceGateCheck =
  | { readonly ok: true; readonly manifest: SourceAdapterManifest; readonly consent: SourceConsent }
  | { readonly ok: false; readonly reason: "consent-missing" | "consent-expired" | "consent-replayed" | "capability-denied" | "permission-unmet" | "invalid"; readonly error: string };

/** Optional binding context for the gate (replay/mismatch protection). */
export interface SourceGateContext {
  /** Match the access is being attempted in (exact match required when the consent carries one). */
  readonly matchId?: string;
  /** Request id this access is fulfilling (exact match required when the consent carries one). */
  readonly requestId?: string;
  /** Exact reference about to be captured (exact match required when the consent carries one). */
  readonly reference?: string;
}

/**
 * Validate the consent/capability gate for one adapter access:
 * manifest and consent must be schema-valid and version-pinned, consent must
 * be granted with explicit user-action semantics, unexpired (at `now`), for
 * the same adapter AND exact adapter version, bound to the same
 * match/request/reference identity, and its granted capabilities must cover
 * every requested capability (which must itself match the server-copied
 * request snapshot). Required permissions must all be granted in
 * `grantedPermissions` (the sandbox's effective capability set —
 * deny-by-default). Any identity mismatch is a replay attempt and is
 * rejected — never treated as "no consent".
 */
export function validateSourceGate(
  manifest: unknown,
  consent: unknown,
  grantedPermissions: Readonly<Partial<Record<string, boolean>>>,
  now: string | number = Date.now(),
  context: SourceGateContext = {},
): SourceGateCheck {
  const manifestParsed = sourceAdapterManifestSchema.safeParse(manifest);
  if (!manifestParsed.success) {
    const issue = manifestParsed.error.issues[0];
    return { ok: false, reason: "invalid", error: issue?.message ?? "invalid manifest" };
  }
  const consentParsed = sourceConsentSchema.safeParse(consent);
  if (!consentParsed.success) {
    const issue = consentParsed.error.issues[0];
    return { ok: false, reason: "invalid", error: issue?.message ?? "invalid consent" };
  }
  const m = manifestParsed.data;
  const c = consentParsed.data;
  if (c.adapterId !== m.adapterId) {
    return { ok: false, reason: "consent-replayed", error: "consent is for a different adapter" };
  }
  if (c.adapterVersion !== m.version) {
    return { ok: false, reason: "consent-replayed", error: "consent is pinned to a different adapter version" };
  }
  if (c.matchId !== undefined && context.matchId !== undefined && c.matchId !== context.matchId) {
    return { ok: false, reason: "consent-replayed", error: "consent is bound to a different match" };
  }
  if (c.requestId !== undefined && context.requestId !== undefined && c.requestId !== context.requestId) {
    return { ok: false, reason: "consent-replayed", error: "consent is bound to a different request" };
  }
  if (context.reference !== undefined && c.reference !== context.reference) {
    return { ok: false, reason: "consent-replayed", error: "consent was issued for a different source reference" };
  }
  if (!c.confirmedByUserAction) {
    return { ok: false, reason: "consent-missing", error: "consent lacks explicit user-action confirmation" };
  }
  if (!c.granted) {
    return { ok: false, reason: "consent-missing", error: "user has not granted this adapter" };
  }
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (Number.isNaN(nowMs) || nowMs > Date.parse(c.expiresAt)) {
    return { ok: false, reason: "consent-expired", error: "consent has expired" };
  }
  // The consent's request snapshot must match the manifest exactly — a
  // forged/mutated request snapshot cannot smuggle in capabilities.
  const requestedKeys = Object.keys(m.requestedCapabilities).sort();
  const consentRequestedKeys = Object.keys(c.requestedCapabilities).sort();
  if (
    requestedKeys.length !== consentRequestedKeys.length ||
    requestedKeys.some((key, index) => key !== consentRequestedKeys[index] || m.requestedCapabilities[key] !== c.requestedCapabilities[key])
  ) {
    return { ok: false, reason: "consent-replayed", error: "consent request snapshot does not match the manifest capabilities" };
  }
  for (const [capability, wanted] of Object.entries(m.requestedCapabilities)) {
    if (wanted === true && c.grantedCapabilities[capability] !== true) {
      return {
        ok: false,
        reason: "capability-denied",
        error: `capability not granted: ${capability}`,
      };
    }
  }
  for (const permission of m.requiredPermissions) {
    if (grantedPermissions[permission] !== true) {
      return {
        ok: false,
        reason: "permission-unmet",
        error: `required permission not granted: ${permission}`,
      };
    }
  }
  return { ok: true, manifest: m, consent: c };
}

/** Server-side id factories (clients never choose ids). */
export function newSourceSnapshotId(): string {
  return `srcsnap_${cryptoRandomId()}`;
}

export function newSourceAccessAuditId(): string {
  return `srcaudit_${cryptoRandomId()}`;
}

/** Server-issued consent id factory (clients never choose consent ids). */
export function newSourceConsentId(): string {
  return `sconsent_${cryptoRandomId()}`;
}

/**
 * Structural validation of a consent record outside the gate (e.g. for
 * pre-checks); strict, so unknown fields never slip through.
 */
export function validateSourceConsent(input: unknown): SourceConsent | undefined {
  const parsed = sourceConsentSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Server-side issuance of a consent record for one adapter request: copies
 * the manifest's identity/request snapshot, derives the capability grant,
 * and stamps the validity window. Pure; no I/O. `reference` pins the exact
 * source the user approved; `confirmedByUserAction` must be true — callers
 * only invoke this after the explicit user action.
 */
export function issueSourceConsent(
  request: unknown,
  options: {
    readonly reference: string;
    readonly matchId?: string;
    readonly requestId?: string;
    readonly decidedAt?: string;
    /** Consent lifetime in seconds (bounded to the freshness max). */
    readonly ttlSeconds?: number;
  },
): { readonly ok: true; readonly consent: SourceConsent } | { readonly ok: false; readonly error: string } {
  const requestParsed = sourceAdapterRequestSchema.safeParse(request);
  if (!requestParsed.success) {
    return { ok: false, error: requestParsed.error.issues[0]?.message ?? "invalid adapter request" };
  }
  if (typeof options.reference !== "string" || !safeReference.safeParse(options.reference).success) {
    return { ok: false, error: "invalid consent reference" };
  }
  const m = requestParsed.data.manifest;
  const decidedAt = options.decidedAt ?? new Date().toISOString();
  const decidedMs = Date.parse(decidedAt);
  if (Number.isNaN(decidedMs)) {
    return { ok: false, error: "invalid decidedAt" };
  }
  const ttl = options.ttlSeconds ?? 3600;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > SOURCE_ADAPTER_LIMITS.maxMaxAgeSeconds) {
    return { ok: false, error: "consent ttlSeconds out of bounds" };
  }
  const grantedCapabilities: Record<string, boolean> = {};
  for (const [capability, wanted] of Object.entries(m.requestedCapabilities)) {
    grantedCapabilities[capability] = wanted === true;
  }
  return {
    ok: true,
    consent: {
      schemaVersion: SOURCE_ADAPTER_SCHEMA_VERSION,
      consentId: newSourceConsentId(),
      adapterId: m.adapterId,
      adapterVersion: m.version,
      ...(options.matchId !== undefined ? { matchId: options.matchId } : {}),
      ...(options.requestId !== undefined ? { requestId: options.requestId } : {}),
      reference: options.reference,
      granted: true,
      requestedCapabilities: { ...m.requestedCapabilities },
      grantedCapabilities,
      decidedAt,
      expiresAt: new Date(decidedMs + ttl * 1000).toISOString(),
      confirmedByUserAction: true,
    },
  };
}

function cryptoRandomId(): string {
  // Keep this module dependency-light: node:crypto's randomUUID.
  return randomUUID().replace(/-/g, "");
}
