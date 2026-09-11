/**
 * Canonical evidence shapes (v0.4 foundation slice).
 *
 * Dependency-free, serializable types for the evidence contract. These are the
 * storage/transport shapes; runtime validation lives in
 * `@arena/debate-engine` (`evidence-contract.ts`) on top of these ids.
 *
 * Versioning is independent from the debate transport contract
 * (`streaming.ts`, transport v:1) and from `CONTRACT_VERSION`: see
 * `capabilities.ts` for `EVIDENCE_SCHEMA_VERSION` / `CAPABILITY_SCHEMA_VERSION`
 * and `evidence-events.ts` for `EVIDENCE_EVENT_VERSION`.
 */

import type { SourceSnapshot } from "./source-adapters";

/** Schema version stamped on evidence bundles (independent of CONTRACT_VERSION). */
export type EvidenceSchemaVersion = 1;

/**
 * Status of a claim or evidence item (F10-04 product contract; the v0.4
 * release gate pins exactly these five values).
 */
export type EvidenceStatus =
  | "supported"
  | "contradicted"
  | "insufficient"
  | "unverified"
  | "unavailable";

/** Discriminator shared by every evidence entity for stable wire references. */
export type EvidenceEntityKind = "claim" | "evidence" | "challenge" | "response";

/** Stable id prefix conventions (readable, collision-free across kinds). */
export const EVIDENCE_ID_PREFIX = Object.freeze({
  claim: "clm_",
  evidence: "ev_",
  challenge: "chl_",
  response: "rsp_",
} as const satisfies Record<EvidenceEntityKind, string>);

/**
 * A debatable proposition extracted from an agent turn. Claims are the atoms
 * that evidence items support and challenges target.
 */
export interface Claim {
  /** Stable, unique id (`clm_`-prefixed). */
  readonly id: string;
  /** The debatable proposition itself. */
  readonly text: string;
  /** Turn this claim was extracted from (format-owned turn id). */
  readonly turnId: string;
  /** Side that asserted the claim. */
  readonly side: "A" | "B";
  readonly status: EvidenceStatus;
  /** Ids of EvidenceItems that support this claim. */
  readonly evidenceIds: readonly string[];
  /** Ids of challenges raised against this claim. */
  readonly challengeIds: readonly string[];
  /** Bounded, JSON-serializable free-form metadata. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  /** Creation timestamp (ISO 8601). */
  readonly createdAt: string;
}

/**
 * Where an evidence item's content came from (F10-05 auditable provenance).
 * Every field below is required so provenance is always inspectable: source
 * type, user/provider origin, capture timestamp, content hash, and how the
 * content was extracted.
 */
export interface Provenance {
  /**
   * Source type: how the content came into the system. `user-text` and
   * `user-file` are user-supplied packets (F10-06); the rest are system-
   * gathered sources.
   */
  readonly kind:
    | "agent-turn"
    | "external-source"
    | "tool-output"
    | "model-knowledge"
    | "user-text"
    | "user-file";
  /**
   * User/provider origin of the content: a provider id, agent id, tool id,
   * or `"user"` for user-supplied material.
   */
  readonly origin: string;
  /**
   * Location of the content: for `agent-turn` the source turn id; for
   * `external-source` a URI; for `tool-output` the tool/invocation id;
   * for `model-knowledge` a short human-readable locator.
   */
  readonly reference: string;
  /** When the content was captured/extracted (ISO 8601). */
  readonly retrievedAt: string;
  /** Hex digest of the captured content (e.g. sha-256; bounded, case-insensitive). */
  readonly contentHash: string;
  /** How the content was extracted (e.g. `manual-paste`, `quote`, `llm-extract`, `tool-output`). */
  readonly extractionMethod: string;
  /**
   * F10-09/F10-10: id of the immutable `SourceSnapshot` this provenance was
   * captured from, when the item came through a source adapter. Absent on
   * legacy/user-supplied items (those keep their own content hashes).
   */
  readonly sourceSnapshotId?: string;
  /** Turn id when `kind` is `agent-turn` (required for that kind). */
  readonly turnId?: string;
  /** Byte offset range `[start, end]` into the referenced content, when known. */
  readonly span?: readonly [number, number];
}

/** A discrete piece of evidence attached to (zero or more) claims. */
export interface EvidenceItem {
  /** Stable, unique id (`ev_`-prefixed). */
  readonly id: string;
  /** Verbatim quote or condensed content of the evidence. */
  readonly text: string;
  /**
   * Ids of Claims this item supports. Usually non-empty for extracted
   * evidence; user-supplied packet items (F10-06) start with none.
   */
  readonly claimIds: readonly string[];
  /** Mandatory origin information for the item. */
  readonly provenance: Provenance;
  readonly status: EvidenceStatus;
  /** Bounded, JSON-serializable free-form metadata. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  /** Creation timestamp (ISO 8601). */
  readonly createdAt: string;
}

/** A challenge raised against a claim (or another challenge's response). */
export interface Challenge {
  /** Stable, unique id (`chl_`-prefixed). */
  readonly id: string;
  /** Id of the Claim being challenged. */
  readonly targetClaimId: string;
  /** The objection itself. */
  readonly text: string;
  /** Side raising the challenge. */
  readonly side: "A" | "B";
  /** How many responses this challenge still permits (finite). */
  readonly responseBudget: number;
  /** Bounded, JSON-serializable free-form metadata. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  /** Creation timestamp (ISO 8601). */
  readonly createdAt: string;
}

/**
 * Lifecycle of a persisted post-match challenge (F10-11..13).
 *
 * Valid transitions (enforced by `@arena/debate-engine`):
 * `requested -> responding -> adjudicating -> resolved`
 * `requested -> responding -> unable`
 * `requested -> failed | expired` and `responding -> failed | expired`,
 * `adjudicating -> failed`. `resolved`/`unable`/`failed`/`expired` are
 * terminal. Provider timeout/auth/malformed output or judge failure is
 * `failed`, never `unable`; `unable` is only the challenged agent's own
 * explicit admission.
 */
export type ChallengeState =
  | "requested"
  | "responding"
  | "adjudicating"
  | "resolved"
  | "unable"
  | "failed"
  | "expired";

/** The challenged agent's structured reply: a bounded answer or an explicit inability. */
export type ChallengeAgentResponse =
  | {
      readonly kind: "answer";
      /** Bounded answer content. */
      readonly answer: string;
      /** Cited evidence ids — always a subset of the challenge's allowed evidence. */
      readonly citedEvidenceIds: readonly string[];
      readonly model: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: "unable";
      readonly reason: "insufficient_evidence" | "cannot_verify" | "no_valid_response";
      /** Optional bounded explanation. */
      readonly explanation?: string;
      readonly model: string;
      readonly createdAt: string;
    };

/** One evidence item's model-assessed status inside a challenge adjudication. */
export interface ChallengeEvidenceAssessment {
  readonly evidenceId: string;
  readonly assessment: EvidenceStatus;
  /** Bounded per-item reasoning. */
  readonly reasoning: string;
}

/**
 * Structured judge adjudication of a resolved challenge. Model-assessed
 * only (`method: "judge_model"`): no external verification, no tools.
 */
export interface ChallengeAdjudication {
  readonly claimStatus: EvidenceStatus;
  readonly evidenceAssessments: readonly ChallengeEvidenceAssessment[];
  /** Bounded overall reasoning. */
  readonly reasoning: string;
  readonly method: "judge_model";
  readonly judgeModel: string;
  readonly createdAt: string;
}

/**
 * A persisted post-match challenge attached to a completed match record.
 * The match's top-level verdict and terminal state remain authoritative
 * regardless of the challenge outcome.
 */
export interface MatchChallenge {
  /** Stable, unique id (`chl_`-prefixed). */
  readonly id: string;
  /** Client-supplied idempotency key (bounded, opaque). */
  readonly requestId: string;
  readonly matchId: string;
  readonly status: ChallengeState;
  /** Challenged side, derived server-side from the target turn. */
  readonly side: "A" | "B";
  /** The challenged turn (exact transcript turn id). */
  readonly targetTurnId: string;
  /** The challenged proposition — an exact bounded excerpt of that turn. */
  readonly targetClaimText: string;
  /** Server-created claim id (`clm_`-prefixed) for the challenged excerpt. */
  readonly claimId: string;
  /** Stored evidence item ids the challenged agent may cite (max 4). */
  readonly evidenceIds: readonly string[];
  readonly response?: ChallengeAgentResponse;
  readonly adjudication?: ChallengeAdjudication;
  /** Bounded safe failure reason when `status` is `failed`. */
  readonly failureReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A rebuttal answering a challenge, consuming one unit of its budget. */
export interface ChallengeResponse {
  /** Stable, unique id (`rsp_`-prefixed). */
  readonly id: string;
  /** Id of the Challenge being answered. */
  readonly challengeId: string;
  /** The rebuttal itself. */
  readonly text: string;
  /** Side answering the challenge (typically the challenged claim's side). */
  readonly side: "A" | "B";
  /** Outcome the responder claims for the exchange. */
  readonly outcome: "upheld" | "rejected" | "withdrawn";
  /** Bounded, JSON-serializable free-form metadata. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  /** Creation timestamp (ISO 8601). */
  readonly createdAt: string;
}

/** Outcome of verifying one evidence item's provenance/content. */
export interface ProofResult {
  /** Id of the EvidenceItem that was verified. */
  readonly evidenceId: string;
  readonly status: "verified" | "failed" | "unavailable";
  /** F10-16/F10-18: the sandbox adapter that produced this result (optional for legacy records). */
  readonly adapterId?: string;
  /** Adapter version when `adapterId` is present. */
  readonly adapterVersion?: string;
  /** Hash/verification algorithm identifier when `adapterId` is present. */
  readonly algorithm?: string;
  /**
   * Safe, bounded verification data: short messages, numeric scores, and
   * echoes of ids only. Never raw network payloads, credentials, or
   * unbounded blobs — runtime validation enforces the bounds.
   */
  readonly data?: Readonly<{
    readonly message?: string;
    readonly score?: number;
    readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  }>;
  /** Verification timestamp (ISO 8601). */
  readonly verifiedAt: string;
}

/**
 * The complete, self-contained evidence payload attached to a match record
 * under `evidence`. Absent (`undefined`) for legacy records; empty (all
 * arrays `[]`) for evidence-enabled matches that produced nothing.
 * `sourceSnapshots` holds the immutable, hash-pinned source captures
 * (F10-09/F10-10) that adapter-derived evidence items point at via
 * `provenance.sourceSnapshotId`; legacy bundles normalize it to `[]`.
 */
export interface EvidenceBundle {
  readonly schemaVersion: EvidenceSchemaVersion;
  readonly claims: readonly Claim[];
  readonly items: readonly EvidenceItem[];
  readonly challenges: readonly Challenge[];
  readonly responses: readonly ChallengeResponse[];
  readonly proofs: readonly ProofResult[];
  readonly sourceSnapshots: readonly SourceSnapshot[];
}
