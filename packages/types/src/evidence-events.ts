/**
 * Versioned evidence event envelope (v0.4 foundation slice).
 *
 * Dependency-free event types for evidence lifecycle events. Deliberately
 * separate from the debate transport contract in `streaming.ts`: evidence
 * events carry their own `eventVersion` (see `EVIDENCE_EVENT_VERSION` below)
 * and MUST NOT be muxed into the `{ v: 1, matchId, seq }` debate stream, nor
 * parsed as that shape when version mismatches.
 */

import type { EvidenceStatus } from "./evidence";

/** Schema version stamped on every evidence event envelope. */
export const EVIDENCE_EVENT_VERSION = 1 as const;

/** Independent version for evidence events (kept distinct from transport v:1). */
export type EvidenceEventVersion = typeof EVIDENCE_EVENT_VERSION;

/** Lifecycle phases an evidence entity can emit events for. */
export type EvidenceEventAction =
  | "claim-added"
  | "evidence-added"
  | "challenge-opened"
  | "challenge-response-added"
  | "status-changed"
  | "proof-recorded"
  | "challenge-requested"
  | "challenge-response-recorded"
  | "challenge-resolved"
  | "challenge-failed"
  | "challenge-expired"
  | "source-snapshot-captured"
  | "source-evidence-added"
  | "source-access-denied";

/** Discriminated payload bodies. Exactly one shape per `type`. */
export type EvidenceEventBody =
  | {
      readonly type: "claim-added";
      readonly claimId: string;
    }
  | {
      readonly type: "evidence-added";
      readonly evidenceId: string;
      readonly claimIds: readonly string[];
    }
  | {
      readonly type: "challenge-opened";
      readonly challengeId: string;
      readonly targetClaimId: string;
    }
  | {
      readonly type: "challenge-response-added";
      readonly responseId: string;
      readonly challengeId: string;
    }
  | {
      readonly type: "status-changed";
      readonly entityKind: "claim" | "evidence";
      readonly entityId: string;
      readonly from: EvidenceStatus;
      readonly to: EvidenceStatus;
    }
  | {
      readonly type: "proof-recorded";
      readonly evidenceId: string;
      readonly status: "verified" | "failed" | "unavailable";
      /** F10-16/F10-18 optional audit metadata (ids only, never content). */
      readonly adapterId?: string;
      readonly adapterVersion?: string;
      readonly algorithm?: string;
    }
  | {
      readonly type: "challenge-requested";
      readonly challengeId: string;
      readonly claimId: string;
      readonly requestId: string;
    }
  | {
      readonly type: "challenge-response-recorded";
      readonly challengeId: string;
      readonly responseKind: "answer" | "unable";
    }
  | {
      readonly type: "challenge-resolved";
      readonly challengeId: string;
      readonly claimStatus: EvidenceStatus;
    }
  | {
      readonly type: "challenge-failed";
      readonly challengeId: string;
    }
  | {
      readonly type: "challenge-expired";
      readonly challengeId: string;
    }
  | {
      readonly type: "source-snapshot-captured";
      readonly sourceSnapshotId: string;
      readonly adapterId: string;
    }
  | {
      readonly type: "source-evidence-added";
      readonly evidenceId: string;
      readonly sourceSnapshotId: string;
    }
  | {
      readonly type: "source-access-denied";
      readonly adapterId: string;
      readonly reason:
        | "consent-missing"
        | "consent-expired"
        | "consent-replayed"
        | "capability-denied"
        | "permission-unmet";
    };

/**
 * Versioned envelope: every evidence event carries
 * `{ eventVersion, matchId, seq, type, ...body }`.
 */
export type EvidenceEvent = EvidenceEventBody & {
  readonly eventVersion: EvidenceEventVersion;
  readonly matchId: string;
  readonly seq: number;
};

/** Narrow an unknown value to a validated-shape reference (type-level only). */
export function isEvidenceEvent(value: unknown): value is EvidenceEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "eventVersion" in value &&
    (value as { eventVersion: unknown }).eventVersion === EVIDENCE_EVENT_VERSION &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}
