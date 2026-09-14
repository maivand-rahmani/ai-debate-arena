import { describe, expect, it } from "vitest";
import { buildJudgePrompt } from "../src/prompts";
import {
  isDegenerateVerdict,
  normalizeVerdictWinner,
  parseDebateVerdict,
} from "../src/verdict";
import type { DebateVerdict } from "../src/types";
import type { StandardToolCall } from "../src/standard";
import {
  getGoldenFixture,
  type GoldenFixtureId,
} from "../src/__fixtures__/transcripts/index";
import {
  EXPECTED_VERDICTS,
  type RegressionCaseId,
} from "../src/__snapshots__/expected-verdicts";

/**
 * Judge regression suite (v0.2 F3-08 / F9-09 / F7-12). Deterministic, no network.
 *
 * Each case feeds a golden fixture transcript into `buildJudgePrompt`, serves a
 * verbatim fake-judge output from the in-memory map below (same injection style
 * as the runner tests' `callModel` stub), and runs the production pipeline
 * `parseDebateVerdict` + `normalizeVerdictWinner` with the runner's single-retry
 * rule for unparsable or degenerate-zero output. Final verdicts are pinned in
 * `__snapshots__/expected-verdicts.ts`.
 */

const CLEAN_A = JSON.stringify({
  winner: "A",
  scoreA: 82,
  scoreB: 74,
  criteria: {
    argumentQualityA: 85,
    argumentQualityB: 72,
    rebuttalA: 80,
    rebuttalB: 70,
    consistencyA: 83,
    consistencyB: 75,
    relevanceA: 84,
    relevanceB: 76,
  },
  reasoning:
    "Side A showed stronger argument quality and rebuttal quality: it cited ridership elasticity, emissions data, and cost recovery, while Side B relied on vague assertions about freedom without evidence.",
});

const CLEAN_B = JSON.stringify({
  winner: "B",
  scoreA: 68,
  scoreB: 79,
  criteria: {
    argumentQualityA: 66,
    argumentQualityB: 80,
    rebuttalA: 69,
    rebuttalB: 78,
    consistencyA: 70,
    consistencyB: 79,
    relevanceA: 67,
    relevanceB: 80,
  },
  reasoning:
    "Side B showed stronger argument quality and rebuttal quality: it grounded the scale objection in numbers and comparative evidence, while Side A restated the publisher analogy without answering it.",
});

const FENCED_PROSE_B = [
  "Here is my verdict:",
  "```json",
  CLEAN_B,
  "```",
  "That concludes the judging.",
].join("\n");

const MISSING_CRITERIA_DRAW = JSON.stringify({
  winner: "DRAW",
  scoreA: 74,
  scoreB: 75,
  reasoning:
    "Both sides matched closely on evidence and rebuttal; neither side pulled ahead beyond a point.",
});

const WINNER_MISMATCH = JSON.stringify({
  winner: "B",
  scoreA: 82,
  scoreB: 70,
  criteria: {
    argumentQualityA: 84,
    argumentQualityB: 71,
    rebuttalA: 80,
    rebuttalB: 69,
    consistencyA: 83,
    consistencyB: 72,
    relevanceA: 85,
    relevanceB: 70,
  },
  reasoning: "Scores favor A despite the labeled winner.",
});

const DRAW_GAP_VIOLATION = JSON.stringify({
  winner: "DRAW",
  scoreA: 80,
  scoreB: 64,
  criteria: {
    argumentQualityA: 81,
    argumentQualityB: 63,
    rebuttalA: 79,
    rebuttalB: 62,
    consistencyA: 80,
    consistencyB: 65,
    relevanceA: 82,
    relevanceB: 64,
  },
  reasoning: "A DRAW label cannot stand with a sixteen-point gap.",
});

const SCORES_INVERTED = JSON.stringify({
  winner: "A",
  scoreA: 60,
  scoreB: 75,
  criteria: {
    argumentQualityA: 62,
    argumentQualityB: 76,
    rebuttalA: 58,
    rebuttalB: 74,
    consistencyA: 61,
    consistencyB: 75,
    relevanceA: 60,
    relevanceB: 77,
  },
  reasoning: "Side A contradicted its own cost premise, so the scores favor B.",
});

const DEGENERATE_ZEROS = JSON.stringify({
  winner: "DRAW",
  scoreA: 0,
  scoreB: 0,
  reasoning: "placeholder zeros",
});

const RETRY_DRAW_LOW = JSON.stringify({
  winner: "DRAW",
  scoreA: 60,
  scoreB: 61,
  criteria: {
    argumentQualityA: 60,
    argumentQualityB: 61,
    rebuttalA: 60,
    rebuttalB: 61,
    consistencyA: 60,
    consistencyB: 61,
    relevanceA: 60,
    relevanceB: 61,
  },
  reasoning:
    "Both sides dodged the topic, so scores are low and within a point; neither side earned a win.",
});

// Truncated mid-string: no closing braces, so the tolerant parser must reject it
// and the runner's single retry must supply the corrected verdict.
const TRUNCATED_JSON =
  '{"winner":"A","scoreA":65,"scoreB":58,"criteria":{"argumentQualityA":66,"reasoning":"A addressed the topic while B drifte';

const RETRY_AFTER_TRUNCATION = JSON.stringify({
  winner: "A",
  scoreA: 65,
  scoreB: 58,
  criteria: {
    argumentQualityA: 66,
    argumentQualityB: 57,
    rebuttalA: 64,
    rebuttalB: 56,
    consistencyA: 65,
    consistencyB: 58,
    relevanceA: 67,
    relevanceB: 59,
  },
  reasoning: "A addressed the topic while B drifted off-point in rebuttal.",
});

/** Verbatim fake-judge output sequence per case: [first attempt, retry]. */
const FAKE_JUDGE_OUTPUTS: Record<RegressionCaseId, readonly string[]> = {
  "clear-A/clean-json": [CLEAN_A],
  "clear-B/fenced-prose": [FENCED_PROSE_B],
  "close-match/missing-criteria": [MISSING_CRITERIA_DRAW],
  "clear-A/winner-mismatch": [WINNER_MISMATCH],
  "close-match/draw-gap-violation": [DRAW_GAP_VIOLATION],
  "contradictory-agent/scores-inverted": [SCORES_INVERTED],
  "irrelevant-arguments/degenerate-then-retry": [DEGENERATE_ZEROS, RETRY_DRAW_LOW],
  "truncated-empty/truncated-then-retry": [TRUNCATED_JSON, RETRY_AFTER_TRUNCATION],
  "truncated-empty/empty-error": ["", ""],
};

const CASES: ReadonlyArray<{
  readonly caseId: RegressionCaseId;
  readonly fixture: GoldenFixtureId;
  readonly expectedCalls: number;
}> = [
  { caseId: "clear-A/clean-json", fixture: "clear-A", expectedCalls: 1 },
  { caseId: "clear-B/fenced-prose", fixture: "clear-B", expectedCalls: 1 },
  { caseId: "close-match/missing-criteria", fixture: "close-match", expectedCalls: 1 },
  { caseId: "clear-A/winner-mismatch", fixture: "clear-A", expectedCalls: 1 },
  { caseId: "close-match/draw-gap-violation", fixture: "close-match", expectedCalls: 1 },
  { caseId: "contradictory-agent/scores-inverted", fixture: "contradictory-agent", expectedCalls: 1 },
  {
    caseId: "irrelevant-arguments/degenerate-then-retry",
    fixture: "irrelevant-arguments",
    expectedCalls: 2,
  },
  {
    caseId: "truncated-empty/truncated-then-retry",
    fixture: "truncated-empty",
    expectedCalls: 2,
  },
  { caseId: "truncated-empty/empty-error", fixture: "truncated-empty", expectedCalls: 2 },
];

interface FakeJudgeResolution {
  readonly verdict: DebateVerdict | null;
  readonly error: string | null;
  readonly calls: number;
}

/**
 * Mirrors `debate-runner.ts` judge handling: build the real judge prompt from
 * the fixture, serve canned text from the fake judge (injected like `callModel`
 * in the runner tests), parse, normalize, and retry exactly once when the first
 * output is unparsable or a degenerate zero DRAW on a non-empty transcript.
 */
function resolveWithFakeJudge(
  fixtureId: GoldenFixtureId,
  outputs: readonly string[],
): FakeJudgeResolution {
  const fixture = getGoldenFixture(fixtureId);
  const prompt = buildJudgePrompt(fixture.topic, fixture.turns);
  const hasTurns = fixture.turns.length > 0;

  const served: string[] = [];
  const fakeJudge = (requestPrompt: string): string => {
    served.push(requestPrompt);
    return outputs[Math.min(served.length - 1, outputs.length - 1)] ?? "";
  };

  const attempt = (text: string): DebateVerdict | null => {
    const parsed = parseDebateVerdict(text);
    if (!parsed.success) return null;
    return normalizeVerdictWinner(parsed.data);
  };

  const first = attempt(fakeJudge(prompt));
  if (first !== null && !isDegenerateVerdict(first, hasTurns)) {
    return { verdict: first, error: null, calls: served.length };
  }
  const retryPrompt =
    `${prompt}\n\nPrevious output was invalid. Respond with ONLY the corrected JSON object matching the required schema.`;
  const second = attempt(fakeJudge(retryPrompt));
  if (second === null || isDegenerateVerdict(second, hasTurns)) {
    return { verdict: null, error: "Judge returned invalid verdict", calls: served.length };
  }
  return { verdict: second, error: null, calls: served.length };
}

describe("judge regression pins", () => {
  for (const { caseId, fixture, expectedCalls } of CASES) {
    it(`pins ${caseId}`, () => {
      const result = resolveWithFakeJudge(fixture, FAKE_JUDGE_OUTPUTS[caseId]);
      expect(result.calls).toBe(expectedCalls);
      const expected = EXPECTED_VERDICTS[caseId];
      if ("error" in expected) {
        expect(result.verdict).toBeNull();
        expect(result.error).toBe(expected.error);
      } else {
        expect(result.error).toBeNull();
        expect(result.verdict).toEqual(expected);
      }
    });
  }
});

describe("judge output-shape behavior", () => {
  it("tolerates prose- and fence-wrapped JSON without retrying", () => {
    const result = resolveWithFakeJudge("clear-B", FAKE_JUDGE_OUTPUTS["clear-B/fenced-prose"]);
    expect(result.calls).toBe(1);
    expect(result.verdict?.winner).toBe("B");
    expect(result.verdict?.scoreA).toBe(68);
    expect(result.verdict?.scoreB).toBe(79);
  });

  it("derives missing criteria fields from the scores", () => {
    const result = resolveWithFakeJudge(
      "close-match",
      FAKE_JUDGE_OUTPUTS["close-match/missing-criteria"],
    );
    expect(result.calls).toBe(1);
    expect(result.verdict?.criteria.argumentQualityA).toBe(74);
    expect(result.verdict?.criteria.argumentQualityB).toBe(75);
    expect(result.verdict?.criteria.rebuttalA).toBe(74);
    expect(result.verdict?.criteria.relevanceB).toBe(75);
  });

  it("repairs a winner that conflicts with the scores", () => {
    const result = resolveWithFakeJudge("clear-A", FAKE_JUDGE_OUTPUTS["clear-A/winner-mismatch"]);
    expect(result.calls).toBe(1);
    expect(result.verdict?.winner).toBe("A");
  });

  it("overrides DRAW when the score gap exceeds 2", () => {
    const result = resolveWithFakeJudge(
      "close-match",
      FAKE_JUDGE_OUTPUTS["close-match/draw-gap-violation"],
    );
    expect(result.calls).toBe(1);
    expect(result.verdict?.winner).toBe("A");
  });

  it("preserves DRAW when the score gap is within 2", () => {
    const result = resolveWithFakeJudge(
      "close-match",
      FAKE_JUDGE_OUTPUTS["close-match/missing-criteria"],
    );
    expect(result.verdict?.winner).toBe("DRAW");
  });

  it("retries once after degenerate zero scores, then emits the corrected verdict", () => {
    const result = resolveWithFakeJudge(
      "irrelevant-arguments",
      FAKE_JUDGE_OUTPUTS["irrelevant-arguments/degenerate-then-retry"],
    );
    expect(result.calls).toBe(2);
    expect(result.verdict?.winner).toBe("DRAW");
    expect(result.verdict?.scoreA).toBe(60);
  });

  it("rejects truncated JSON on the first attempt and repairs via retry", () => {
    expect(parseDebateVerdict(TRUNCATED_JSON).success).toBe(false);
    const result = resolveWithFakeJudge(
      "truncated-empty",
      FAKE_JUDGE_OUTPUTS["truncated-empty/truncated-then-retry"],
    );
    expect(result.calls).toBe(2);
    expect(result.verdict?.winner).toBe("A");
  });

  it("surfaces an error when the retry is still empty", () => {
    expect(parseDebateVerdict("").success).toBe(false);
    const result = resolveWithFakeJudge(
      "truncated-empty",
      FAKE_JUDGE_OUTPUTS["truncated-empty/empty-error"],
    );
    expect(result.calls).toBe(2);
    expect(result.verdict).toBeNull();
    expect(result.error).toBe("Judge returned invalid verdict");
  });
});

describe("Standard judge decisive-evidence requirements", () => {
  const TOOL_EVENTS: readonly StandardToolCall[] = [
    {
      callId: "call-a-1",
      side: "A",
      tool: "web_search",
      query: "congestion charge per-capita emissions",
      output: "Per-capita emissions fell 18% after the congestion charge took effect.",
      ok: true,
      createdAt: "2026-09-04T00:00:02.000Z",
    },
    {
      callId: "call-b-1",
      side: "B",
      tool: "web_search",
      query: "congestion charge small business revenue",
      output: "",
      ok: false,
      error: "provider rate limit",
      createdAt: "2026-09-04T00:00:03.000Z",
    },
  ];

  function standardPrompt(toolEvents?: readonly StandardToolCall[]): string {
    const fixture = getGoldenFixture("clear-A");
    return buildJudgePrompt(fixture.topic, fixture.turns, { toolEvents });
  }

  it("requires decisive backed evidence and separates unsupported claims", () => {
    const prompt = standardPrompt(TOOL_EVENTS);
    expect(prompt).toContain("Decisive evidence");
    expect(prompt).toContain(
      "Treat a claim as backed only when a recorded tool result directly supports it",
    );
    expect(prompt).toContain("count bare assertions");
    expect(prompt).toContain("failed lookups");
    expect(prompt).toContain("results used for a different claim as unsupported");
  });

  it("requires citing the public tool evidence without exposing private reasoning", () => {
    const prompt = standardPrompt(TOOL_EVENTS);
    expect(prompt).toContain("Reasoning must cite the public tool evidence");
    expect(prompt).toContain("by side, tool, and query");
    expect(prompt).toContain("never invent evidence or reveal hidden or private reasoning");
  });

  it("renders each public tool result with its side, tool, status, and output", () => {
    const prompt = standardPrompt(TOOL_EVENTS);
    expect(prompt).toContain("Visible tool evidence:");
    expect(prompt).toContain("[A · web_search · success] congestion charge per-capita emissions");
    expect(prompt).toContain(
      "Per-capita emissions fell 18% after the congestion charge took effect.",
    );
    expect(prompt).toContain("[B · web_search · failed] congestion charge small business revenue");
    expect(prompt).toContain("Error: provider rate limit");
  });

  it("omits the decisive-evidence requirements for Quick (no tool events)", () => {
    const prompt = standardPrompt();
    expect(prompt).not.toContain("Decisive evidence");
    expect(prompt).not.toContain("public tool evidence");
    expect(prompt).not.toContain("Visible tool evidence:");
  });

  it("treats an empty tool-event list as no evidence for Quick compatibility", () => {
    const prompt = standardPrompt([]);
    expect(prompt).toContain("Visible tool evidence:");
    expect(prompt).toContain("(no tool evidence was recorded)");
    expect(prompt).not.toContain("Decisive evidence");
    expect(prompt).not.toContain("public tool evidence");
  });
});

