import { describe, expect, it } from "vitest";
import { extractJsonObject, isDegenerateVerdict, normalizeVerdictWinner, parseDebateVerdict } from "../src/verdict";
import { debateVerdictSchema } from "../src/verdict";
import { EVIDENCE_LIMITS } from "../src/evidence-contract";
import { CONTRACT_VERSION, matchRecordSchema } from "../src/contract";

const criteria = {
  argumentQualityA: 80,
  argumentQualityB: 70,
  rebuttalA: 75,
  rebuttalB: 65,
  consistencyA: 85,
  consistencyB: 72,
  relevanceA: 90,
  relevanceB: 68,
};

describe("parseDebateVerdict", () => {
  it("parses a verdict with explicit criteria", () => {
    const result = parseDebateVerdict(
      JSON.stringify({ winner: "A", scoreA: 80, scoreB: 70, criteria, reasoning: "A argued better" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.criteria).toEqual(criteria);
      expect(result.data.scoreA).toBe(80);
    }
  });

  it("derives criteria defaults from scores when criteria is missing", () => {
    const result = parseDebateVerdict('{"winner":"B","scoreA":60,"scoreB":75,"reasoning":"B won"}');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.criteria.argumentQualityA).toBe(60);
      expect(result.data.criteria.argumentQualityB).toBe(75);
      expect(result.data.criteria.rebuttalA).toBe(60);
      expect(result.data.criteria.relevanceB).toBe(75);
    }
  });

  it("rejects invalid verdicts", () => {
    expect(parseDebateVerdict('{"winner":"X","scoreA":80,"scoreB":70,"reasoning":"bad"}').success).toBe(false);
    expect(parseDebateVerdict("not json").success).toBe(false);
  });
});

describe("verdict evidence references (F10-03)", () => {
  function verdictWithRefs() {
    return {
      winner: "A" as const,
      scoreA: 82,
      scoreB: 74,
      criteria,
      reasoning: "A argued better",
      claimIds: ["clm_1", "clm_2"],
      evidenceIds: ["ev_1"],
    };
  }

  it("accepts legacy verdicts without refs unchanged", () => {
    const legacy = {
      winner: "A" as const,
      scoreA: 82,
      scoreB: 74,
      criteria,
      reasoning: "A argued better",
    };
    expect(debateVerdictSchema.safeParse(legacy).success).toBe(true);
    const parsed = parseDebateVerdict(JSON.stringify(legacy));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.claimIds).toBeUndefined();
      expect(parsed.data.evidenceIds).toBeUndefined();
      expect(parsed.data).toEqual(legacy);
    }
  });

  it("accepts valid refs at the schema level", () => {
    expect(debateVerdictSchema.safeParse(verdictWithRefs()).success).toBe(true);
  });

  it("passes refs through parseDebateVerdict", () => {
    const parsed = parseDebateVerdict(JSON.stringify(verdictWithRefs()));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.claimIds).toEqual(["clm_1", "clm_2"]);
      expect(parsed.data.evidenceIds).toEqual(["ev_1"]);
    }
  });

  it("rejects malformed refs at the schema level", () => {
    expect(
      debateVerdictSchema.safeParse({ ...verdictWithRefs(), claimIds: ["bad id!"] }).success,
    ).toBe(false);
    expect(
      debateVerdictSchema.safeParse({ ...verdictWithRefs(), evidenceIds: [42] }).success,
    ).toBe(false);
    expect(debateVerdictSchema.safeParse({ ...verdictWithRefs(), claimIds: [] }).success).toBe(true);
  });

  it("rejects oversized ref arrays", () => {
    const tooMany = Array.from({ length: EVIDENCE_LIMITS.refsPerEntity + 1 }, (_, i) => `clm_${i}`);
    expect(
      debateVerdictSchema.safeParse({ ...verdictWithRefs(), claimIds: tooMany }).success,
    ).toBe(false);
  });

  it("accepts records with evidence-extended verdicts and rejects invalid ones", () => {
    const record = {
      version: CONTRACT_VERSION,
      matchId: "match-vref-1",
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
      transcript: [],
      verdict: { ...verdictWithRefs(), criteria },
      terminal: "completed",
      terminalReason: null,
      metrics: { turnsMs: [12], totalMs: 100 },
    };
    expect(matchRecordSchema.safeParse(record).success).toBe(true);
    expect(matchRecordSchema.safeParse({ ...record, verdict: null }).success).toBe(true);
    expect(
      matchRecordSchema.safeParse({ ...record, verdict: { ...verdictWithRefs(), claimIds: ["bad id!"] } })
        .success,
    ).toBe(false);
    expect(
      matchRecordSchema.safeParse({
        ...record,
        verdict: { ...verdictWithRefs(), evidenceIds: ["x".repeat(EVIDENCE_LIMITS.idChars + 1)] },
      }).success,
    ).toBe(false);
  });
});

describe("normalizeVerdictWinner", () => {
  const base = {
    scoreA: 0,
    scoreB: 0,
    criteria,
    reasoning: "r",
  } as const;

  it("derives A when scoreA leads by more than 2", () => {
    expect(normalizeVerdictWinner({ ...base, winner: "DRAW", scoreA: 78, scoreB: 64 }).winner).toBe("A");
  });

  it("derives B when scoreB leads by more than 2", () => {
    expect(normalizeVerdictWinner({ ...base, winner: "A", scoreA: 60, scoreB: 75 }).winner).toBe("B");
  });

  it("preserves DRAW only within 2 points", () => {
    expect(normalizeVerdictWinner({ ...base, winner: "A", scoreA: 70, scoreB: 71 }).winner).toBe("DRAW");
    expect(normalizeVerdictWinner({ ...base, winner: "B", scoreA: 70, scoreB: 72 }).winner).toBe("DRAW");
    expect(normalizeVerdictWinner({ ...base, winner: "DRAW", scoreA: 70, scoreB: 73 }).winner).toBe("B");
  });

  it("keeps a consistent winner untouched", () => {
    const v = { ...base, winner: "A" as const, scoreA: 82, scoreB: 74 };
    expect(normalizeVerdictWinner(v)).toEqual(v);
  });
});

describe("isDegenerateVerdict", () => {
  const zeroDraw = {
    winner: "DRAW" as const,
    scoreA: 0,
    scoreB: 0,
    criteria,
    reasoning: "r",
  };

  it("flags zero/zero DRAW when turns exist", () => {
    expect(isDegenerateVerdict(zeroDraw, true)).toBe(true);
  });

  it("does not flag zero/zero when the transcript is empty", () => {
    expect(isDegenerateVerdict(zeroDraw, false)).toBe(false);
  });

  it("does not flag real scores", () => {
    expect(isDegenerateVerdict({ ...zeroDraw, winner: "A", scoreA: 78, scoreB: 64 }, true)).toBe(false);
    expect(isDegenerateVerdict({ ...zeroDraw, scoreA: 50, scoreB: 51 }, true)).toBe(false);
  });
});

describe("extractJsonObject", () => {
  const json = '{"winner":"A","scoreA":78,"scoreB":64,"reasoning":"A won"}';

  it("passes plain JSON through", () => {
    expect(extractJsonObject(json)).toBe(json);
    expect(extractJsonObject(`  ${json}\n`)).toBe(json);
  });

  it("unwraps a ```json fenced response", () => {
    expect(extractJsonObject(`\`\`\`json\n${json}\n\`\`\``)).toBe(json);
  });

  it("unwraps a plain ``` fenced response", () => {
    expect(extractJsonObject(`\`\`\`\n${json}\n\`\`\``)).toBe(json);
  });

  it("extracts the outermost object from surrounding prose", () => {
    expect(extractJsonObject(`Here is my verdict:\n${json}\nHope that helps.`)).toBe(json);
  });

  it("leaves unparsable input without braces for the caller to reject", () => {
    expect(extractJsonObject("not json at all")).toBe("not json at all");
    expect(parseDebateVerdict("not json at all").success).toBe(false);
  });
});

describe("parseDebateVerdict with markdown-wrapped output", () => {
  it("parses a fenced verdict without inventing scores", () => {
    const fenced = [
      "```json",
      JSON.stringify({
        winner: "B",
        scoreA: 70,
        scoreB: 78,
        criteria: {
          argumentQualityA: 70,
          argumentQualityB: 78,
          rebuttalA: 69,
          rebuttalB: 77,
          consistencyA: 71,
          consistencyB: 78,
          relevanceA: 70,
          relevanceB: 79,
        },
        reasoning: "B rebutted better",
      }),
      "```",
    ].join("\n");
    const result = parseDebateVerdict(fenced);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.winner).toBe("B");
      expect(result.data.scoreA).toBe(70);
      expect(result.data.scoreB).toBe(78);
    }
  });
});

