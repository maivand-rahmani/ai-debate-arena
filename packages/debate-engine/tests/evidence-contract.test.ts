import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  CAPABILITY_SCHEMA_VERSION,
  EVIDENCE_LIMITS,
  EVIDENCE_SCHEMA_VERSION,
  USER_EVIDENCE_LIMITS,
  capabilityRequestSchema,
  challengeSchema,
  claimSchema,
  emptyEvidenceBundle,
  evidenceBundleSchema,
  evidenceEventSchema,
  negotiateCapabilities,
  normalizeLegacyEvidence,
  normalizeUserEvidencePacket,
  proofResultSchema,
  provenanceSchema,
  sandboxCapabilitiesSchema,
  userEvidencePacketInputSchema,
  validateCapabilityRequest,
  validateEvidenceBundle,
  validateEvidenceEvent,
  validateSandboxCapabilities,
} from "../src/evidence-contract";
import { CONTRACT_VERSION, matchConfigSchema, matchRecordSchema, transcriptTurnSchema } from "../src/contract";

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function validProvenance() {
  return {
    kind: "external-source" as const,
    origin: "user",
    reference: "https://example.org/report",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    contentHash: "a".repeat(64),
    extractionMethod: "manual-paste",
  };
}

function validClaim() {
  return {
    id: "clm_1",
    text: "Solar costs fell 90% in a decade",
    turnId: "OPENING_A",
    side: "A" as const,
    status: "unverified" as const,
    evidenceIds: ["ev_1"],
    challengeIds: [],
    createdAt: "2026-01-01T00:00:10.000Z",
  };
}

function validEvidenceItem() {
  return {
    id: "ev_1",
    text: "\"Solar module prices dropped by an order of magnitude between 2010 and 2020.\"",
    claimIds: ["clm_1"],
    provenance: validProvenance(),
    status: "supported" as const,
    createdAt: "2026-01-01T00:00:11.000Z",
  };
}

function validChallenge() {
  return {
    id: "chl_1",
    targetClaimId: "clm_1",
    text: "That figure is cherry-picked; capacity-weighted costs fell less.",
    side: "B" as const,
    responseBudget: 2,
    createdAt: "2026-01-01T00:00:12.000Z",
  };
}

function validResponse() {
  return {
    id: "rsp_1",
    challengeId: "chl_1",
    text: "IRENA's 2019 review confirms the order-of-magnitude decline.",
    side: "A" as const,
    outcome: "upheld" as const,
    createdAt: "2026-01-01T00:00:13.000Z",
  };
}

function validProof() {
  return {
    evidenceId: "ev_1",
    status: "verified" as const,
    data: { message: "URL resolved; quote found in section 2", score: 0.9 },
    verifiedAt: "2026-01-01T00:00:14.000Z",
  };
}

function validBundle() {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    claims: [validClaim()],
    items: [validEvidenceItem()],
    challenges: [validChallenge()],
    responses: [validResponse()],
    proofs: [validProof()],
    sourceSnapshots: [],
  };
}

function validRecordWithExtensions() {
  return {
    version: CONTRACT_VERSION,
    matchId: "match-ev-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    topic: "Should AI be regulated?",
    mode: "quick",
    sides: {
      A: { providerName: "Provider One", modelId: "m1", position: "FOR" },
      B: { providerName: "Provider Two", modelId: "m2", position: "AGAINST" },
    },
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
        content: "Opening case.",
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

/* ------------------------------------------------------------------ */
/* Valid contracts                                                     */
/* ------------------------------------------------------------------ */

describe("evidence contract — valid payloads", () => {
  it("accepts a fully-populated bundle", () => {
    const result = validateEvidenceBundle(validBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
      expect(result.data.claims[0]?.evidenceIds).toEqual(["ev_1"]);
    }
  });

  it("accepts an empty bundle", () => {
    expect(validateEvidenceBundle(emptyEvidenceBundle()).success).toBe(true);
  });

  it("accepts agent-turn provenance with turnId and requires the F10-05 audit fields", () => {
    expect(
      provenanceSchema.safeParse({
        kind: "agent-turn",
        origin: "p1",
        reference: "OPENING_A",
        turnId: "OPENING_A",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        contentHash: "b".repeat(64),
        extractionMethod: "quote",
      }).success,
    ).toBe(true);
    expect(provenanceSchema.safeParse(validProvenance()).success).toBe(true);
  });

  it("accepts every F10-04 status value and rejects legacy ones", () => {
    for (const status of ["supported", "contradicted", "insufficient", "unverified", "unavailable"]) {
      expect(claimSchema.safeParse({ ...validClaim(), status }).success).toBe(true);
      expect(
        evidenceBundleSchema.safeParse({ ...validBundle(), claims: [{ ...validClaim(), status }] })
          .success,
      ).toBe(true);
    }
    for (const legacy of ["draft", "submitted", "challenged", "upheld", "rejected", "withdrawn"]) {
      expect(claimSchema.safeParse({ ...validClaim(), status: legacy }).success).toBe(false);
    }
  });

  it("rejects provenance missing any F10-05 auditable field", () => {
    expect(provenanceSchema.safeParse({ kind: "agent-turn" }).success).toBe(false);
    // agent-turn provenance without turnId
    expect(
      provenanceSchema.safeParse({ ...validProvenance(), kind: "agent-turn" }).success,
    ).toBe(false);
    // missing origin
    const { origin: _origin, ...noOrigin } = validProvenance();
    void _origin;
    expect(provenanceSchema.safeParse(noOrigin).success).toBe(false);
    // missing timestamp
    const { retrievedAt: _retrievedAt, ...noTimestamp } = validProvenance();
    void _retrievedAt;
    expect(provenanceSchema.safeParse(noTimestamp).success).toBe(false);
    // missing content hash
    const { contentHash: _contentHash, ...noHash } = validProvenance();
    void _contentHash;
    expect(provenanceSchema.safeParse(noHash).success).toBe(false);
    // missing extraction method
    const { extractionMethod: _extractionMethod, ...noMethod } = validProvenance();
    void _extractionMethod;
    expect(provenanceSchema.safeParse(noMethod).success).toBe(false);
  });

  it("rejects malformed content hashes and oversized origins/methods", () => {
    expect(
      provenanceSchema.safeParse({ ...validProvenance(), contentHash: "not-hex" }).success,
    ).toBe(false);
    expect(
      provenanceSchema.safeParse({ ...validProvenance(), contentHash: "a".repeat(15) }).success,
    ).toBe(false);
    expect(
      provenanceSchema.safeParse({ ...validProvenance(), contentHash: "a".repeat(129) }).success,
    ).toBe(false);
    expect(provenanceSchema.safeParse({ ...validProvenance(), origin: "" }).success).toBe(false);
    expect(
      provenanceSchema.safeParse({ ...validProvenance(), origin: "x".repeat(129) }).success,
    ).toBe(false);
    expect(
      provenanceSchema.safeParse({ ...validProvenance(), extractionMethod: " " }).success,
    ).toBe(false);
  });

  it("accepts a valid evidence event envelope", () => {
    const event = {
      eventVersion: 1,
      matchId: "match-ev-1",
      seq: 1,
      type: "evidence-added" as const,
      evidenceId: "ev_1",
      claimIds: ["clm_1"],
    };
    const result = validateEvidenceEvent(event);
    expect(result.success).toBe(true);
  });

  it("validates status-changed events against F10-04 statuses", () => {
    expect(
      validateEvidenceEvent({
        eventVersion: 1,
        matchId: "match-ev-1",
        seq: 1,
        type: "status-changed",
        entityKind: "claim",
        entityId: "clm_1",
        from: "unverified",
        to: "supported",
      }).success,
    ).toBe(true);
    expect(
      validateEvidenceEvent({
        eventVersion: 1,
        matchId: "match-ev-1",
        seq: 1,
        type: "status-changed",
        entityKind: "claim",
        entityId: "clm_1",
        from: "draft",
        to: "supported",
      }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Invalid payloads                                                    */
/* ------------------------------------------------------------------ */

describe("evidence contract — invalid payloads", () => {
  it("rejects oversized ids/text and bad metadata", () => {
    expect(claimSchema.safeParse({ ...validClaim(), id: "bad id!" }).success).toBe(false);
    expect(
      claimSchema.safeParse({ ...validClaim(), text: "x".repeat(EVIDENCE_LIMITS.textChars + 1) })
        .success,
    ).toBe(false);
    const metadata = Object.fromEntries(
      Array.from({ length: EVIDENCE_LIMITS.metadataEntries + 1 }, (_, i) => [`k${i}`, "v"]),
    );
    expect(claimSchema.safeParse({ ...validClaim(), metadata }).success).toBe(false);
  });

  it("rejects a bundle over the packet-size limit", () => {
    const filler = "x".repeat(EVIDENCE_LIMITS.textChars);
    const items = Array.from({ length: EVIDENCE_LIMITS.items }, (_, i) => ({
      ...validEvidenceItem(),
      id: `ev_${i}`,
      text: filler,
      claimIds: [`clm_${i % 8}`],
    }));
    const claims = Array.from({ length: 8 }, (_, i) => ({
      ...validClaim(),
      id: `clm_${i}`,
      evidenceIds: [],
    }));
    const bundle = { ...validBundle(), claims, items };
    const result = validateEvidenceBundle(bundle);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/exceeds .* chars/);
  });

  it("rejects missing and dangling references", () => {
    // claim -> missing evidence
    expect(
      validateEvidenceBundle({ ...validBundle(), items: [{ ...validEvidenceItem(), id: "ev_x" }] })
        .success,
    ).toBe(false);
    // evidence -> missing claim
    expect(
      validateEvidenceBundle({
        ...validBundle(),
        items: [{ ...validEvidenceItem(), claimIds: ["clm_missing"] }],
      }).success,
    ).toBe(false);
    // challenge -> missing target claim
    expect(
      validateEvidenceBundle({
        ...validBundle(),
        challenges: [{ ...validChallenge(), targetClaimId: "clm_missing" }],
      }).success,
    ).toBe(false);
    // response -> missing challenge
    expect(
      validateEvidenceBundle({
        ...validBundle(),
        responses: [{ ...validResponse(), challengeId: "chl_missing" }],
      }).success,
    ).toBe(false);
    // proof -> missing evidence
    expect(
      validateEvidenceBundle({
        ...validBundle(),
        proofs: [{ ...validProof(), evidenceId: "ev_missing" }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate ids across the whole bundle", () => {
    expect(
      validateEvidenceBundle({
        ...validBundle(),
        items: [validEvidenceItem(), { ...validEvidenceItem(), claimIds: ["clm_1"] }],
      }).success,
    ).toBe(false);
    expect(
      validateEvidenceBundle({
        ...validBundle(),
        responses: [validResponse(), { ...validResponse(), id: "ev_1" }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown versions instead of parsing them as v1", () => {
    expect(
      evidenceBundleSchema.safeParse({ ...validBundle(), schemaVersion: 2 }).success,
    ).toBe(false);
    expect(evidenceBundleSchema.safeParse({ ...validBundle(), schemaVersion: undefined }).success)
      .toBe(false);
    expect(
      evidenceEventSchema.safeParse({
        eventVersion: 2,
        matchId: "m",
        seq: 1,
        type: "claim-added",
        claimId: "clm_1",
      }).success,
    ).toBe(false);
    expect(
      capabilityRequestSchema.safeParse({
        schemaVersion: 2,
        permissions: { "net.fetch": true },
      }).success,
    ).toBe(false);
    expect(
      sandboxCapabilitiesSchema.safeParse({
        schemaVersion: 2,
        permissions: { "fs.read": false, "fs.write": false, "net.fetch": false, "process.spawn": false },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown event discriminants and malformed envelopes", () => {
    expect(
      evidenceEventSchema.safeParse({
        eventVersion: 1,
        matchId: "m",
        seq: 1,
        type: "claim-exploded",
        claimId: "clm_1",
      }).success,
    ).toBe(false);
    expect(
      evidenceEventSchema.safeParse({ eventVersion: 1, seq: 1, type: "claim-added", claimId: "clm_1" })
        .success,
    ).toBe(false);
    // seq must be positive (1-based); zero and negative are rejected.
    expect(
      evidenceEventSchema.safeParse({
        eventVersion: 1,
        matchId: "m",
        seq: 0,
        type: "claim-added",
        claimId: "clm_1",
      }).success,
    ).toBe(false);
    expect(
      evidenceEventSchema.safeParse({
        eventVersion: 1,
        matchId: "m",
        seq: -1,
        type: "claim-added",
        claimId: "clm_1",
      }).success,
    ).toBe(false);
    expect(
      evidenceEventSchema.safeParse({
        eventVersion: 1,
        matchId: "m",
        seq: 1.5,
        type: "claim-added",
        claimId: "clm_1",
      }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Challenge budgets                                                   */
/* ------------------------------------------------------------------ */

describe("evidence contract — challenge budgets", () => {
  it("rejects non-finite and out-of-range budgets", () => {
    expect(challengeSchema.safeParse({ ...validChallenge(), responseBudget: 1.5 }).success)
      .toBe(false);
    expect(challengeSchema.safeParse({ ...validChallenge(), responseBudget: -1 }).success)
      .toBe(false);
    expect(
      challengeSchema.safeParse({ ...validChallenge(), responseBudget: Number.POSITIVE_INFINITY })
        .success,
    ).toBe(false);
    expect(
      challengeSchema.safeParse({
        ...validChallenge(),
        responseBudget: EVIDENCE_LIMITS.responsesPerChallenge + 1,
      }).success,
    ).toBe(false);
  });

  it("rejects responses exceeding the challenge budget", () => {
    const budgetZero = validateEvidenceBundle({
      ...validBundle(),
      challenges: [{ ...validChallenge(), responseBudget: 0 }],
    });
    expect(budgetZero.success).toBe(false);
    if (!budgetZero.success) expect(budgetZero.error).toMatch(/exceeding budget 0/);

    const overBudget = validateEvidenceBundle({
      ...validBundle(),
      challenges: [{ ...validChallenge(), responseBudget: 2 }],
      responses: [validResponse(), { ...validResponse(), id: "rsp_2" }, { ...validResponse(), id: "rsp_3" }],
    });
    expect(overBudget.success).toBe(false);
    if (!overBudget.success) expect(overBudget.error).toMatch(/exceeding budget 2/);
  });

  it("accepts responses within the budget", () => {
    const within = validateEvidenceBundle({
      ...validBundle(),
      challenges: [{ ...validChallenge(), responseBudget: 2 }],
      responses: [validResponse(), { ...validResponse(), id: "rsp_2" }],
    });
    expect(within.success).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Proof safety                                                        */
/* ------------------------------------------------------------------ */

describe("evidence contract — proof result safety", () => {
  it("rejects unsafe proof data shapes", () => {
    // Deeply nested object
    expect(
      proofResultSchema.safeParse({
        ...validProof(),
        data: { details: { nested: { deeper: "no" } } },
      }).success,
    ).toBe(false);
    // Non-finite number
    expect(proofResultSchema.safeParse({ ...validProof(), data: { score: Number.NaN } }).success)
      .toBe(false);
    // Oversized message
    expect(
      proofResultSchema.safeParse({
        ...validProof(),
        data: { message: "x".repeat(EVIDENCE_LIMITS.metadataValueChars + 1) },
      }).success,
    ).toBe(false);
    // Out-of-range score
    expect(proofResultSchema.safeParse({ ...validProof(), data: { score: 5 } }).success).toBe(false);
  });

  it("accepts bounded, scalar-only proof data", () => {
    expect(proofResultSchema.safeParse(validProof()).success).toBe(true);
    expect(proofResultSchema.safeParse({ ...validProof(), data: undefined }).success).toBe(true);
    expect(
      proofResultSchema.safeParse({
        ...validProof(),
        status: "unavailable",
        data: { message: "host unreachable", details: { attempts: 3, cached: false, body: null } },
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate proofs for the same evidence item", () => {
    expect(
      validateEvidenceBundle({ ...validBundle(), proofs: [validProof(), validProof()] }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

describe("evidence contract — capability denial and defaults", () => {
  it("rejects unknown permission names", () => {
    const result = validateCapabilityRequest({
      schemaVersion: CAPABILITY_SCHEMA_VERSION,
      permissions: { "net.fetch": true, "root.everything": true },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/unknown sandbox permissions/);
  });

  it("denies everything by default when nothing is requested", () => {
    const result = validateCapabilityRequest({
      schemaVersion: CAPABILITY_SCHEMA_VERSION,
      permissions: {},
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const caps = negotiateCapabilities(result.data, {});
    expect(caps.schemaVersion).toBe(CAPABILITY_SCHEMA_VERSION);
    expect(Object.values(caps.permissions).every((granted) => granted === false)).toBe(true);
  });

  it("grants only requested-and-allowed permissions", () => {
    const request = {
      schemaVersion: CAPABILITY_SCHEMA_VERSION,
      permissions: { "net.fetch": true, "fs.read": true, "fs.write": true },
    };
    const caps = negotiateCapabilities(request, { "net.fetch": true });
    expect(caps.permissions).toEqual({
      "fs.read": false,
      "fs.write": false,
      "net.fetch": true,
      "process.spawn": false,
    });
  });

  it("denies requested permissions when the host does not allow them", () => {
    const caps = negotiateCapabilities(
      { schemaVersion: CAPABILITY_SCHEMA_VERSION, permissions: { "process.spawn": true } },
      {},
    );
    expect(caps.permissions["process.spawn"]).toBe(false);
  });

  it("validates sandbox capability snapshots strictly", () => {
    expect(
      validateSandboxCapabilities({
        schemaVersion: 1,
        permissions: { "fs.read": false, "fs.write": false, "net.fetch": false, "process.spawn": false },
      }).success,
    ).toBe(true);
    expect(
      validateSandboxCapabilities({
        schemaVersion: 1,
        permissions: { "fs.read": false, "fs.write": false, "net.fetch": false },
      }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Legacy normalization                                                */
/* ------------------------------------------------------------------ */

describe("evidence contract — legacy normalization", () => {
  it("normalizes records lacking extensions to empty evidence", () => {
    expect(normalizeLegacyEvidence(undefined)).toEqual(emptyEvidenceBundle());
    expect(normalizeLegacyEvidence(null)).toEqual(emptyEvidenceBundle());
    expect(normalizeLegacyEvidence({})).toEqual(emptyEvidenceBundle());
    expect(normalizeLegacyEvidence({ verdict: null, transcript: [] })).toEqual(
      emptyEvidenceBundle(),
    );
  });

  it("normalizes unknown-version payloads to empty instead of parsing as v1", () => {
    const mutated = { ...validBundle(), schemaVersion: 2 };
    expect(normalizeLegacyEvidence(mutated)).toEqual(emptyEvidenceBundle());
    expect(normalizeLegacyEvidence({ claims: [validClaim()] })).toEqual(emptyEvidenceBundle());
  });

  it("round-trips a valid v1 bundle unchanged", () => {
    const bundle = validBundle();
    const normalized = normalizeLegacyEvidence(JSON.parse(JSON.stringify(bundle)));
    expect(normalized).toEqual(bundle);
  });

  it("normalizes v1-stamped but invalid payloads to empty", () => {
    const broken = { ...validBundle(), claims: [{ ...validClaim(), evidenceIds: ["ev_ghost"] }] };
    expect(normalizeLegacyEvidence(broken)).toEqual(emptyEvidenceBundle());
  });

  it("keeps legacy match records parseable with all-disabled defaults", () => {
    const record = validRecordWithExtensions();
    const parsed = matchRecordSchema.safeParse(record);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.evidence).toBeUndefined();
    expect(parsed.data.capabilities).toBeUndefined();
    expect(normalizeLegacyEvidence(parsed.data.evidence)).toEqual(emptyEvidenceBundle());
    const caps = parsed.data.capabilities ?? {
      schemaVersion: CAPABILITY_SCHEMA_VERSION,
      permissions: {
        "fs.read": false,
        "fs.write": false,
        "net.fetch": false,
        "process.spawn": false,
      },
    };
    expect(Object.values(caps.permissions).every((granted) => granted === false)).toBe(true);
  });

  it("accepts records carrying optional evidence/capability snapshots", () => {
    const record = {
      ...validRecordWithExtensions(),
      evidence: validBundle(),
      capabilities: {
        schemaVersion: CAPABILITY_SCHEMA_VERSION,
        permissions: {
          "fs.read": true,
          "fs.write": false,
          "net.fetch": true,
          "process.spawn": false,
        },
      },
    };
    const parsed = matchRecordSchema.safeParse(record);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.evidence?.items).toHaveLength(1);
    expect(parsed.data.capabilities?.permissions["net.fetch"]).toBe(true);
  });

  it("rejects records carrying invalid or unknown-version snapshots", () => {
    expect(
      matchRecordSchema.safeParse({
        ...validRecordWithExtensions(),
        evidence: { ...validBundle(), schemaVersion: 2 },
      }).success,
    ).toBe(false);
    expect(
      matchRecordSchema.safeParse({
        ...validRecordWithExtensions(),
        evidence: { ...validBundle(), items: [{ ...validEvidenceItem(), claimIds: ["clm_ghost"] }] },
      }).success,
    ).toBe(false);
  });

  it("accepts transcript turns with optional claim/evidence references", () => {
    const base = {
      id: "t1",
      agentId: "A",
      side: "A" as const,
      phase: "OPENING_A",
      content: "Opening case.",
      model: "m1",
      createdAt: "2026-01-01T00:00:10.000Z",
    };
    expect(transcriptTurnSchema.safeParse(base).success).toBe(true);
    expect(
      transcriptTurnSchema.safeParse({ ...base, claimIds: ["clm_1"], evidenceIds: ["ev_1"] })
        .success,
    ).toBe(true);
    expect(transcriptTurnSchema.safeParse({ ...base, claimIds: ["bad id!"] }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* User-supplied evidence packets (F10-06 .. F10-08)                   */
/* ------------------------------------------------------------------ */

describe("user evidence packets", () => {
  function validConfig() {
    return {
      topic: "Should AI be regulated?",
      mode: "quick",
      agentA: { providerId: "p1", model: "m1", position: "FOR" },
      agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
    };
  }

  function packet() {
    return {
      version: 1 as const,
      items: [
        { source: "user_text" as const, label: "Pasted notes", content: "Solar costs fell 90%." },
        { source: "local_file" as const, label: "brief.md", content: "# Brief\nSupporting analysis." },
      ],
    };
  }

  it("accepts valid text and file packets", () => {
    expect(userEvidencePacketInputSchema.safeParse(packet()).success).toBe(true);
    expect(matchConfigSchema.safeParse({ ...validConfig(), evidence: packet() }).success).toBe(true);
  });

  it("normalizes server-side: ids, sha-256 hashes, timestamps, origin, source type, unverified status", () => {
    const result = normalizeUserEvidencePacket(packet());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const bundle = result.data;
    expect(bundle.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
    expect(bundle.claims).toEqual([]);
    expect(bundle.challenges).toEqual([]);
    expect(bundle.responses).toEqual([]);
    expect(bundle.proofs).toEqual([]);
    expect(bundle.items).toHaveLength(2);

    const [text, file] = bundle.items;
    expect(text?.id).toMatch(/^ev_[A-Za-z0-9_-]+$/);
    expect(file?.id).toMatch(/^ev_[A-Za-z0-9_-]+$/);
    expect(text?.id).not.toBe(file?.id);
    expect(text?.status).toBe("unverified");
    expect(file?.status).toBe("unverified");
    expect(text?.claimIds).toEqual([]);

    expect(text?.provenance).toEqual({
      kind: "user-text",
      origin: "user",
      reference: "Pasted notes",
      retrievedAt: text!.provenance.retrievedAt,
      contentHash: createHash("sha256").update("Solar costs fell 90%.", "utf8").digest("hex"),
      extractionMethod: "user-paste",
    });
    expect(file?.provenance.kind).toBe("user-file");
    expect(file?.provenance.extractionMethod).toBe("user-file");
    expect(file?.provenance.contentHash).toBe(
      createHash("sha256").update("# Brief\nSupporting analysis.", "utf8").digest("hex"),
    );
    expect(Number.isNaN(Date.parse(text!.createdAt))).toBe(false);
    expect(text!.createdAt).toBe(file!.createdAt);

    // The normalized bundle must satisfy the canonical bundle contract.
    expect(validateEvidenceBundle(bundle).success).toBe(true);
  });

  it("enforces the per-item UTF-8 byte limit", () => {
    const asciiAtLimit = "a".repeat(USER_EVIDENCE_LIMITS.maxItemContentBytes);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "n", content: asciiAtLimit }],
      }).success,
    ).toBe(true);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "n", content: `${asciiAtLimit}a` }],
      }).success,
    ).toBe(false);
    // Multi-byte: 2048 'é' chars = 4096 UTF-8 bytes (at the limit).
    const multibyteAtLimit = "é".repeat(USER_EVIDENCE_LIMITS.maxItemContentBytes / 2);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "n", content: multibyteAtLimit }],
      }).success,
    ).toBe(true);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "n", content: `${multibyteAtLimit}é` }],
      }).success,
    ).toBe(false);
  });

  it("enforces the total UTF-8 byte limit across items", () => {
    const item = { source: "user_text" as const, label: "n", content: "a".repeat(4000) };
    const result = normalizeUserEvidencePacket({
      version: 1,
      items: [item, item, item, item, item], // 5 × 4000 = 20000 > 16384
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/16 ?384 UTF-8 bytes total/);
  });

  it("enforces item count and label length limits", () => {
    const item = { source: "user_text" as const, label: "n", content: "x" };
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: Array.from({ length: USER_EVIDENCE_LIMITS.maxItems }, () => item),
      }).success,
    ).toBe(true);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: Array.from({ length: USER_EVIDENCE_LIMITS.maxItems + 1 }, () => item),
      }).success,
    ).toBe(false);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ ...item, label: "x".repeat(USER_EVIDENCE_LIMITS.maxLabelChars + 1) }],
      }).success,
    ).toBe(false);
  });

  it("rejects empty and blank items", () => {
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "n", content: "" }],
      }).success,
    ).toBe(false);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "n", content: "   \n  " }],
      }).success,
    ).toBe(false);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "  ", content: "text" }],
      }).success,
    ).toBe(false);
    expect(userEvidencePacketInputSchema.safeParse({ version: 1, items: [] }).success).toBe(false);
  });

  it("rejects unknown fields on the packet and items (strict input)", () => {
    expect(userEvidencePacketInputSchema.safeParse({ ...packet(), extra: 1 }).success).toBe(false);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ ...packet().items[0], extra: true }],
      }).success,
    ).toBe(false);
  });

  it("rejects forbidden client-controlled fields (ids, hashes, status, provenance, urls, paths, capabilities)", () => {
    const base = packet().items[0]!;
    for (const forbidden of [
      { id: "ev_client" },
      { contentHash: "a".repeat(64) },
      { status: "verified" },
      { provenance: { kind: "user-text", origin: "user", reference: "x", retrievedAt: "2026-01-01T00:00:00.000Z", contentHash: "a".repeat(64), extractionMethod: "user-paste" } },
      { url: "https://example.org" },
      { path: "C:\\notes.txt" },
      { capabilities: { "net.fetch": true } },
      { verified: true },
      { turnId: "t1" },
      { createdAt: "2026-01-01T00:00:00.000Z" },
    ]) {
      expect(
        userEvidencePacketInputSchema.safeParse({ version: 1, items: [{ ...base, ...forbidden }] })
          .success,
      ).toBe(false);
    }
  });

  it("rejects filesystem paths in local_file labels", () => {
    const ok = { source: "local_file" as const, label: "notes.txt", content: "text" };
    expect(userEvidencePacketInputSchema.safeParse({ version: 1, items: [ok] }).success).toBe(true);
    for (const label of ["C:\\notes.txt", "dir/notes.txt", "dir\\notes.txt", "..", ".", "/etc/passwd"]) {
      expect(
        userEvidencePacketInputSchema.safeParse({ version: 1, items: [{ ...ok, label }] }).success,
      ).toBe(false);
    }
  });

  it("rejects non-plain-text content (control characters) and unknown versions", () => {
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "n", content: "bad\u0000null" }],
      }).success,
    ).toBe(false);
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "n", content: "bad\u0007bell" }],
      }).success,
    ).toBe(false);
    // Tab/LF/CR are ordinary Markdown whitespace and stay allowed.
    expect(
      userEvidencePacketInputSchema.safeParse({
        version: 1,
        items: [{ source: "user_text", label: "n", content: "# Title\n\t- item\r\n" }],
      }).success,
    ).toBe(true);
    expect(userEvidencePacketInputSchema.safeParse({ ...packet(), version: 2 }).success).toBe(false);
  });

  it("rejects a missing or malformed packet on the match config", () => {
    expect(matchConfigSchema.safeParse({ ...validConfig(), evidence: { version: 1, items: [] } }).success)
      .toBe(false);
    expect(matchConfigSchema.safeParse({ ...validConfig(), evidence: { items: packet().items } }).success)
      .toBe(false);
    expect(matchConfigSchema.safeParse(validConfig()).success).toBe(true);
  });
});
