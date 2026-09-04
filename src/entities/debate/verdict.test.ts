import { describe, expect, it } from "vitest";
import { parseDebateVerdict } from "./verdict";

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
