import type { DebateVerdict } from "../types";

/**
 * Pinned FINAL normalized verdicts per fixture-output case (v0.2 F3-08 / F9-09 / F7-12).
 *
 * Reviewable-in-git alternative to vitest `.snap` files: each entry is the exact
 * output of the `parseDebateVerdict` + `normalizeVerdictWinner` pipeline (plus the
 * runner's single-retry rule) for the verbatim fake-judge output in
 * `judge-regression.test.ts`. Production code is untouched; if the pipeline
 * changes, these pins fail loudly and the diff shows the behavior shift.
 */
export type RegressionCaseId =
  | "clear-A/clean-json"
  | "clear-B/fenced-prose"
  | "close-match/missing-criteria"
  | "clear-A/winner-mismatch"
  | "close-match/draw-gap-violation"
  | "contradictory-agent/scores-inverted"
  | "irrelevant-arguments/degenerate-then-retry"
  | "truncated-empty/truncated-then-retry"
  | "truncated-empty/empty-error";

export type ExpectedRegressionOutcome = DebateVerdict | { readonly error: string };

export const EXPECTED_VERDICTS: Record<RegressionCaseId, ExpectedRegressionOutcome> = {
  "clear-A/clean-json": {
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
  },
  "clear-B/fenced-prose": {
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
  },
  "close-match/missing-criteria": {
    winner: "DRAW",
    scoreA: 74,
    scoreB: 75,
    criteria: {
      argumentQualityA: 74,
      argumentQualityB: 75,
      rebuttalA: 74,
      rebuttalB: 75,
      consistencyA: 74,
      consistencyB: 75,
      relevanceA: 74,
      relevanceB: 75,
    },
    reasoning:
      "Both sides matched closely on evidence and rebuttal; neither side pulled ahead beyond a point.",
  },
  "clear-A/winner-mismatch": {
    winner: "A",
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
  },
  "close-match/draw-gap-violation": {
    winner: "A",
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
  },
  "contradictory-agent/scores-inverted": {
    winner: "B",
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
  },
  "irrelevant-arguments/degenerate-then-retry": {
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
  },
  "truncated-empty/truncated-then-retry": {
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
  },
  "truncated-empty/empty-error": {
    error: "Judge returned invalid verdict",
  },
};
