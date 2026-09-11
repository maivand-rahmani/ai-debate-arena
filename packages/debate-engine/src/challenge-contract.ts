/**
 * Challenge contract (v0.4 bounded post-match challenge slice, F10-11..13).
 *
 * Strict Zod schemas, limits, lifecycle transition validation, reference
 * validation, and idempotency helpers for post-match challenges against a
 * completed match record.
 *
 * Safety properties:
 * - Strict client input: the client provides ONLY `version`, `requestId`,
 *   `target.turnId`, `target.claimText`, and `evidenceIds`. Client-supplied
 *   ids, statuses, outcomes, provider ids, and judge decisions are rejected.
 * - The challenged side, claim id, and all lifecycle state are derived or
 *   assigned server-side.
 * - Budgets are finite: one active challenge per match, at most 2 resolved
 *   challenges per match, at most one challenge per claim, one response
 *   attempt, and at most 4 evidence references.
 * - The match's top-level verdict and `terminal: "completed"` are never
 *   modified by challenge outcomes.
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  ChallengeAdjudication,
  ChallengeAgentResponse,
  ChallengeState,
  EvidenceBundle,
  EvidenceEvent,
  EvidenceEventBody,
  EvidenceItem,
  EvidenceStatus,
  MatchChallenge,
} from "@arena/types";

/** Independent challenge schema version (separate from CONTRACT_VERSION). */
export const CHALLENGE_SCHEMA_VERSION = 1 as const;
/** Evidence schema version for synthesized selection bundles. */
const EVIDENCE_SCHEMA_VERSION = 1 as const;

/** Hard limits for the bounded challenge slice. */
export const CHALLENGE_LIMITS = Object.freeze({
  /** Max chars for the client idempotency key. */
  requestIdChars: 128,
  /** Max chars for the challenged claim excerpt. */
  claimTextChars: 1000,
  /** Max chars for the agent's answer content. */
  answerChars: 4000,
  /** Max chars for the agent's unable explanation. */
  explanationChars: 1000,
  /** Max chars for the judge's overall reasoning. */
  adjudicationReasoningChars: 4000,
  /** Max chars for one evidence assessment's reasoning. */
  assessmentReasoningChars: 1000,
  /** Max evidence references per challenge. */
  maxEvidenceRefs: 4,
  /** Max resolved challenges per match. */
  maxResolvedPerMatch: 2,
  /** Max active (non-terminal) challenges per match. */
  maxActivePerMatch: 1,
  /** Max challenges per claim. */
  maxPerClaim: 1,
  /** Max persisted challenges per match record (terminal ones included). */
  maxPerMatch: 8,
  /** Max persisted evidence events per match record. */
  maxEvidenceEvents: 100,
  /** Max output tokens for the challenged agent call. */
  agentMaxOutputTokens: 2000,
  /** Max output tokens for the challenge judge call. */
  judgeMaxOutputTokens: 2000,
} as const);

/* ------------------------------------------------------------------ */
/* Client request (strict input)                                       */
/* ------------------------------------------------------------------ */

const boundedRequestId = z
  .string()
  .trim()
  .min(1)
  .max(CHALLENGE_LIMITS.requestIdChars)
  .regex(/^[A-Za-z0-9_-]+$/, "requestId may only contain [A-Za-z0-9_-]");

const boundedExcerpt = z
  .string()
  .trim()
  .min(1, "claimText must not be empty")
  .max(CHALLENGE_LIMITS.claimTextChars);

/**
 * Strict challenge request: `{ version: 1, requestId, target: { turnId,
 * claimText }, evidenceIds }`. Unknown fields are rejected, never stripped.
 */
export const challengeRequestInputSchema = z.strictObject({
  version: z.literal(1),
  requestId: boundedRequestId,
  target: z.strictObject({
    turnId: z.string().trim().min(1).max(128),
    claimText: boundedExcerpt,
  }),
  evidenceIds: z
    .array(boundedRequestId)
    .max(CHALLENGE_LIMITS.maxEvidenceRefs),
});

export type ChallengeRequestInput = z.infer<typeof challengeRequestInputSchema>;

export type ChallengeRequestParseResult =
  | { readonly success: true; readonly data: ChallengeRequestInput }
  | { readonly success: false; readonly error: string };

export function parseChallengeRequest(input: unknown): ChallengeRequestParseResult {
  const parsed = challengeRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { success: false, error: issue?.message ?? "invalid challenge request" };
  }
  return { success: true, data: parsed.data };
}

/* ------------------------------------------------------------------ */
/* Lifecycle states + transitions                                      */
/* ------------------------------------------------------------------ */

export const challengeStateSchema = z.enum([
  "requested",
  "responding",
  "adjudicating",
  "resolved",
  "unable",
  "failed",
  "expired",
]);

const CHALLENGE_TRANSITIONS: Readonly<Record<ChallengeState, readonly ChallengeState[]>> =
  Object.freeze({
    requested: ["responding", "failed", "expired"],
    responding: ["adjudicating", "unable", "failed", "expired"],
    adjudicating: ["resolved", "failed"],
    resolved: [],
    unable: [],
    failed: [],
    expired: [],
  });

export type TransitionCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/** Validate one lifecycle transition against the finite state machine. */
export function validateChallengeTransition(from: ChallengeState, to: ChallengeState): TransitionCheckResult {
  const allowed = CHALLENGE_TRANSITIONS[from];
  if (allowed === undefined) {
    return { ok: false, error: `unknown challenge state: ${from}` };
  }
  if (!allowed.includes(to)) {
    return { ok: false, error: `invalid challenge transition: ${from} -> ${to}` };
  }
  return { ok: true };
}

export function isTerminalChallengeState(state: ChallengeState): boolean {
  return CHALLENGE_TRANSITIONS[state].length === 0;
}

/* ------------------------------------------------------------------ */
/* Persisted challenge + response + adjudication schemas               */
/* ------------------------------------------------------------------ */

const challengeModelRef = z.string().trim().min(1).max(200);
const challengeTimestamp = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), "invalid ISO timestamp");

export const challengeEvidenceAssessmentSchema = z.object({
  evidenceId: boundedRequestId,
  assessment: z.enum(["supported", "contradicted", "insufficient", "unverified", "unavailable"]),
  reasoning: z.string().trim().min(1).max(CHALLENGE_LIMITS.assessmentReasoningChars),
});

/**
 * Raw model output shape for the challenged agent (no server-stamped fields).
 * The runner validates against this, then stamps `model`/`createdAt`.
 */
export const challengeAgentResponseInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    answer: z.string().trim().min(1).max(CHALLENGE_LIMITS.answerChars),
    citedEvidenceIds: z
      .array(boundedRequestId)
      .max(CHALLENGE_LIMITS.maxEvidenceRefs)
      .readonly(),
  }),
  z.object({
    kind: z.literal("unable"),
    reason: z.enum(["insufficient_evidence", "cannot_verify", "no_valid_response"]),
    explanation: z.string().trim().max(CHALLENGE_LIMITS.explanationChars).optional(),
  }),
]);

/**
 * Raw model output shape for the challenge judge (no server-stamped fields).
 * The runner validates against this, then stamps `method`/`judgeModel`/
 * `createdAt` and cross-checks evidence references.
 */
export const challengeAdjudicationInputSchema = z.object({
  claimStatus: z.enum(["supported", "contradicted", "insufficient", "unverified", "unavailable"]),
  evidenceAssessments: z
    .array(challengeEvidenceAssessmentSchema)
    .max(CHALLENGE_LIMITS.maxEvidenceRefs)
    .readonly(),
  reasoning: z.string().trim().min(1).max(CHALLENGE_LIMITS.adjudicationReasoningChars),
});

export const challengeAgentResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    answer: z.string().trim().min(1).max(CHALLENGE_LIMITS.answerChars),
    citedEvidenceIds: z
      .array(boundedRequestId)
      .max(CHALLENGE_LIMITS.maxEvidenceRefs)
      .readonly(),
    model: challengeModelRef,
    createdAt: challengeTimestamp,
  }),
  z.object({
    kind: z.literal("unable"),
    reason: z.enum(["insufficient_evidence", "cannot_verify", "no_valid_response"]),
    explanation: z.string().trim().max(CHALLENGE_LIMITS.explanationChars).optional(),
    model: challengeModelRef,
    createdAt: challengeTimestamp,
  }),
]);

export const challengeAdjudicationSchema = z.object({
  claimStatus: z.enum(["supported", "contradicted", "insufficient", "unverified", "unavailable"]),
  evidenceAssessments: z
    .array(challengeEvidenceAssessmentSchema)
    .max(CHALLENGE_LIMITS.maxEvidenceRefs)
    .readonly(),
  reasoning: z.string().trim().min(1).max(CHALLENGE_LIMITS.adjudicationReasoningChars),
  method: z.literal("judge_model"),
  judgeModel: challengeModelRef,
  createdAt: challengeTimestamp,
});

export const matchChallengeSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^chl_[A-Za-z0-9_-]+$/),
  requestId: boundedRequestId,
  matchId: z.string().trim().min(1).max(128),
  status: challengeStateSchema,
  side: z.enum(["A", "B"]),
  targetTurnId: z.string().trim().min(1).max(128),
  targetClaimText: boundedExcerpt,
  claimId: z.string().trim().min(1).max(64).regex(/^clm_[A-Za-z0-9_-]+$/),
  evidenceIds: z.array(boundedRequestId).max(CHALLENGE_LIMITS.maxEvidenceRefs).readonly(),
  response: challengeAgentResponseSchema.optional(),
  adjudication: challengeAdjudicationSchema.optional(),
  failureReason: z.string().trim().min(1).max(500).optional(),
  createdAt: challengeTimestamp,
  updatedAt: challengeTimestamp,
});

export type { ChallengeAdjudication, ChallengeAgentResponse, ChallengeState, MatchChallenge };
export type { EvidenceStatus };

/** Minimal structural view of a stored match record used for validation. */
type MatchRecordShape = {
  readonly matchId: string;
  readonly terminal: string;
  readonly transcript: readonly { readonly id: string; readonly side: string; readonly content: string }[];
  readonly evidence?: { readonly items: readonly { readonly id: string }[] } | null;
  readonly challenges?: readonly MatchChallenge[];
};
export type { MatchRecordShape };

/* ------------------------------------------------------------------ */
/* Budget + reference validation against a stored record               */
/* ------------------------------------------------------------------ */

export type ChallengeAcceptanceCheck =
  | { readonly ok: true; readonly side: "A" | "B" }
  | { readonly ok: false; readonly status: 409; readonly error: string };

/**
 * Validate a parsed challenge request against a stored match record:
 * completed terminal, exact target turn, exact bounded excerpt, evidence
 * references belong to the stored evidence, budgets (active/resolved/
 * per-claim), and a usable challenged-side provider id. Returns the derived
 * challenged side on success. Never guesses a provider from providerName.
 */
export function validateChallengeAgainstRecord(
  request: ChallengeRequestInput,
  record: MatchRecordShape,
): ChallengeAcceptanceCheck {
  if (record.terminal !== "completed") {
    return { ok: false, status: 409, error: "Match cannot be challenged" };
  }
  const turn = record.transcript.find((entry) => entry.id === request.target.turnId);
  if (!turn) {
    return { ok: false, status: 409, error: "Challenge target turn not found" };
  }
  if (!turn.content.includes(request.target.claimText)) {
    return {
      ok: false,
      status: 409,
      error: "claimText must be an exact excerpt of the target turn",
    };
  }
  const side = turn.side === "A" || turn.side === "B" ? turn.side : null;
  if (side === null) {
    return { ok: false, status: 409, error: "Challenge target turn has no valid side" };
  }
  const storedEvidenceIds = new Set((record.evidence?.items ?? []).map((item) => item.id));
  for (const evidenceId of request.evidenceIds) {
    if (!storedEvidenceIds.has(evidenceId)) {
      return { ok: false, status: 409, error: `Unknown evidence reference: ${evidenceId}` };
    }
  }

  const challenges = record.challenges ?? [];
  if (challenges.length >= CHALLENGE_LIMITS.maxPerMatch) {
    return { ok: false, status: 409, error: "Challenge budget exhausted" };
  }
  const active = challenges.filter((challenge) => !isTerminalChallengeState(challenge.status));
  if (active.length >= CHALLENGE_LIMITS.maxActivePerMatch) {
    return { ok: false, status: 409, error: "Another challenge is already in progress" };
  }
  const resolved = challenges.filter((challenge) => challenge.status === "resolved");
  if (resolved.length >= CHALLENGE_LIMITS.maxResolvedPerMatch) {
    return { ok: false, status: 409, error: "Challenge budget exhausted" };
  }
  const claimed = challenges.filter(
    (challenge) =>
      challenge.targetTurnId === request.target.turnId &&
      challenge.targetClaimText === request.target.claimText,
  );
  if (claimed.length >= CHALLENGE_LIMITS.maxPerClaim) {
    return { ok: false, status: 409, error: "This claim has already been challenged" };
  }
  return { ok: true, side };
}

/**
 * Idempotency: find an existing challenge by its client request id. A
 * repeated requestId must return the stored challenge without calling any
 * model again.
 */
export function findChallengeByRequestId(
  challenges: readonly MatchChallenge[] | undefined,
  requestId: string,
): MatchChallenge | undefined {
  return (challenges ?? []).find((challenge) => challenge.requestId === requestId);
}

/**
 * Select only the evidence items referenced by a challenge request, in
 * request order, preserving their provenance. Every requested id must exist
 * in the stored bundle; `undefined` = at least one requested ref is
 * missing/unknown (the caller must reject, never silently narrow).
 */
export function selectEvidenceForChallenge(
  bundle: EvidenceBundle | null | undefined,
  requestedIds: readonly string[],
): EvidenceBundle | undefined {
  const byId = new Map((bundle?.items ?? []).map((item) => [item.id, item]));
  const selected: EvidenceItem[] = [];
  for (const id of requestedIds) {
    const item = byId.get(id);
    if (!item) return undefined;
    selected.push(item);
  }
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    claims: [],
    items: selected,
    challenges: [],
    responses: [],
    proofs: [],
    sourceSnapshots: (bundle?.sourceSnapshots ?? []).filter((snapshot) =>
      selected.some((item) => item.provenance.sourceSnapshotId === snapshot.id),
    ),
  };
}

/** Server-side id factories (clients never choose ids). */
export function newChallengeId(): string {
  return `chl_${randomUUID()}`;
}

export function newChallengeClaimId(): string {
  return `clm_${randomUUID()}`;
}

/**
 * Attach the server-created challenge claim to the stored evidence bundle:
 * appends the Claim and links it back from the selected evidence items via
 * `claimIds`. Returns `undefined` when the record cannot safely accept a
 * claim (no evidence bundle — legacy record) or when any challenge-selected
 * evidence ref is missing from the bundle.
 */
export function attachChallengeClaim(
  bundle: EvidenceBundle | null | undefined,
  claim: { readonly id: string; readonly text: string; readonly turnId: string; readonly side: "A" | "B"; readonly createdAt: string },
  evidenceIds: readonly string[],
): EvidenceBundle | undefined {
  if (!bundle) return undefined;
  const byId = new Map((bundle.items ?? []).map((item) => [item.id, item]));
  for (const id of evidenceIds) {
    if (!byId.has(id)) return undefined;
  }
  const claimRecord = {
    id: claim.id,
    text: claim.text,
    turnId: claim.turnId,
    side: claim.side,
    status: "unverified" as const,
    evidenceIds: [...evidenceIds],
    challengeIds: [],
    createdAt: claim.createdAt,
  };
  const items = (bundle.items ?? []).map((item) =>
    evidenceIds.includes(item.id)
      ? { ...item, claimIds: [...item.claimIds, claim.id] }
      : item,
  );
  return {
    schemaVersion: bundle.schemaVersion,
    claims: [...(bundle.claims ?? []), claimRecord],
    items,
    challenges: bundle.challenges ?? [],
    responses: bundle.responses ?? [],
    proofs: bundle.proofs ?? [],
    sourceSnapshots: bundle.sourceSnapshots ?? [],
  };
}

/**
 * Next 1-based evidence-event sequence for a record's persisted event list.
 */
export function nextEvidenceEventSeq(events: readonly EvidenceEvent[] | undefined): number {
  const max = (events ?? []).reduce((acc, event) => Math.max(acc, event.seq), 0);
  return max + 1;
}

/**
 * Append a lifecycle evidence event to a record's persisted list, enforcing
 * the persisted-event cap. Returns a new array (or the same cap-trimmed one).
 */
export function appendEvidenceEvent(
  events: readonly EvidenceEvent[] | undefined,
  event: EvidenceEvent,
): EvidenceEvent[] {
  const next = [...(events ?? []), event];
  return next.length > CHALLENGE_LIMITS.maxEvidenceEvents
    ? next.slice(next.length - CHALLENGE_LIMITS.maxEvidenceEvents)
    : next;
}

/**
 * Build a lifecycle evidence event for a challenge transition. Kept here so
 * the route and runner emit exactly the canonical shapes.
 */
export function challengeLifecycleEvent(
  matchId: string,
  seq: number,
  body: EvidenceEventBody,
): EvidenceEvent {
  return { eventVersion: 1, matchId, seq, ...body };
}
