import { describe, expect, it } from "vitest";
import { transcriptSchema } from "./contract";
import {
  GOLDEN_TRANSCRIPT_FIXTURES,
  getGoldenFixture,
  type GoldenTranscriptFixture,
} from "./__fixtures__/transcripts/index";
import { EXPECTED_VERDICTS } from "./__snapshots__/expected-verdicts";

/**
 * Structural validation for the golden transcript fixtures (v0.2 F3-08 / F9-09).
 * These tests fail loudly if a future prompt edit changes the fixture inputs:
 * every transcript must satisfy the `transcriptSchema` contract, and the marker
 * phrases that make each scenario identifiable must remain present in the text.
 */

const EXPECTED_IDS = [
  "clear-A",
  "clear-B",
  "close-match",
  "contradictory-agent",
  "irrelevant-arguments",
  "truncated-empty",
] as const;

const FULL_FIXTURE_IDS: ReadonlyArray<GoldenTranscriptFixture["id"]> = [
  "clear-A",
  "clear-B",
  "close-match",
  "contradictory-agent",
  "irrelevant-arguments",
];

function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => token.length > 0).length;
}

describe("golden transcript fixtures", () => {
  it("ships exactly the six documented fixtures", () => {
    expect(GOLDEN_TRANSCRIPT_FIXTURES.map((fixture) => fixture.id).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
  });

  it("declares the expected leaning for every fixture", () => {
    expect(getGoldenFixture("clear-A").expected).toBe("A");
    expect(getGoldenFixture("clear-B").expected).toBe("B");
    expect(getGoldenFixture("close-match").expected).toBe("DRAW");
    expect(getGoldenFixture("contradictory-agent").expected).toBe("<unjudgable>");
    expect(getGoldenFixture("irrelevant-arguments").expected).toBe("<unjudgable>");
    expect(getGoldenFixture("truncated-empty").expected).toBe("<unjudgable>");
  });

  for (const id of FULL_FIXTURE_IDS) {
    it(`fixture ${id} passes transcriptSchema with ordered turns`, () => {
      const fixture = getGoldenFixture(id);
      expect(fixture.topic.trim().length).toBeGreaterThan(0);
      const parsed = transcriptSchema.safeParse([...fixture.turns]);
      expect(parsed.success).toBe(true);
      expect(fixture.turns.map((turn) => turn.side)).toEqual(["A", "B", "A", "B"]);
      expect(fixture.turns.map((turn) => turn.phase)).toEqual([
        "OPENING_A",
        "OPENING_B",
        "REBUTTAL_A",
        "REBUTTAL_B",
      ]);
    });

    it(`fixture ${id} keeps realistic turn lengths (~100-200 words)`, () => {
      const fixture = getGoldenFixture(id);
      for (const turn of fixture.turns) {
        const words = wordCount(turn.content);
        expect(words).toBeGreaterThanOrEqual(100);
        expect(words).toBeLessThanOrEqual(200);
      }
    });
  }

  it("fixture truncated-empty holds a single opening turn (missing turns)", () => {
    const fixture = getGoldenFixture("truncated-empty");
    expect(fixture.turns).toHaveLength(1);
    expect(fixture.turns[0]?.phase).toBe("OPENING_A");
    expect(transcriptSchema.safeParse([...fixture.turns]).success).toBe(true);
    expect(wordCount(fixture.turns[0]?.content ?? "")).toBeGreaterThan(50);
  });

  it("clear-A pinned judge reasoning references quality differences", () => {
    const expected = EXPECTED_VERDICTS["clear-A/clean-json"];
    expect("error" in expected).toBe(false);
    if (!("error" in expected)) {
      expect(expected.reasoning).toMatch(/argument quality/i);
      expect(expected.reasoning).toMatch(/rebuttal/i);
    }
  });

  it("contradictory-agent keeps both halves of the self-contradiction in text", () => {
    const fixture = getGoldenFixture("contradictory-agent");
    const sideAText = fixture.turns
      .filter((turn) => turn.side === "A")
      .map((turn) => turn.content)
      .join("\n");
    expect(sideAText).toContain("prohibitively expensive and economically unviable");
    expect(sideAText).toContain("cheapest option available");
  });

  it("irrelevant-arguments keeps both topic evasions in text", () => {
    const fixture = getGoldenFixture("irrelevant-arguments");
    const fullText = fixture.turns.map((turn) => turn.content).join("\n");
    expect(fullText).toContain("pineapple pizza");
    expect(fullText).toContain("Mars colony");
  });
});
