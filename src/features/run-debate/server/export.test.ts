import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, type MatchRecord } from "../../../entities/debate/contract";
import { exportMatchJson, exportMatchMarkdown, matchSummary } from "./export";

function verdictRecord(): MatchRecord {
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
        content: "Regulation protects people.",
        model: "m1",
        createdAt: "2026-01-01T00:00:10.000Z",
      },
      {
        id: "t2",
        agentId: "B",
        side: "B",
        phase: "OPENING_B",
        content: "Regulation stifles progress.",
        model: "m2",
        createdAt: "2026-01-01T00:00:20.000Z",
      },
    ],
    verdict: {
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
    },
    terminal: "completed",
    terminalReason: null,
    metrics: { turnsMs: [10, 20], totalMs: 100 },
  };
}

describe("match export", () => {
  it("exports JSON with the stored record plus export metadata", () => {
    const record = verdictRecord();
    const parsed = JSON.parse(exportMatchJson(record)) as Record<string, unknown> & {
      exportedAt: string;
      contractVersion: number;
    };
    expect(parsed.contractVersion).toBe(CONTRACT_VERSION);
    expect(typeof parsed.exportedAt).toBe("string");
    expect(parsed.matchId).toBe("match-1");
    expect(parsed.topic).toBe(record.topic);
    expect(parsed.verdict).toEqual(record.verdict);
    expect(JSON.stringify(parsed)).not.toMatch(/apiKey|baseUrl|sk-/i);
  });

  it("exports JSON for a verdict-less record", () => {
    const parsed = JSON.parse(exportMatchJson({ ...verdictRecord(), verdict: null })) as {
      verdict: null;
      contractVersion: number;
    };
    expect(parsed.verdict).toBeNull();
    expect(parsed.contractVersion).toBe(CONTRACT_VERSION);
  });

  it("exports Markdown with topic, sides, ordered turns, and verdict", () => {
    const markdown = exportMatchMarkdown(verdictRecord());
    expect(markdown).toContain("# Debate: Should AI be regulated?");
    expect(markdown).toContain("- Mode: quick");
    expect(markdown).toContain("- Date: 2026-01-01T00:00:00.000Z");
    expect(markdown).toContain("| A | Provider One | m1 | FOR |");
    expect(markdown).toContain("| B | Provider Two | m2 | AGAINST |");
    const openingA = markdown.indexOf("### OPENING_A — Side A");
    const openingB = markdown.indexOf("### OPENING_B — Side B");
    expect(openingA).toBeGreaterThan(-1);
    expect(openingB).toBeGreaterThan(openingA);
    expect(markdown).toContain("Regulation protects people.");
    expect(markdown).toContain("Winner: A (82–74)");
    expect(markdown).toContain("| Argument quality | 85 | 75 |");
    expect(markdown).toContain("Reasoning: A had stronger arguments");
    expect(markdown).toContain("agent prompt v1 · judge prompt v1 · rubric v1 · contract v1");
    expect(markdown).toContain("match-1");
  });

  it("exports Markdown with a no-verdict section when the record has none", () => {
    const markdown = exportMatchMarkdown({ ...verdictRecord(), verdict: null });
    expect(markdown).toContain("No verdict reached.");
    expect(markdown).not.toContain("Winner:");
    expect(markdown).toContain("# Debate: Should AI be regulated?");
  });

  it("summarizes winner or pending", () => {
    expect(matchSummary(verdictRecord())).toMatchObject({ id: "match-1", winner: "A", terminal: "completed" });
    const pending = matchSummary({ ...verdictRecord(), verdict: null, terminal: "error" });
    expect(pending.winner).toBeNull();
    expect(pending.terminal).toBe("error");
  });
});
