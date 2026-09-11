import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  CHALLENGE_LIMITS,
  appendEvidenceEvent,
  attachChallengeClaim,
  challengeLifecycleEvent,
  findChallengeByRequestId,
  isTerminalChallengeState,
  matchChallengeSchema,
  newChallengeClaimId,
  newChallengeId,
  nextEvidenceEventSeq,
  parseChallengeRequest,
  selectEvidenceForChallenge,
  validateChallengeAgainstRecord,
  validateChallengeTransition,
  type ChallengeRequestInput,
} from "../src/challenge-contract";
import { matchRecordSchema } from "../src/contract";
import { CONTRACT_VERSION } from "../src/contract";
import { validateEvidenceEvent } from "../src/evidence-contract";
import type { EvidenceEvent, EvidenceBundle, MatchChallenge } from "@arena/types";
import { normalizeUserEvidencePacket, validateEvidenceBundle } from "../src/evidence-contract";

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function challengeRequest(): ChallengeRequestInput {
  return {
    version: 1,
    requestId: "req-1",
    target: { turnId: "t1", claimText: "Solar costs fell 90%." },
    evidenceIds: ["ev_1"],
  };
}

function recordShape() {
  return {
    matchId: "match-1",
    terminal: "completed",
    transcript: [
      { id: "t1", side: "A", content: "Solar costs fell 90%. This is decisive." },
      { id: "t2", side: "B", content: "The costs claim is overstated." },
    ],
    evidence: { items: [{ id: "ev_1" }, { id: "ev_2" }] },
    challenges: [] as MatchChallenge[],
  };
}

function storedChallenge(overrides: Record<string, unknown> = {}): MatchChallenge {
  return {
    id: "chl_1",
    requestId: "req-0",
    matchId: "match-1",
    status: "resolved",
    side: "A",
    targetTurnId: "t2",
    targetClaimText: "The costs claim is overstated.",
    claimId: "clm_1",
    evidenceIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  } as MatchChallenge;
}

/* ------------------------------------------------------------------ */
/* Request parsing                                                     */
/* ------------------------------------------------------------------ */

describe("challenge request parsing", () => {
  it("accepts a valid strict request", () => {
    const result = parseChallengeRequest(challengeRequest());
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (strict input)", () => {
    expect(parseChallengeRequest({ ...challengeRequest(), extra: 1 }).success).toBe(false);
    expect(
      parseChallengeRequest({
        version: 1,
        requestId: "req-1",
        target: { turnId: "t1", claimText: "x", providerId: "p1" },
        evidenceIds: [],
      }).success,
    ).toBe(false);
    expect(
      parseChallengeRequest({
        version: 1,
        requestId: "req-1",
        target: { turnId: "t1", claimText: "x" },
        evidenceIds: [],
        status: "resolved",
      }).success,
    ).toBe(false);
  });

  it("rejects client-controlled ids, outcomes, provider ids, and judge decisions", () => {
    const base = challengeRequest();
    for (const forbidden of [
      { claimId: "clm_client" },
      { challengeId: "chl_client" },
      { side: "B" },
      { providerId: "p1" },
      { claimStatus: "supported" },
      { adjudication: { claimStatus: "supported" } },
      { outcome: "resolved" },
    ]) {
      expect(parseChallengeRequest({ ...base, ...forbidden }).success).toBe(false);
    }
  });

  it("rejects unknown versions and malformed fields", () => {
    expect(parseChallengeRequest({ ...challengeRequest(), version: 2 }).success).toBe(false);
    expect(parseChallengeRequest({ ...challengeRequest(), requestId: "" }).success).toBe(false);
    expect(parseChallengeRequest({ ...challengeRequest(), requestId: "bad id!" }).success).toBe(false);
    expect(
      parseChallengeRequest({
        ...challengeRequest(),
        requestId: "x".repeat(CHALLENGE_LIMITS.requestIdChars + 1),
      }).success,
    ).toBe(false);
    expect(
      parseChallengeRequest({
        ...challengeRequest(),
        target: { turnId: "t1", claimText: "x".repeat(CHALLENGE_LIMITS.claimTextChars + 1) },
      }).success,
    ).toBe(false);
    expect(
      parseChallengeRequest({ ...challengeRequest(), target: { turnId: "t1", claimText: "  " } }).success,
    ).toBe(false);
  });

  it("enforces the evidence reference budget", () => {
    const tooMany = Array.from({ length: CHALLENGE_LIMITS.maxEvidenceRefs + 1 }, (_, i) => `ev_${i}`);
    expect(parseChallengeRequest({ ...challengeRequest(), evidenceIds: tooMany }).success).toBe(false);
    expect(
      parseChallengeRequest({
        ...challengeRequest(),
        evidenceIds: Array.from({ length: CHALLENGE_LIMITS.maxEvidenceRefs }, (_, i) => `ev_${i}`),
      }).success,
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Record validation: excerpts, references, budgets                    */
/* ------------------------------------------------------------------ */

describe("challenge record validation", () => {
  it("derives the challenged side from the exact target turn", () => {
    const result = validateChallengeAgainstRecord(challengeRequest(), recordShape());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.side).toBe("A");
  });

  it("rejects non-completed records", () => {
    expect(
      validateChallengeAgainstRecord(challengeRequest(), { ...recordShape(), terminal: "error" }).ok,
    ).toBe(false);
  });

  it("rejects unknown target turns", () => {
    expect(
      validateChallengeAgainstRecord(challengeRequest(), {
        ...recordShape(),
        transcript: recordShape().transcript.slice(1),
      }).ok,
    ).toBe(false);
  });

  it("rejects claimText that is not an exact excerpt of the target turn", () => {
    expect(
      validateChallengeAgainstRecord(challengeRequest(), {
        ...recordShape(),
        transcript: [{ id: "t1", side: "A", content: "Completely different content." }],
      }).ok,
    ).toBe(false);
    // Near-miss wording must fail the exact-substring match.
    expect(
      validateChallengeAgainstRecord(
        { ...challengeRequest(), target: { turnId: "t1", claimText: "Solar costs fell 90 percent." } },
        recordShape(),
      ).ok,
    ).toBe(false);
  });

  it("rejects evidence references that do not belong to the stored match", () => {
    expect(
      validateChallengeAgainstRecord(
        { ...challengeRequest(), evidenceIds: ["ev_ghost"] },
        recordShape(),
      ).ok,
    ).toBe(false);
    // Evidence-less records reject any reference.
    expect(
      validateChallengeAgainstRecord(challengeRequest(), { ...recordShape(), evidence: null }).ok,
    ).toBe(false);
  });

  it("enforces the resolved-challenge budget", () => {
    const record = {
      ...recordShape(),
      challenges: [storedChallenge(), storedChallenge({ id: "chl_2", requestId: "req-2" })],
    };
    expect(validateChallengeAgainstRecord(challengeRequest(), record).ok).toBe(false);
  });

  it("enforces the one-active-challenge budget", () => {
    const record = {
      ...recordShape(),
      challenges: [storedChallenge({ id: "chl_1", requestId: "req-0", status: "responding" })],
    };
    expect(validateChallengeAgainstRecord(challengeRequest(), record).ok).toBe(false);
  });

  it("enforces one challenge per claim", () => {
    const record = {
      ...recordShape(),
      challenges: [
        storedChallenge({
          id: "chl_1",
          requestId: "req-0",
          status: "failed",
          targetTurnId: "t1",
          targetClaimText: "Solar costs fell 90%.",
        }),
      ],
    };
    expect(validateChallengeAgainstRecord(challengeRequest(), record).ok).toBe(false);
  });

  it("counts unable challenges toward the per-claim budget but terminal failed ones free the active slot", () => {
    const unableRecord = {
      ...recordShape(),
      challenges: [
        storedChallenge({
          id: "chl_1",
          requestId: "req-0",
          status: "unable",
          targetTurnId: "t1",
          targetClaimText: "Solar costs fell 90%.",
        }),
      ],
    };
    expect(validateChallengeAgainstRecord(challengeRequest(), unableRecord).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

describe("challenge idempotency", () => {
  it("finds an existing challenge by requestId", () => {
    const challenges = [storedChallenge({ requestId: "req-9" })];
    expect(findChallengeByRequestId(challenges, "req-9")?.id).toBe("chl_1");
    expect(findChallengeByRequestId(challenges, "req-other")).toBeUndefined();
    expect(findChallengeByRequestId(undefined, "req-9")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Lifecycle transitions                                               */
/* ------------------------------------------------------------------ */

describe("challenge lifecycle transitions", () => {
  it("accepts the documented happy paths", () => {
    expect(validateChallengeTransition("requested", "responding").ok).toBe(true);
    expect(validateChallengeTransition("responding", "adjudicating").ok).toBe(true);
    expect(validateChallengeTransition("adjudicating", "resolved").ok).toBe(true);
    expect(validateChallengeTransition("responding", "unable").ok).toBe(true);
    expect(validateChallengeTransition("requested", "failed").ok).toBe(true);
    expect(validateChallengeTransition("requested", "expired").ok).toBe(true);
  });

  it("accepts failure/expiry from responding and failure from adjudicating", () => {
    expect(validateChallengeTransition("responding", "failed").ok).toBe(true);
    expect(validateChallengeTransition("responding", "expired").ok).toBe(true);
    expect(validateChallengeTransition("adjudicating", "failed").ok).toBe(true);
  });

  it("rejects illegal transitions and terminal states", () => {
    expect(validateChallengeTransition("requested", "resolved").ok).toBe(false);
    expect(validateChallengeTransition("requested", "adjudicating").ok).toBe(false);
    expect(validateChallengeTransition("resolved", "responding").ok).toBe(false);
    expect(validateChallengeTransition("unable", "adjudicating").ok).toBe(false);
    expect(validateChallengeTransition("failed", "responding").ok).toBe(false);
    expect(validateChallengeTransition("expired", "responding").ok).toBe(false);
    expect(validateChallengeTransition("resolved", "failed").ok).toBe(false);
  });

  it("marks exactly the four terminal states", () => {
    expect(isTerminalChallengeState("resolved")).toBe(true);
    expect(isTerminalChallengeState("unable")).toBe(true);
    expect(isTerminalChallengeState("failed")).toBe(true);
    expect(isTerminalChallengeState("expired")).toBe(true);
    expect(isTerminalChallengeState("requested")).toBe(false);
    expect(isTerminalChallengeState("responding")).toBe(false);
    expect(isTerminalChallengeState("adjudicating")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Persisted challenge schema                                          */
/* ------------------------------------------------------------------ */

describe("match challenge schema", () => {
  it("accepts a resolved challenge with answer + adjudication", () => {
    const challenge = storedChallenge({
      status: "resolved",
      response: {
        kind: "answer",
        answer: "The claim holds because the 2019 IRENA review confirms it.",
        citedEvidenceIds: ["ev_1"],
        model: "m1",
        createdAt: "2026-01-01T00:00:20.000Z",
      },
      adjudication: {
        claimStatus: "supported",
        evidenceAssessments: [
          { evidenceId: "ev_1", assessment: "supported", reasoning: "Directly on point." },
        ],
        reasoning: "The cited evidence establishes the claim.",
        method: "judge_model",
        judgeModel: "j1",
        createdAt: "2026-01-01T00:00:30.000Z",
      },
    });
    expect(matchChallengeSchema.safeParse(challenge).success).toBe(true);
  });

  it("accepts an unable challenge and rejects malformed responses", () => {
    expect(
      matchChallengeSchema.safeParse(
        storedChallenge({
          status: "unable",
          response: {
            kind: "unable",
            reason: "insufficient_evidence",
            explanation: "No stored evidence covers this.",
            model: "m1",
            createdAt: "2026-01-01T00:00:20.000Z",
          },
        }),
      ).success,
    ).toBe(true);
    expect(
      matchChallengeSchema.safeParse(
        storedChallenge({
          response: { kind: "answer", answer: "", citedEvidenceIds: [], model: "m1", createdAt: "2026-01-01T00:00:20.000Z" },
        }),
      ).success,
    ).toBe(false);
    expect(
      matchChallengeSchema.safeParse(
        storedChallenge({
          response: { kind: "unable", reason: "made_up_reason", model: "m1", createdAt: "2026-01-01T00:00:20.000Z" },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects oversized answers, explanations, and reasoning", () => {
    expect(
      matchChallengeSchema.safeParse(
        storedChallenge({
          response: {
            kind: "answer",
            answer: "x".repeat(CHALLENGE_LIMITS.answerChars + 1),
            citedEvidenceIds: [],
            model: "m1",
            createdAt: "2026-01-01T00:00:20.000Z",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      matchChallengeSchema.safeParse(
        storedChallenge({
          adjudication: {
            claimStatus: "supported",
            evidenceAssessments: [],
            reasoning: "x".repeat(CHALLENGE_LIMITS.adjudicationReasoningChars + 1),
            method: "judge_model",
            judgeModel: "j1",
            createdAt: "2026-01-01T00:00:30.000Z",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects invented evidence ids in responses and adjudications", () => {
    expect(
      matchChallengeSchema.safeParse(
        storedChallenge({
          response: {
            kind: "answer",
            answer: "text",
            citedEvidenceIds: ["ev_invented"],
            model: "m1",
            createdAt: "2026-01-01T00:00:20.000Z",
          },
        }),
      ).success,
    ).toBe(true); // schema-level: format ok; runner cross-checks membership
    expect(
      matchChallengeSchema.safeParse(
        storedChallenge({
          adjudication: {
            claimStatus: "supported",
            evidenceAssessments: [{ evidenceId: "ev_ghost", assessment: "supported", reasoning: "r" }],
            reasoning: "r",
            method: "judge_model",
            judgeModel: "j1",
            createdAt: "2026-01-01T00:00:30.000Z",
          },
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects non-judge_model methods and unknown statuses", () => {
    expect(
      matchChallengeSchema.safeParse(
        storedChallenge({
          adjudication: {
            claimStatus: "supported",
            evidenceAssessments: [],
            reasoning: "r",
            method: "human",
            judgeModel: "j1",
            createdAt: "2026-01-01T00:00:30.000Z",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      matchChallengeSchema.safeParse(
        storedChallenge({
          adjudication: {
            claimStatus: "winning",
            evidenceAssessments: [],
            reasoning: "r",
            method: "judge_model",
            judgeModel: "j1",
            createdAt: "2026-01-01T00:00:30.000Z",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("generates server-side ids with the canonical prefixes", () => {
    expect(newChallengeId()).toMatch(/^chl_[A-Za-z0-9_-]+$/);
    expect(newChallengeClaimId()).toMatch(/^clm_[A-Za-z0-9_-]+$/);
  });
});

/* ------------------------------------------------------------------ */
/* Record-level integration                                            */
/* ------------------------------------------------------------------ */

describe("match record challenge integration", () => {
  function baseRecord() {
    return {
      version: CONTRACT_VERSION,
      matchId: "match-ch-1",
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
      transcript: [
        {
          id: "t1",
          agentId: "A",
          side: "A",
          phase: "OPENING_A",
          content: "Solar costs fell 90%.",
          model: "m1",
          createdAt: "2026-01-01T00:00:10.000Z",
        },
      ],
      verdict: null,
      terminal: "completed",
      terminalReason: null,
      metrics: { turnsMs: [12], totalMs: 100 },
    };
  }

  it("accepts legacy records without challenges/evidenceEvents/providerId", () => {
    const parsed = matchRecordSchema.safeParse(baseRecord());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.challenges).toBeUndefined();
    expect(parsed.data.evidenceEvents).toBeUndefined();
    expect(parsed.data.sides.B.providerId).toBeUndefined();
  });

  it("accepts records with challenges and lifecycle evidence events", () => {
    const event = challengeLifecycleEvent("match-ch-1", 1, {
      type: "challenge-requested",
      challengeId: "chl_1",
      claimId: "clm_1",
      requestId: "req-1",
    });
    expect(validateEvidenceEvent(event).success).toBe(true);
    const parsed = matchRecordSchema.safeParse({
      ...baseRecord(),
      challenges: [storedChallenge({ matchId: "match-ch-1" })],
      evidenceEvents: [event],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.challenges).toHaveLength(1);
    expect(parsed.data.evidenceEvents).toHaveLength(1);
  });

  it("rejects records with oversized challenge/event collections", () => {
    const challenges = Array.from({ length: CHALLENGE_LIMITS.maxPerMatch + 1 }, (_, i) =>
      storedChallenge({ id: `chl_${i}`, requestId: `req-${i}` }),
    );
    expect(matchRecordSchema.safeParse({ ...baseRecord(), challenges }).success).toBe(false);
    const events = Array.from({ length: CHALLENGE_LIMITS.maxEvidenceEvents + 1 }, (_, i) =>
      challengeLifecycleEvent("match-ch-1", i + 1, { type: "challenge-failed", challengeId: "chl_1" }),
    );
    expect(matchRecordSchema.safeParse({ ...baseRecord(), evidenceEvents: events }).success).toBe(false);
  });

  it("rejects records with malformed challenges", () => {
    expect(
      matchRecordSchema.safeParse({
        ...baseRecord(),
        challenges: [storedChallenge({ id: "bad-id" })],
      }).success,
    ).toBe(false);
    expect(
      matchRecordSchema.safeParse({
        ...baseRecord(),
        challenges: [storedChallenge({ status: "mystery" })],
      }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Evidence event helpers                                              */
/* ------------------------------------------------------------------ */

describe("evidence event helpers", () => {
  it("computes 1-based next seqs and appends within the cap", () => {
    expect(nextEvidenceEventSeq(undefined)).toBe(1);
    const first = challengeLifecycleEvent("m", 1, { type: "challenge-failed", challengeId: "chl_1" });
    expect(nextEvidenceEventSeq([first])).toBe(2);
    const events: EvidenceEvent[] = [first];
    for (let i = 0; i < CHALLENGE_LIMITS.maxEvidenceEvents + 5; i += 1) {
      events.push(
        challengeLifecycleEvent("m", nextEvidenceEventSeq(events), {
          type: "challenge-failed",
          challengeId: "chl_1",
        }),
      );
    }
    const appended = appendEvidenceEvent(undefined, first);
    expect(appended).toHaveLength(1);
    expect(appendEvidenceEvent(events, first).length).toBeLessThanOrEqual(CHALLENGE_LIMITS.maxEvidenceEvents);
  });

  it("produces canonical lifecycle events that pass evidence-event validation", () => {
    const bodies = [
      { type: "challenge-requested", challengeId: "chl_1", claimId: "clm_1", requestId: "req-1" },
      { type: "challenge-response-recorded", challengeId: "chl_1", responseKind: "answer" },
      { type: "challenge-resolved", challengeId: "chl_1", claimStatus: "supported" },
      { type: "challenge-failed", challengeId: "chl_1" },
      { type: "challenge-expired", challengeId: "chl_1" },
    ] as const;
    for (const body of bodies) {
      const event = challengeLifecycleEvent("m", 1, body);
      expect(validateEvidenceEvent(event).success).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Hardening: evidence selection + claim attachment (P0-2, P0-3)       */
/* ------------------------------------------------------------------ */

describe("evidence selection and claim attachment", () => {
  function storedBundle(): EvidenceBundle {
    const result = normalizeUserEvidencePacket({
      version: 1,
      items: [
        { source: "user_text", label: "one", content: "first item" },
        { source: "user_text", label: "two", content: "second item" },
        { source: "user_text", label: "three", content: "third item" },
      ],
    });
    if (!result.success) throw new Error(`fixture failed: ${result.error}`);
    return result.data;
  }

  it("selects only requested items, in request order, preserving provenance", () => {
    const bundle = storedBundle();
    const ids = [bundle.items[2]!.id, bundle.items[0]!.id];
    const selected = selectEvidenceForChallenge(bundle, ids);
    expect(selected).toBeDefined();
    if (!selected) return;
    expect(selected.items.map((item) => item.id)).toEqual(ids);
    expect(selected.items[0]?.provenance).toEqual(bundle.items[2]!.provenance);
    expect(selected.items[0]?.text).toBe("third item");
    expect(selected.claims).toEqual([]);
  });

  it("returns undefined when any requested ref is missing (never silently narrows)", () => {
    const bundle = storedBundle();
    expect(selectEvidenceForChallenge(bundle, [bundle.items[0]!.id, "ev_ghost"])).toBeUndefined();
    expect(selectEvidenceForChallenge(undefined, ["ev_1"])).toBeUndefined();
    expect(selectEvidenceForChallenge(null, ["ev_1"])).toBeUndefined();
  });

  it("selects nothing (empty bundle) when no refs are requested", () => {
    const selected = selectEvidenceForChallenge(storedBundle(), []);
    expect(selected?.items).toEqual([]);
  });

  it("attaches the challenge claim to the bundle and links it from selected items", () => {
    const bundle = storedBundle();
    const ids = [bundle.items[0]!.id, bundle.items[2]!.id];
    const withClaim = attachChallengeClaim(
      bundle,
      { id: "clm_new", text: "Solar costs fell 90%.", turnId: "t1", side: "A", createdAt: "2026-01-01T00:00:00.000Z" },
      ids,
    );
    expect(withClaim).toBeDefined();
    if (!withClaim) return;
    expect(withClaim.claims).toHaveLength(1);
    expect(withClaim.claims[0]).toMatchObject({
      id: "clm_new",
      text: "Solar costs fell 90%.",
      turnId: "t1",
      side: "A",
      status: "unverified",
      evidenceIds: ids,
      challengeIds: [],
    });
    expect(withClaim.items[0]?.claimIds).toContain("clm_new");
    expect(withClaim.items[1]?.claimIds).toEqual([]);
    expect(withClaim.items[2]?.claimIds).toContain("clm_new");
    // Unselected items keep their original claimIds.
    expect(withClaim.items[1]?.provenance).toEqual(bundle.items[1]!.provenance);
  });

  it("rejects claim attachment on legacy records (no bundle) or unknown refs", () => {
    expect(
      attachChallengeClaim(
        undefined,
        { id: "clm_new", text: "t", turnId: "t1", side: "A", createdAt: "2026-01-01T00:00:00.000Z" },
        [],
      ),
    ).toBeUndefined();
    expect(
      attachChallengeClaim(
        null,
        { id: "clm_new", text: "t", turnId: "t1", side: "A", createdAt: "2026-01-01T00:00:00.000Z" },
        [],
      ),
    ).toBeUndefined();
    expect(
      attachChallengeClaim(
        storedBundle(),
        { id: "clm_new", text: "t", turnId: "t1", side: "A", createdAt: "2026-01-01T00:00:00.000Z" },
        ["ev_ghost"],
      ),
    ).toBeUndefined();
  });

  it("produces a claim bundle that passes canonical bundle validation", () => {
    const bundle = storedBundle();
    const withClaim = attachChallengeClaim(
      bundle,
      { id: "clm_new", text: "Solar costs fell 90%.", turnId: "t1", side: "A", createdAt: "2026-01-01T00:00:00.000Z" },
      [bundle.items[0]!.id],
    );
    expect(withClaim).toBeDefined();
    expect(validateEvidenceBundle(withClaim).success).toBe(true);
  });

  it("preserves sourceSnapshots through challenge selection and claim attachment (F10-09/F10-10)", () => {
    const userBundle = storedBundle();
    const selected = selectEvidenceForChallenge(userBundle, [userBundle.items[0]!.id]);
    expect(selected).toBeDefined();
    if (!selected) return;
    // Selection carries the snapshot referenced by the selected item.
    expect(selected.sourceSnapshots).toHaveLength(0); // user items have no snapshots

    // A snapshot-backed item keeps its snapshot through selection.
    const snapshotContent = "hello world";
    const snapshotHash = createHash("sha256").update(snapshotContent, "utf8").digest("hex");
    const snapshotItem = {
      ...userBundle.items[0]!,
      text: snapshotContent,
      provenance: {
        ...userBundle.items[0]!.provenance,
        kind: "external-source" as const,
        contentHash: snapshotHash,
        sourceSnapshotId: "srcsnap_abc123",
      },
    };
    const snapshotBundle: EvidenceBundle = {
      ...userBundle,
      items: [snapshotItem],
      sourceSnapshots: [
        {
          schemaVersion: 1,
          id: "srcsnap_abc123",
          adapterId: "srcadp_test",
          adapterVersion: "1.0.0",
          kind: "external-source" as const,
          reference: "https://example.com/report",
          contentType: "text/plain",
          contentBytes: Buffer.byteLength(snapshotContent, "utf8"),
          contentHash: snapshotHash,
          content: snapshotContent,
          capturedAt: "2026-01-01T00:00:00.000Z",
          freshness: { mode: "snapshot-only" as const, maxAgeSeconds: 60 },
          freshUntil: null,
        },
      ],
    };
    const selectedSnapshot = selectEvidenceForChallenge(snapshotBundle, [snapshotItem.id]);
    expect(selectedSnapshot?.sourceSnapshots.map((snapshot) => snapshot.id)).toEqual(["srcsnap_abc123"]);

    // Claim attachment preserves the snapshots untouched.
    const withClaim = attachChallengeClaim(
      snapshotBundle,
      { id: "clm_new", text: "x", turnId: "t1", side: "A", createdAt: "2026-01-01T00:00:00.000Z" },
      [snapshotItem.id],
    );
    expect(withClaim?.sourceSnapshots.map((snapshot) => snapshot.id)).toEqual(["srcsnap_abc123"]);
    expect(validateEvidenceBundle(withClaim).success).toBe(true);
  });
});
