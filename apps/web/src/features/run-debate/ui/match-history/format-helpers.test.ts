import { describe, expect, it } from "vitest";
import type { MatchRecord, MatchSummary } from "@/shared/api/matches";
import {
  buildCriteriaRows,
  formatMatchDate,
  isRejudged,
  shouldClampTurn,
  TERMINAL_LABEL,
  turnPhaseLabel,
  WINNER_LABEL,
  PHASE_LABEL,
} from "./format-helpers";

function buildRecord(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    version: 1,
    matchId: "m-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    topic: "topic",
    mode: "quick",
    sides: {
      A: { providerName: "Alpha", modelId: "alpha-default", position: "FOR" },
      B: { providerName: "Beta", modelId: "beta-default", position: "AGAINST" },
    },
    judge: { providerId: "judge", model: "judge-default" },
    policy: {
      mode: "quick",
      enabled: true,
      rounds: 1,
      agentMaxOutputTokens: 1200,
      judgeMaxOutputTokens: 1000,
      historyTurns: 6,
      maxContextCharsPerSide: 8000,
    },
    promptVersions: { agent: "1", judge: "1" },
    rubricVersion: "1",
    transcript: [],
    verdict: null,
    terminal: "completed",
    terminalReason: null,
    metrics: { turnsMs: [100, 200, 300, 400], totalMs: 1000 },
    ...overrides,
  };
}

describe("formatMatchDate", () => {
  it("returns a non-empty human label for a valid ISO timestamp", () => {
    const out = formatMatchDate("2026-03-04T12:34:00.000Z");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe("2026-03-04T12:34:00.000Z");
  });

  it("falls back to the raw string when the input cannot be parsed", () => {
    expect(formatMatchDate("not-a-date")).toBe("not-a-date");
  });
});

describe("buildCriteriaRows", () => {
  it("returns an empty list when the record has no verdict", () => {
    expect(buildCriteriaRows(buildRecord())).toEqual([]);
  });

  it("emits the four A-vs-B rows in canonical order when a verdict is present", () => {
    const record = buildRecord({
      verdict: {
        winner: "A",
        scoreA: 80,
        scoreB: 70,
        criteria: {
          argumentQualityA: 85,
          argumentQualityB: 75,
          rebuttalA: 80,
          rebuttalB: 70,
          consistencyA: 78,
          consistencyB: 68,
          relevanceA: 80,
          relevanceB: 70,
        },
        reasoning: "ok",
      },
    });
    const rows = buildCriteriaRows(record);
    expect(rows.map((r) => r.title)).toEqual([
      "Argument quality",
      "Rebuttal",
      "Consistency",
      "Relevance",
    ]);
    expect(rows[0]).toMatchObject({ left: 85, right: 75, leftLabel: "A", rightLabel: "B" });
  });
});

describe("shouldClampTurn", () => {
  it("does not clamp short content", () => {
    expect(shouldClampTurn("hello world")).toBe(false);
  });

  it("clamps content longer than the threshold", () => {
    const long = "a".repeat(600);
    expect(shouldClampTurn(long)).toBe(true);
  });

  it("clamps content with many line breaks", () => {
    const lines = Array.from({ length: 12 }, () => "line").join("\n");
    expect(shouldClampTurn(lines)).toBe(true);
  });
});

describe("isRejudged", () => {
  const base: MatchSummary = {
    id: "m-1",
    topic: "topic",
    date: "2026-01-01T00:00:00.000Z",
    mode: "quick",
    winner: "A",
    terminal: "completed",
  };

  it("returns false when judgedAt is missing", () => {
    expect(isRejudged(base)).toBe(false);
  });

  it("returns true when judgedAt is present", () => {
    expect(isRejudged({ ...base, judgedAt: "2026-01-02T00:00:00.000Z" })).toBe(true);
  });
});

describe("turnPhaseLabel", () => {
  it("maps every server-side phase to a stable human label", () => {
    for (const phase of Object.keys(PHASE_LABEL) as Array<keyof typeof PHASE_LABEL>) {
      expect(turnPhaseLabel({ phase, side: "A" } as never)).toBe(PHASE_LABEL[phase]);
    }
  });
});

describe("WINNER_LABEL / TERMINAL_LABEL", () => {
  it("covers every winner and terminal value used by the contract", () => {
    expect(Object.keys(WINNER_LABEL).sort()).toEqual(["A", "B", "DRAW"]);
    expect(Object.keys(TERMINAL_LABEL).sort()).toEqual(["cancelled", "completed", "error"]);
  });
});
