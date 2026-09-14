import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  matchConfigSchema,
  matchRecordSchema,
  transcriptSchema,
  verdictSchemaRef,
} from "../src/contract";

function validConfig() {
  return {
    topic: "Should AI be regulated?",
    mode: "quick",
    agentA: { providerId: "p1", model: "m1", position: "FOR" },
    agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
  };
}

function validVerdict() {
  return {
    winner: "A",
    scoreA: 82,
    scoreB: 74,
    criteria: {
      argumentQualityA: 85,
      argumentQualityB: 75,
      rebuttalA: 80,
      rebuttalB: 72,
      consistencyA: 83,
      consistencyB: 74,
      relevanceA: 84,
      relevanceB: 73,
    },
    reasoning: "A had stronger arguments",
  };
}

function validRecord() {
  return {
    version: CONTRACT_VERSION,
    matchId: "match-1",
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
    verdict: validVerdict(),
    terminal: "completed",
    terminalReason: null,
    metrics: { turnsMs: [12, 34, 56, 78], totalMs: 200 },
  };
}

describe("versioned contracts", () => {
  it("pins CONTRACT_VERSION to 1", () => {
    expect(CONTRACT_VERSION).toBe(1);
  });

  it("accepts a valid quick match config", () => {
    expect(matchConfigSchema.safeParse(validConfig()).success).toBe(true);
  });

  it("accepts standard/hardcore modes at the contract level (route gates them)", () => {
    expect(matchConfigSchema.safeParse({ ...validConfig(), mode: "standard" }).success).toBe(true);
    expect(matchConfigSchema.safeParse({ ...validConfig(), mode: "hardcore" }).success).toBe(true);
  });

  it("accepts in-bounds Standard limits and rejects out-of-range values", () => {
    const base = { ...validConfig(), mode: "standard" as const };
    expect(matchConfigSchema.safeParse({ ...base, standardLimits: {} }).success).toBe(true);
    expect(
      matchConfigSchema.safeParse({
        ...base,
        standardLimits: { startingCredits: 64, maxToolsPerMove: 0, toolTimeoutSeconds: 60 },
      }).success,
    ).toBe(true);
    expect(
      matchConfigSchema.safeParse({
        ...base,
        standardLimits: { startingCredits: 1, maxToolsPerMove: 4, toolTimeoutSeconds: 1 },
      }).success,
    ).toBe(true);

    for (const standardLimits of [
      { startingCredits: 0 },
      { startingCredits: 65 },
      { startingCredits: 1.5 },
      { maxToolsPerMove: -1 },
      { maxToolsPerMove: 5 },
      { toolTimeoutSeconds: 0 },
      { toolTimeoutSeconds: 61 },
    ]) {
      expect(matchConfigSchema.safeParse({ ...base, standardLimits }).success).toBe(false);
    }
  });

  it("rejects an empty topic, unknown mode, and missing agent", () => {
    expect(matchConfigSchema.safeParse({ ...validConfig(), topic: "  " }).success).toBe(false);
    expect(matchConfigSchema.safeParse({ ...validConfig(), mode: "marathon" }).success).toBe(false);
    const { agentB: _dropped, ...rest } = validConfig();
    void _dropped;
    expect(matchConfigSchema.safeParse(rest).success).toBe(false);
  });

  it("validates transcripts turn by turn", () => {
    expect(transcriptSchema.safeParse(validRecord().transcript).success).toBe(true);
    expect(transcriptSchema.safeParse([]).success).toBe(true);
    expect(transcriptSchema.safeParse([{ side: "C" }]).success).toBe(false);
  });

  it("references the canonical verdict schema", () => {
    expect(verdictSchemaRef.safeParse(validVerdict()).success).toBe(true);
    expect(verdictSchemaRef.safeParse({ winner: "A" }).success).toBe(false);
  });

  it("accepts a complete match record and rejects a wrong version", () => {
    expect(matchRecordSchema.safeParse(validRecord()).success).toBe(true);
    expect(matchRecordSchema.safeParse({ ...validRecord(), version: 2 }).success).toBe(false);
    expect(matchRecordSchema.safeParse({ ...validRecord(), terminal: "stalled" }).success).toBe(false);
  });

  it("allows a null verdict on error/cancelled records", () => {
    const record = { ...validRecord(), verdict: null, terminal: "error", terminalReason: "boom" };
    expect(matchRecordSchema.safeParse(record).success).toBe(true);
  });
});

