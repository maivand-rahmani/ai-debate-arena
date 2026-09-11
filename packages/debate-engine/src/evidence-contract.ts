/**
 * Evidence contract (v0.4 foundation slice).
 *
 * Zod runtime schemas + validators on top of the canonical `@arena/types`
 * evidence/capability shapes. Enforces hard bounds, reference integrity,
 * unique ids, finite challenge budgets, proof-result safety, and
 * deny-by-default capability negotiation.
 *
 * Unknown schema versions are rejected outright — they are never silently
 * re-parsed as v1.
 */
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import {
  SANDBOX_PERMISSIONS,
  type CapabilityRequest,
  type EvidenceBundle,
  type EvidenceEvent,
  type EvidenceItem,
  type ProofResult,
  type SandboxCapabilities,
  type SandboxPermission,
} from "@arena/types";
import {
  sourceSnapshotSchema,
  sourceAccessAuditSchema,
  SOURCE_ADAPTER_LIMITS,
} from "./source-adapter-contract";

/** Persisted source access audits (F10-09/F10-10), re-exported for records. */
export { sourceAccessAuditSchema };
export const SOURCE_AUDITS_MAX = SOURCE_ADAPTER_LIMITS.maxAudits;

/** Independent evidence schema version (does not touch CONTRACT_VERSION). */
export const EVIDENCE_SCHEMA_VERSION = 1 as const;
/** Independent capability schema version. */
export const CAPABILITY_SCHEMA_VERSION = 1 as const;
/** Independent evidence event schema version (separate from transport v:1). */
export const EVIDENCE_EVENT_VERSION = 1 as const;

/* ------------------------------------------------------------------ */
/* Hard limits                                                         */
/* ------------------------------------------------------------------ */

/** Hard limits for evidence payloads (bytes, chars, counts). */
export const EVIDENCE_LIMITS = Object.freeze({
  /** Max chars for ids. */
  idChars: 128,
  /** Max chars for claim/evidence/challenge/response text. */
  textChars: 4000,
  /** Max chars for a single metadata value / proof message. */
  metadataValueChars: 500,
  /** Max metadata entries per entity. */
  metadataEntries: 16,
  /** Max claims per bundle. */
  claims: 200,
  /** Max evidence items per bundle. */
  items: 200,
  /** Max challenges per bundle. */
  challenges: 100,
  /** Max responses per bundle. */
  responses: 300,
  /** Max proof results per bundle. */
  proofs: 200,
  /** Max references per claim/evidence. */
  refsPerEntity: 20,
  /** Max chars for a provenance reference (URI / turn id / locator). */
  provenanceRefChars: 2000,
  /** Max serialized JSON chars for a whole bundle. */
  bundleChars: 512 * 1024,
  /** Max serialized JSON chars for a single evidence event. */
  eventChars: 16 * 1024,
  /** Max challenges one claim may carry. */
  challengesPerClaim: 20,
  /** Max responses one challenge may accept. */
  responsesPerChallenge: 20,
  /** Max immutable source snapshots per bundle (F10-09/F10-10). */
  snapshots: SOURCE_ADAPTER_LIMITS.maxSnapshots,
} as const);

/* ------------------------------------------------------------------ */
/* Primitive schemas                                                   */
/* ------------------------------------------------------------------ */

const boundedId = z
  .string()
  .trim()
  .min(1)
  .max(EVIDENCE_LIMITS.idChars)
  .regex(/^[A-Za-z0-9_-]+$/, "id may only contain [A-Za-z0-9_-]");

const boundedText = z.string().trim().min(1).max(EVIDENCE_LIMITS.textChars);

const metadataValueSchema = z.union([
  z.string().max(EVIDENCE_LIMITS.metadataValueChars),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const boundedMetadata = z
  .record(z.string().min(1).max(EVIDENCE_LIMITS.idChars), metadataValueSchema)
  .refine(
    (metadata) => Object.keys(metadata).length <= EVIDENCE_LIMITS.metadataEntries,
    `metadata exceeds ${EVIDENCE_LIMITS.metadataEntries} entries`,
  )
  .optional();

const isoTimestamp = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), "invalid ISO timestamp");

/** F10-04 product statuses: exactly these five values (v0.4 release gate). */
const evidenceStatusSchema = z.enum([
  "supported",
  "contradicted",
  "insufficient",
  "unverified",
  "unavailable",
]);

const sideSchema = z.enum(["A", "B"]);

/* ------------------------------------------------------------------ */
/* Entity schemas                                                      */
/* ------------------------------------------------------------------ */

export const claimSchema = z.object({
  id: boundedId,
  text: boundedText,
  turnId: boundedId,
  side: sideSchema,
  status: evidenceStatusSchema,
  evidenceIds: z.array(boundedId).max(EVIDENCE_LIMITS.refsPerEntity).readonly(),
  challengeIds: z.array(boundedId).max(EVIDENCE_LIMITS.challengesPerClaim).readonly(),
  metadata: boundedMetadata,
  createdAt: isoTimestamp,
});

/** F10-05 auditable provenance: every field required, bounded, inspectable. */
export const provenanceSchema = z
  .object({
    kind: z.enum([
      "agent-turn",
      "external-source",
      "tool-output",
      "model-knowledge",
      "user-text",
      "user-file",
    ]),
    // User/provider origin: provider id, agent id, tool id, or "user".
    origin: z.string().trim().min(1).max(EVIDENCE_LIMITS.idChars),
    reference: z.string().trim().min(1).max(EVIDENCE_LIMITS.provenanceRefChars),
    // Capture timestamp (ISO 8601) — required for every source kind.
    retrievedAt: isoTimestamp,
    // Hex digest of the captured content (e.g. sha-256), bounded.
    contentHash: z
      .string()
      .regex(/^[0-9a-fA-F]{16,128}$/, "contentHash must be 16-128 hex chars"),
    // How the content was extracted (bounded, lowercase-ish token or short phrase).
    extractionMethod: z.string().trim().min(1).max(EVIDENCE_LIMITS.idChars),
    // F10-09/F10-10: id of the immutable source snapshot this provenance was
    // captured from, when the item came through a source adapter. Absent on
    // legacy/user-supplied items (those keep their own content hashes).
    sourceSnapshotId: z
      .string()
      .trim()
      .min(1)
      .max(EVIDENCE_LIMITS.idChars)
      .regex(/^srcsnap_[A-Za-z0-9_-]+$/, "sourceSnapshotId must start with srcsnap_")
      .optional(),
    turnId: boundedId.optional(),
    span: z
      .tuple([z.number().int().min(0), z.number().int().min(0)])
      .refine(([start, end]) => end >= start, "span end must be >= start")
      .readonly()
      .optional(),
  })
  // agent-turn provenance must point at a turn.
  .refine(
    (p) => p.kind !== "agent-turn" || (p.turnId !== undefined && p.turnId.length > 0),
    "agent-turn provenance requires turnId",
  );

export const evidenceItemSchema = z.object({
  id: boundedId,
  text: boundedText,
  // Zero claims is valid: user-supplied packet items (F10-06) arrive before
  // any claim extraction exists.
  claimIds: z.array(boundedId).max(EVIDENCE_LIMITS.refsPerEntity).readonly(),
  provenance: provenanceSchema,
  status: evidenceStatusSchema,
  metadata: boundedMetadata,
  createdAt: isoTimestamp,
});

export const challengeSchema = z.object({
  id: boundedId,
  targetClaimId: boundedId,
  text: boundedText,
  side: sideSchema,
  // Finite, bounded budget: 0 means "no responses accepted".
  responseBudget: z.number().int().min(0).max(EVIDENCE_LIMITS.responsesPerChallenge),
  metadata: boundedMetadata,
  createdAt: isoTimestamp,
});

export const challengeResponseSchema = z.object({
  id: boundedId,
  challengeId: boundedId,
  text: boundedText,
  side: sideSchema,
  outcome: z.enum(["upheld", "rejected", "withdrawn"]),
  metadata: boundedMetadata,
  createdAt: isoTimestamp,
});

/** Proof-result `data` block: only safe, bounded, scalar fields. */
const proofDataSchema = z
  .object({
    message: z.string().max(EVIDENCE_LIMITS.metadataValueChars).optional(),
    score: z.number().finite().min(0).max(1).optional(),
    details: z
      .record(z.string().min(1).max(EVIDENCE_LIMITS.idChars), metadataValueSchema)
      .refine(
        (details) => Object.keys(details).length <= EVIDENCE_LIMITS.metadataEntries,
        `details exceeds ${EVIDENCE_LIMITS.metadataEntries} entries`,
      )
      .optional(),
  })
  .optional();

export const proofResultSchema = z.object({
  evidenceId: boundedId,
  status: z.enum(["verified", "failed", "unavailable"]),
  // F10-16/F10-18: optional adapter attribution (legacy proofs omit these).
  adapterId: z
    .string()
    .trim()
    .min(1)
    .max(EVIDENCE_LIMITS.idChars)
    .regex(/^sbadp_[A-Za-z0-9_-]+$/, "adapterId must start with sbadp_")
    .optional(),
  adapterVersion: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "adapter version must be a bounded token")
    .optional(),
  algorithm: z.string().trim().min(1).max(64).optional(),
  data: proofDataSchema,
  verifiedAt: isoTimestamp,
});

/* ------------------------------------------------------------------ */
/* Bundle schema + integrity validation                                */
/* ------------------------------------------------------------------ */

export const evidenceBundleSchema = z
  .object({
    schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
    // Readonly arrays so the inferred type matches the canonical
    // `EvidenceBundle` (readonly collections) in both directions.
    claims: z.array(claimSchema).max(EVIDENCE_LIMITS.claims).readonly(),
    items: z.array(evidenceItemSchema).max(EVIDENCE_LIMITS.items).readonly(),
    challenges: z.array(challengeSchema).max(EVIDENCE_LIMITS.challenges).readonly(),
    responses: z.array(challengeResponseSchema).max(EVIDENCE_LIMITS.responses).readonly(),
    proofs: z.array(proofResultSchema).max(EVIDENCE_LIMITS.proofs).readonly(),
    // F10-09/F10-10: immutable hash-pinned source snapshots. Defaulted to []
    // for legacy bundles missing the field (never rewritten).
    sourceSnapshots: z.array(sourceSnapshotSchema).max(EVIDENCE_LIMITS.snapshots).default([]).readonly(),
  })
  .superRefine((bundle, ctx) => {
    for (const message of bundleIntegrityIssues(bundle)) {
      ctx.addIssue({ code: "custom", message });
    }
  });

export type EvidenceBundleParseResult =
  | { readonly success: true; readonly data: EvidenceBundle }
  | { readonly success: false; readonly error: string };

function collectDuplicateIds(ids: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

/**
 * Cross-entity integrity checks for a parsed bundle: serialized size, unique
 * ids, reference integrity (claims -> items/challenges, items -> claims,
 * challenges -> claims, responses -> challenges, proofs -> items), and
 * challenge-budget conformance.
 */
function bundleIntegrityIssues(
  bundle: z.infer<typeof evidenceBundleSchema>,
): string[] {
  const issues: string[] = [];

  const chars = JSON.stringify(bundle).length;
  if (chars > EVIDENCE_LIMITS.bundleChars) {
    issues.push(`evidence bundle exceeds ${EVIDENCE_LIMITS.bundleChars} chars (${chars})`);
  }

  // Unique ids across the whole bundle (ids are globally unique, not per kind).
  const duplicate = collectDuplicateIds([
    ...bundle.claims.map((c) => c.id),
    ...bundle.items.map((i) => i.id),
    ...bundle.challenges.map((c) => c.id),
    ...bundle.responses.map((r) => r.id),
  ]);
  if (duplicate !== undefined) {
    issues.push(`duplicate evidence id: ${duplicate}`);
  }

  const claimIds = new Set(bundle.claims.map((c) => c.id));
  const itemIds = new Set(bundle.items.map((i) => i.id));
  const challengeIds = new Set(bundle.challenges.map((c) => c.id));

  // Claims -> referenced items/challenges must exist.
  for (const claim of bundle.claims) {
    for (const evidenceId of claim.evidenceIds) {
      if (!itemIds.has(evidenceId)) {
        issues.push(`claim ${claim.id} references missing evidence ${evidenceId}`);
      }
    }
    for (const challengeId of claim.challengeIds) {
      if (!challengeIds.has(challengeId)) {
        issues.push(`claim ${claim.id} references missing challenge ${challengeId}`);
      }
    }
  }

  // Items -> claims must exist (existence only; the transcript lives outside
  // the bundle, so turn references are shape-checked, not resolved).
  for (const item of bundle.items) {
    for (const claimId of item.claimIds) {
      if (!claimIds.has(claimId)) {
        issues.push(`evidence ${item.id} references missing claim ${claimId}`);
      }
    }
  }

  // Challenges -> target claim must exist; responses fit the finite budget.
  for (const challenge of bundle.challenges) {
    if (!claimIds.has(challenge.targetClaimId)) {
      issues.push(`challenge ${challenge.id} targets missing claim ${challenge.targetClaimId}`);
    }
    const responses = bundle.responses.filter((r) => r.challengeId === challenge.id);
    if (responses.length > challenge.responseBudget) {
      issues.push(
        `challenge ${challenge.id} has ${responses.length} responses exceeding budget ${challenge.responseBudget}`,
      );
    }
  }

  // Responses -> challenge must exist.
  for (const response of bundle.responses) {
    if (!challengeIds.has(response.challengeId)) {
      issues.push(`response ${response.id} references missing challenge ${response.challengeId}`);
    }
  }

  // Proofs -> evidence item must exist, at most one per item.
  const seenProofEvidence = new Set<string>();
  for (const proof of bundle.proofs) {
    if (!itemIds.has(proof.evidenceId)) {
      issues.push(`proof references missing evidence ${proof.evidenceId}`);
    }
    if (seenProofEvidence.has(proof.evidenceId)) {
      issues.push(`duplicate proof for evidence ${proof.evidenceId}`);
    }
    seenProofEvidence.add(proof.evidenceId);
  }

  // F10-09/F10-10: snapshot <-> evidence consistency. Unique snapshot ids,
  // adapter consistency between snapshot and referencing provenance, and
  // hash/byte-count agreement with the snapshot's captured content. Legacy
  // items without `sourceSnapshotId` remain valid.
  const snapshotIds = new Set<string>();
  for (const snapshot of bundle.sourceSnapshots) {
    if (snapshotIds.has(snapshot.id)) {
      issues.push(`duplicate source snapshot: ${snapshot.id}`);
    }
    snapshotIds.add(snapshot.id);
  }
  for (const item of bundle.items) {
    const snapshotId = item.provenance.sourceSnapshotId;
    if (snapshotId === undefined) continue;
    const snapshot = bundle.sourceSnapshots.find((entry) => entry.id === snapshotId);
    if (!snapshot) {
      issues.push(`evidence ${item.id} references missing source snapshot ${snapshotId}`);
      continue;
    }
    if (item.provenance.kind !== "external-source") {
      issues.push(
        `evidence ${item.id} uses sourceSnapshotId but has provenance kind ${item.provenance.kind}`,
      );
    }
    if (item.provenance.contentHash !== snapshot.contentHash) {
      issues.push(`evidence ${item.id} hash does not match snapshot ${snapshotId}`);
    }
    if (Buffer.byteLength(item.text, "utf8") !== snapshot.contentBytes) {
      issues.push(`evidence ${item.id} byte count does not match snapshot ${snapshotId}`);
    }
  }

  return issues;
}

/**
 * Validate an evidence bundle: schema, unique ids, reference integrity,
 * finite challenge budgets, safe proof data, and serialized size.
 */
export function validateEvidenceBundle(input: unknown): EvidenceBundleParseResult {
  const parsed = evidenceBundleSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue?.path?.length ? ` at ${issue.path.map(String).join(".")}` : "";
    return { success: false, error: `${issue?.message ?? "invalid evidence bundle"}${at}` };
  }
  return { success: true, data: parsed.data };
}

/* ------------------------------------------------------------------ */
/* Legacy normalization                                                */
/* ------------------------------------------------------------------ */

/** The canonical empty bundle: every collection empty, version stamped. */
export function emptyEvidenceBundle(): EvidenceBundle {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    claims: [],
    items: [],
    challenges: [],
    responses: [],
    proofs: [],
    sourceSnapshots: [],
  };
}

/**
 * Append a ProofResult to a bundle immutably. Rejects unknown evidence
 * references, duplicate proofs for the same item, and malformed proofs;
 * the returned bundle is validated before being returned. `undefined` = the
 * proof was rejected (reason in `error`).
 */
export function appendProofResult(
  bundle: EvidenceBundle,
  proof: ProofResult,
): { readonly ok: true; readonly bundle: EvidenceBundle } | { readonly ok: false; readonly error: string } {
  const parsed = proofResultSchema.safeParse(proof);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid proof result" };
  }
  const itemIds = new Set((bundle.items ?? []).map((item) => item.id));
  if (!itemIds.has(parsed.data.evidenceId)) {
    return { ok: false, error: `proof references unknown evidence ${parsed.data.evidenceId}` };
  }
  if ((bundle.proofs ?? []).some((entry) => entry.evidenceId === parsed.data.evidenceId)) {
    return { ok: false, error: `duplicate proof for evidence ${parsed.data.evidenceId}` };
  }
  const next: EvidenceBundle = {
    ...bundle,
    proofs: [...(bundle.proofs ?? []), parsed.data],
  };
  const validated = validateEvidenceBundle(next);
  if (!validated.success) {
    return { ok: false, error: validated.error };
  }
  return { ok: true, bundle: validated.data };
}

/**
 * Normalize any legacy/unknown input into a well-formed bundle without
 * rewriting history: anything that is not a shape-conformant v1 bundle
 * (including `undefined` from records that predate evidence) normalizes to
 * the empty bundle. Write paths use strict `validateEvidenceBundle`.
 */
export function normalizeLegacyEvidence(input: unknown): EvidenceBundle {
  if (input === null || input === undefined || typeof input !== "object") {
    return emptyEvidenceBundle();
  }
  if ((input as { schemaVersion?: unknown }).schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    // Unknown or missing version: never guess v1; treat as legacy/empty.
    return emptyEvidenceBundle();
  }
  const result = validateEvidenceBundle(input);
  if (!result.success) {
    // A v1-stamped but invalid payload is legacy garbage; normalize empty
    // rather than crash record loading.
    return emptyEvidenceBundle();
  }
  return result.data;
}

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

const KNOWN_PERMISSIONS: readonly string[] = SANDBOX_PERMISSIONS;

/** Strict per-request permission map: only known permission names allowed. */
const requestPermissionsSchema = z.record(z.string(), z.boolean()).refine(
  (permissions) => Object.keys(permissions).every((name) => KNOWN_PERMISSIONS.includes(name)),
  { message: "request contains unknown sandbox permissions" },
);

export const capabilityRequestSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_SCHEMA_VERSION),
  permissions: requestPermissionsSchema,
});

export const sandboxCapabilitiesSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_SCHEMA_VERSION),
  permissions: z.object({
    "fs.read": z.boolean(),
    "fs.write": z.boolean(),
    "net.fetch": z.boolean(),
    "process.spawn": z.boolean(),
  }),
});

export type CapabilityParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

/**
 * Parse and validate a capability request. Unknown versions and unknown
 * permission names are rejected (deny-by-default; never guessed as v1).
 */
export function validateCapabilityRequest(
  input: unknown,
): CapabilityParseResult<CapabilityRequest> {
  const parsed = capabilityRequestSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { success: false, error: issue?.message ?? "invalid capability request" };
  }
  return { success: true, data: parsed.data };
}

/** Validate a sandbox capabilities snapshot (all permissions materialized). */
export function validateSandboxCapabilities(
  input: unknown,
): CapabilityParseResult<SandboxCapabilities> {
  const parsed = sandboxCapabilitiesSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { success: false, error: issue?.message ?? "invalid sandbox capabilities" };
  }
  return { success: true, data: parsed.data };
}

/**
 * Negotiate the effective sandbox capabilities for a match: start from the
 * all-disabled default and grant only permissions that are both requested
 * and allowed. `allowed` is the host-side ceiling (what the deployment
 * permits); deny-by-default wins for everything else.
 */
export function negotiateCapabilities(
  request: CapabilityRequest,
  allowed: Readonly<Partial<Record<SandboxPermission, boolean>>>,
): SandboxCapabilities {
  const permissions = {} as Record<SandboxPermission, boolean>;
  for (const name of SANDBOX_PERMISSIONS) {
    permissions[name] = request.permissions[name] === true && allowed[name] === true;
  }
  return { schemaVersion: CAPABILITY_SCHEMA_VERSION, permissions };
}

/* ------------------------------------------------------------------ */
/* Evidence events                                                     */
/* ------------------------------------------------------------------ */

/** A parsed evidence event body (discriminated union). */
export const evidenceEventBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("claim-added"), claimId: boundedId }),
  z.object({
    type: z.literal("evidence-added"),
    evidenceId: boundedId,
    claimIds: z.array(boundedId).min(1).max(EVIDENCE_LIMITS.refsPerEntity).readonly(),
  }),
  z.object({
    type: z.literal("challenge-opened"),
    challengeId: boundedId,
    targetClaimId: boundedId,
  }),
  z.object({
    type: z.literal("challenge-response-added"),
    responseId: boundedId,
    challengeId: boundedId,
  }),
  z.object({
    type: z.literal("status-changed"),
    entityKind: z.enum(["claim", "evidence"]),
    entityId: boundedId,
    from: evidenceStatusSchema,
    to: evidenceStatusSchema,
  }),
  z.object({
    type: z.literal("proof-recorded"),
    evidenceId: boundedId,
    status: z.enum(["verified", "failed", "unavailable"]),
    // F10-16/F10-18 optional audit metadata (ids only, never content).
    adapterId: z
      .string()
      .trim()
      .min(1)
      .max(EVIDENCE_LIMITS.idChars)
      .regex(/^sbadp_[A-Za-z0-9_-]+$/, "adapterId must start with sbadp_")
      .optional(),
    adapterVersion: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "adapter version must be a bounded token")
      .optional(),
    algorithm: z.string().trim().min(1).max(64).optional(),
  }),
  z.object({
    type: z.literal("challenge-requested"),
    challengeId: boundedId,
    claimId: boundedId,
    requestId: z.string().trim().min(1).max(128),
  }),
  z.object({
    type: z.literal("challenge-response-recorded"),
    challengeId: boundedId,
    responseKind: z.enum(["answer", "unable"]),
  }),
  z.object({
    type: z.literal("challenge-resolved"),
    challengeId: boundedId,
    claimStatus: evidenceStatusSchema,
  }),
  z.object({
    type: z.literal("challenge-failed"),
    challengeId: boundedId,
  }),
  z.object({
    type: z.literal("challenge-expired"),
    challengeId: boundedId,
  }),
  // F10-09/F10-10: safe source lifecycle events — ids and enums only, never
  // content, references, or secrets.
  z.object({
    type: z.literal("source-snapshot-captured"),
    sourceSnapshotId: boundedId,
    adapterId: boundedId,
  }),
  z.object({
    type: z.literal("source-evidence-added"),
    evidenceId: boundedId,
    sourceSnapshotId: boundedId,
  }),
  z.object({
    type: z.literal("source-access-denied"),
    adapterId: boundedId,
    reason: z.enum(["consent-missing", "consent-expired", "consent-replayed", "capability-denied", "permission-unmet"]),
  }),
]);

/** Full evidence event envelope: versioned, sized, body-discriminated. */
export const evidenceEventSchema = z
  .object({
    eventVersion: z.literal(EVIDENCE_EVENT_VERSION),
    matchId: z.string().trim().min(1).max(128),
    // Positive, 1-based. Monotonicity across events is a stream-level
    // concern for a later validator; a single-event schema can only reject
    // zero/negative seqs.
    seq: z.number().int().min(1),
  })
  .and(evidenceEventBodySchema)
  .refine(
    (event) => JSON.stringify(event).length <= EVIDENCE_LIMITS.eventChars,
    `evidence event exceeds ${EVIDENCE_LIMITS.eventChars} chars`,
  );

export type EvidenceEventParseResult =
  | { readonly success: true; readonly data: EvidenceEvent }
  | { readonly success: false; readonly error: string };

/**
 * Validate a single evidence event. Unknown `eventVersion`s are rejected —
 * they are never re-parsed as v1 and never muxed into the debate transport
 * `{ v: 1 }` envelope.
 */
export function validateEvidenceEvent(input: unknown): EvidenceEventParseResult {
  const parsed = evidenceEventSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { success: false, error: issue?.message ?? "invalid evidence event" };
  }
  return { success: true, data: parsed.data };
}

/* ------------------------------------------------------------------ */
/* Record-level additive extensions                                    */
/* ------------------------------------------------------------------ */

/** Optional additive snapshots on the persisted match record. */
export const evidenceExtensionsSchema = z.object({
  evidence: evidenceBundleSchema.nullable().optional(),
  capabilities: sandboxCapabilitiesSchema.nullable().optional(),
});

/** Optional claim/evidence reference stamps on transcript turns. */
export const turnEvidenceRefsSchema = z.object({
  claimIds: z.array(boundedId).max(EVIDENCE_LIMITS.refsPerEntity).readonly().optional(),
  evidenceIds: z.array(boundedId).max(EVIDENCE_LIMITS.refsPerEntity).readonly().optional(),
});

/** Optional claim/evidence reference stamps on verdicts (F10-03): the judge
 * may cite the claims/evidence its verdict rests on. Absent on legacy
 * verdicts; never required. Arrays are readonly so the inferred type matches
 * the canonical `DebateVerdict`.
 */
export const verdictEvidenceRefsSchema = z.object({
  claimIds: z.array(boundedId).max(EVIDENCE_LIMITS.refsPerEntity).readonly().optional(),
  evidenceIds: z.array(boundedId).max(EVIDENCE_LIMITS.refsPerEntity).readonly().optional(),
});

/* ------------------------------------------------------------------ */
/* User-supplied evidence packets (F10-06 .. F10-08)                   */
/* ------------------------------------------------------------------ */

/** Hard limits for the client-facing user evidence packet. */
export const USER_EVIDENCE_LIMITS = Object.freeze({
  /** Max items per packet. */
  maxItems: 8,
  /** Max chars for an item label (a basename for local files). */
  maxLabelChars: 128,
  /** Max UTF-8 bytes for one item's content. */
  maxItemContentBytes: 4 * 1024,
  /** Max UTF-8 bytes for all item contents combined. */
  maxTotalContentBytes: 16 * 1024,
} as const);

/** C0 controls except tab/LF/CR, plus DEL — anything else is not plain text. */
const DISALLOWED_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** A local-file label must be a bare file name: no path separators or dots. */
function isSafeBasename(label: string): boolean {
  if (/[\\/]/.test(label)) return false;
  return label !== "." && label !== "..";
}

/**
 * Strict client input for one evidence item. Unknown fields are rejected,
 * never stripped: the client can provide ONLY source/label/content — never
 * ids, hashes, timestamps, statuses, provenance, URLs, filesystem paths,
 * capabilities, or verification claims.
 */
const userEvidenceItemInputSchema = z
  .strictObject({
    source: z.enum(["user_text", "local_file"]),
    label: z
      .string()
      .trim()
      .min(1, "evidence label must not be empty")
      .max(USER_EVIDENCE_LIMITS.maxLabelChars)
      .refine(
        (label) => !DISALLOWED_CONTROL_CHARS.test(label),
        "evidence label contains control characters",
      ),
    content: z
      .string()
      .min(1, "evidence content must not be empty")
      .refine(
        (content) => content.trim().length > 0,
        "evidence content must not be empty",
      )
      .refine(
        (content) => !DISALLOWED_CONTROL_CHARS.test(content),
        "evidence content is not plain text",
      )
      .refine(
        (content) => utf8ByteLength(content) <= USER_EVIDENCE_LIMITS.maxItemContentBytes,
        `evidence item exceeds ${USER_EVIDENCE_LIMITS.maxItemContentBytes} UTF-8 bytes`,
      ),
  })
  .refine(
    (item) => item.source !== "local_file" || isSafeBasename(item.label),
    "local_file label must be a bare file name without path separators",
  );

/**
 * Strict client input for the optional evidence packet: `{ version: 1,
 * items: [...] }`. Unknown fields are rejected outright.
 */
export const userEvidencePacketInputSchema = z.strictObject({
  version: z.literal(1),
  items: z
    .array(userEvidenceItemInputSchema)
    .min(1, "evidence packet must contain at least one item")
    .max(USER_EVIDENCE_LIMITS.maxItems),
});

export type UserEvidencePacketInput = z.infer<typeof userEvidencePacketInputSchema>;

export type UserEvidenceParseResult =
  | { readonly success: true; readonly data: EvidenceBundle }
  | { readonly success: false; readonly error: string };

/**
 * Validate a client evidence packet and normalize it into a canonical
 * `EvidenceBundle`. All identity/trust fields are assigned server-side:
 * item ids, SHA-256 content hashes, capture timestamps, `origin: "user"`,
 * source type, and `status: "unverified"`. Nothing the client sends can
 * influence verification state or provenance beyond label + content.
 */
export function normalizeUserEvidencePacket(input: unknown): UserEvidenceParseResult {
  const parsed = userEvidencePacketInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { success: false, error: issue?.message ?? "invalid evidence packet" };
  }
  const items = parsed.data.items;
  const totalBytes = items.reduce((sum, item) => sum + utf8ByteLength(item.content), 0);
  if (totalBytes > USER_EVIDENCE_LIMITS.maxTotalContentBytes) {
    return {
      success: false,
      error: `evidence packet exceeds ${USER_EVIDENCE_LIMITS.maxTotalContentBytes} UTF-8 bytes total (${totalBytes})`,
    };
  }
  const capturedAt = new Date().toISOString();
  const bundleItems: EvidenceItem[] = items.map((item) => {
    const isFile = item.source === "local_file";
    return {
      id: `ev_${randomUUID()}`,
      text: item.content,
      claimIds: [],
      provenance: {
        kind: isFile ? "user-file" : "user-text",
        origin: "user",
        reference: item.label,
        retrievedAt: capturedAt,
        contentHash: createHash("sha256").update(item.content, "utf8").digest("hex"),
        extractionMethod: isFile ? "user-file" : "user-paste",
      },
      status: "unverified",
      createdAt: capturedAt,
    };
  });
  return {
    success: true,
    data: {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      claims: [],
      items: bundleItems,
      challenges: [],
      responses: [],
      proofs: [],
      sourceSnapshots: [],
    },
  };
}
