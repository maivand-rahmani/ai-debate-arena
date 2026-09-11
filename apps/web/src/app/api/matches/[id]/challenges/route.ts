import "server-only";

import {
  MATCH_TIMEOUT_MS,
  parseChallengeRequest,
  validateChallengeAgainstRecord,
  findChallengeByRequestId,
  newChallengeId,
  newChallengeClaimId,
  validateChallengeTransition,
  nextEvidenceEventSeq,
  appendEvidenceEvent,
  challengeLifecycleEvent,
  selectEvidenceForChallenge,
  attachChallengeClaim,
  runChallenge,
  challengeOutcomeFields,
  validateEvidenceBundle,
} from "@arena/debate-engine";
import type {
  EvidenceBundle,
  EvidenceEventBody,
  MatchChallenge,
  MatchRecord,
} from "@arena/debate-engine";
import { webCallModel } from "@/features/run-debate/server/web-adapter";
import { getProvider } from "@/shared/config/provider-store";
import { loadMatchRecord, matchRecordPath, saveMatchRecord } from "@/shared/config/match-store";
import { readBoundedJsonBody } from "@/shared/api/bounded-body";
import { withRecordLock } from "@/shared/config/record-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChallengeRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/**
 * Immutably replace one challenge on a record, append lifecycle event
 * bodies, and (optionally) swap in an updated evidence bundle. Pure: verdict,
 * terminal, transcript, and metrics are untouched.
 */
function withChallenge(
  record: MatchRecord,
  challenge: MatchChallenge,
  eventBodies: readonly EvidenceEventBody[],
  evidence?: EvidenceBundle,
): MatchRecord {
  const challenges = [
    ...(record.challenges ?? []).filter((entry) => entry.id !== challenge.id),
    challenge,
  ];
  let events = record.evidenceEvents;
  for (const body of eventBodies) {
    events = appendEvidenceEvent(
      events,
      challengeLifecycleEvent(record.matchId, nextEvidenceEventSeq(events), body),
    );
  }
  return {
    ...record,
    challenges,
    evidenceEvents: events,
    ...(evidence !== undefined ? { evidence } : {}),
  };
}

/** Terminalize a stuck nonterminal challenge after a persistence failure. */
async function persistRecovery(
  record: MatchRecord,
  challenge: MatchChallenge,
  status: "failed" | "expired",
  reason: string,
): Promise<void> {
  const fields = challengeOutcomeFields(
    challenge,
    status === "expired" ? { outcome: "expired" } : { outcome: "failed", reason },
    new Date().toISOString(),
  );
  const recovered: MatchChallenge = { ...challenge, ...fields };
  const transition = validateChallengeTransition(challenge.status, recovered.status);
  if (!transition.ok) return; // Nothing safe to do; leave as-is.
  const eventBodies: EvidenceEventBody[] =
    status === "expired"
      ? [{ type: "challenge-expired", challengeId: challenge.id }]
      : [{ type: "challenge-failed", challengeId: challenge.id }];
  try {
    await saveMatchRecord(withChallenge(record, recovered, eventBodies));
  } catch (error) {
    // Best-effort: report but never mask the original failure.
    console.error(
      `Failed to persist challenge recovery for match ${record.matchId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Bounded post-match challenge endpoint (F10-11..13).
 *
 * Lifecycle per request: validate -> idempotency -> budget/reference checks
 * -> persist `requested` -> `responding` -> one bounded challenged-agent call
 * -> `adjudicating` -> at most one bounded judge call -> terminal state. The
 * whole lifecycle runs under an exclusive per-record lock (P0-5) so
 * concurrent duplicate requestIds cannot both reach the models; the match's
 * top-level verdict and `terminal: "completed"` are never modified.
 */
export async function POST(request: Request, context: ChallengeRouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    matchRecordPath(id);
  } catch {
    return jsonError("Match not found", 404);
  }

  const bodyText = await readBoundedJsonBody(request);
  if (bodyText === null) {
    return jsonError("Request body too large", 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const parsed = parseChallengeRequest(body);
  if (!parsed.success) {
    return jsonError(parsed.error, 400);
  }
  const challengeRequest = parsed.data;

  // P0-5: the entire lifecycle (idempotency check, budget check, persistence,
  // model calls) runs under one exclusive per-record lock, so concurrent
  // identical requestIds serialize: the first creates the challenge and calls
  // the models; the second finds it stored and returns it without calls.
  try {
    return await withRecordLock(matchRecordPath(id), async () => {
      const record = await loadMatchRecord(id);
      if (!record) {
        return jsonError("Match not found", 404);
      }

      // Idempotency: a repeated requestId returns the stored challenge
      // without calling any model again.
      const existing = findChallengeByRequestId(record.challenges, challengeRequest.requestId);
      if (existing) {
        return Response.json({ challenge: existing });
      }

      const acceptance = validateChallengeAgainstRecord(challengeRequest, record);
      if (!acceptance.ok) {
        return jsonError(acceptance.error, acceptance.status);
      }

      // Never guess a provider from providerName: legacy records without the
      // secret-free sides.providerId are rejected with a safe 409.
      const sideRecord = record.sides[acceptance.side];
      if (!sideRecord.providerId) {
        return jsonError("Match record has no provider reference for the challenged side", 409);
      }
      const agentConfig = await getProvider(sideRecord.providerId);
      if (!agentConfig) {
        return jsonError("Match record has no provider reference for the challenged side", 409);
      }
      const judgeRef = record.judge;
      if (!judgeRef) {
        return jsonError("Match has no judge provider", 409);
      }
      const judgeConfig = await getProvider(judgeRef.providerId);
      if (!judgeConfig) {
        return jsonError("Match has no judge provider", 409);
      }

      const turn = record.transcript.find((entry) => entry.id === challengeRequest.target.turnId);
      if (!turn) {
        return jsonError("Challenge target turn not found", 409);
      }

      // P0-2: only the evidence items selected in the request may reach the
      // challenge prompts. Unknown/missing refs are rejected outright.
      const selectedEvidence = selectEvidenceForChallenge(
        record.evidence,
        challengeRequest.evidenceIds,
      );
      if (selectedEvidence === undefined) {
        return jsonError("Unknown evidence reference", 409);
      }

      // P0-3: persist the server-created claim in the canonical evidence
      // bundle and link it from the selected evidence items. Legacy records
      // without an evidence bundle cannot safely accept a claim and are
      // rejected (the challenge events must reference a persisted claim).
      const now = new Date().toISOString();
      const claimId = newChallengeClaimId();
      const evidenceWithClaim = attachChallengeClaim(
        record.evidence,
        {
          id: claimId,
          text: challengeRequest.target.claimText,
          turnId: challengeRequest.target.turnId,
          side: acceptance.side,
          createdAt: now,
        },
        challengeRequest.evidenceIds,
      );
      if (evidenceWithClaim === undefined) {
        return jsonError(
          "Match record has no evidence bundle to attach the challenged claim",
          409,
        );
      }
      const bundleCheck = validateEvidenceBundle(evidenceWithClaim);
      if (!bundleCheck.success) {
        console.error(
          `Challenge claim bundle invalid for match ${record.matchId}: ${bundleCheck.error}`,
        );
        return jsonError("Unable to persist challenge claim", 500);
      }

      const challenge: MatchChallenge = {
        id: newChallengeId(),
        requestId: challengeRequest.requestId,
        matchId: record.matchId,
        status: "requested",
        side: acceptance.side,
        targetTurnId: challengeRequest.target.turnId,
        targetClaimText: challengeRequest.target.claimText,
        claimId,
        evidenceIds: challengeRequest.evidenceIds,
        createdAt: now,
        updatedAt: now,
      };

      // Persist the accepted challenge (requested) + claim + lifecycle event
      // before any model call, so a crash cannot silently lose the budget
      // slot. Later lifecycle states are persisted through the runner's
      // `onPhase` hook so every persisted transition follows the FSM.
      let persistedRecord = withChallenge(
        record,
        challenge,
        [
          {
            type: "challenge-requested",
            challengeId: challenge.id,
            claimId: challenge.claimId,
            requestId: challenge.requestId,
          },
        ],
        evidenceWithClaim,
      );
      let persistedChallenge = challenge;
      const persistPhase = async (phase: "responding" | "adjudicating"): Promise<void> => {
        const updated: MatchChallenge = {
          ...persistedChallenge,
          status: phase,
          updatedAt: new Date().toISOString(),
        };
        const nextRecord = withChallenge(persistedRecord, updated, []);
        await saveMatchRecord(nextRecord);
        persistedRecord = nextRecord;
        persistedChallenge = updated;
      };
      try {
        await saveMatchRecord(persistedRecord);
      } catch (error) {
        console.error(
          `Failed to save challenge for match ${record.matchId}:`,
          error instanceof Error ? error.message : String(error),
        );
        return jsonError("Unable to persist challenge", 500);
      }

      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(MATCH_TIMEOUT_MS)]);
      let outcome: Awaited<ReturnType<typeof runChallenge>>;
      try {
        outcome = await runChallenge(
          {
            matchId: record.matchId,
            topic: record.topic,
            side: challenge.side,
            claimText: challenge.targetClaimText,
            turnContent: turn.content,
            allowedEvidenceIds: challenge.evidenceIds,
            evidence: selectedEvidence,
            agent: { providerId: sideRecord.providerId, model: sideRecord.modelId },
            judge: { providerId: judgeRef.providerId, model: judgeRef.model },
            requestId: challenge.requestId,
          },
          { callModel: webCallModel, abortSignal: signal, onPhase: persistPhase },
        );
      } catch (error) {
        // P0-4: phase persistence failed (or the runner threw) after a
        // nonterminal challenge was saved — recover to a terminal state so
        // the active slot is never stranded. Original verdict/terminal are
        // untouched.
        console.error(
          `Challenge run failed for match ${record.matchId}:`,
          error instanceof Error ? error.message : String(error),
        );
        await persistRecovery(persistedRecord, persistedChallenge, "failed", "Challenge could not be completed");
        return jsonError("Unable to persist challenge", 500);
      }

      // Apply the outcome to the persisted challenge without ever touching
      // the match's verdict or terminal state.
      const fields = challengeOutcomeFields(challenge, outcome, new Date().toISOString());
      const finalChallenge: MatchChallenge = { ...persistedChallenge, ...fields };
      const transition = validateChallengeTransition(persistedChallenge.status, finalChallenge.status);
      if (!transition.ok) {
        // Programmer error guard: never persist an illegal transition.
        console.error(`Illegal challenge transition for ${challenge.id}: ${transition.error}`);
        await persistRecovery(persistedRecord, persistedChallenge, "failed", "Challenge ended in an invalid state");
        return jsonError("Unable to persist challenge", 500);
      }

      const eventBodies: EvidenceEventBody[] =
        outcome.outcome === "resolved"
          ? [
              {
                type: "challenge-response-recorded",
                challengeId: challenge.id,
                responseKind: "answer",
              },
              {
                type: "challenge-resolved",
                challengeId: challenge.id,
                claimStatus: outcome.adjudication.claimStatus,
              },
            ]
          : outcome.outcome === "unable"
            ? [
                {
                  type: "challenge-response-recorded",
                  challengeId: challenge.id,
                  responseKind: "unable",
                },
              ]
            : outcome.outcome === "expired"
              ? [{ type: "challenge-expired", challengeId: challenge.id }]
              : [{ type: "challenge-failed", challengeId: challenge.id }];

      const finalRecord = withChallenge(persistedRecord, finalChallenge, eventBodies);
      try {
        await saveMatchRecord(finalRecord);
      } catch (error) {
        console.error(
          `Failed to save challenge result for match ${record.matchId}:`,
          error instanceof Error ? error.message : String(error),
        );
        // P0-4: the outcome is known — retry once via the recovery path so
        // the terminal state is not lost.
        await persistRecovery(persistedRecord, persistedChallenge, "failed", "Challenge result could not be persisted");
        return jsonError("Unable to persist challenge result", 500);
      }

      return Response.json({ challenge: finalChallenge });
    });
  } catch (error) {
    if (error instanceof Error && /Another operation is in progress/.test(error.message)) {
      return jsonError("Another challenge operation is in progress for this match", 409);
    }
    throw error;
  }
}
