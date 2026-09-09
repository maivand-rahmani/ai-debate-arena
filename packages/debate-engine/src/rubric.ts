/**
 * Judge rubric: the canonical criteria list the judge prompt composes from.
 * The built prompt string must stay byte-identical — see `rubric.test.ts`.
 */

/** Bump on any rubric wording change. */
export const RUBRIC_VERSION = "2";

/** Judge-prompt rubric generations. `"2"` is the active default. */
export type RubricVersion = "1" | "2";

export interface VersionedRubric {
  readonly version: RubricVersion;
  /**
   * Standalone sentences appended to the judge prompt right after the rubric
   * sentence. Empty for v1 so the v1 prompt stays byte-identical.
   */
  readonly extraGuidance: readonly string[];
}

/**
 * Versioned rubric texts (F3-07/F9-07). v1 carries no extra guidance —
 * `buildJudgePrompt` without an explicit version renders exactly the legacy
 * prompt. v2 adds 0-100 band anchors, rebuttal-must-address-opponent emphasis,
 * and restates the DRAW policy (gap ≤ 2) so the judge knows narrow wins are
 * draws. The active prompt generation is v2; v1 remains available for
 * historical comparisons.
 */
export const RUBRIC_VERSIONS: Record<RubricVersion, VersionedRubric> = {
  "1": { version: "1", extraGuidance: [] },
  "2": {
    version: "2",
    extraGuidance: [
      "Apply the same standard to both sides and let the transcript—not the topic's popularity or your personal opinion—determine the scores.",
    ],
  },
};

export interface RubricCriterion {
  readonly key: "argumentQuality" | "rebuttal" | "consistency" | "relevance";
  /** Short phrase used inside the judge prompt's rubric sentence. */
  readonly label: string;
  /** Concrete `criteria` object field names (`<key>A` / `<key>B`). */
  readonly fieldA: string;
  readonly fieldB: string;
}

export const JUDGE_RUBRIC_CRITERIA: readonly RubricCriterion[] = [
  { key: "argumentQuality", label: "argument quality", fieldA: "argumentQualityA", fieldB: "argumentQualityB" },
  { key: "rebuttal", label: "rebuttal quality", fieldA: "rebuttalA", fieldB: "rebuttalB" },
  { key: "consistency", label: "consistency", fieldA: "consistencyA", fieldB: "consistencyB" },
  { key: "relevance", label: "relevance", fieldA: "relevanceA", fieldB: "relevanceB" },
];

/** "argument quality, rebuttal quality, consistency, relevance" */
export function buildRubricPhrase(): string {
  return JUDGE_RUBRIC_CRITERIA.map((criterion) => criterion.label).join(", ");
}

/** "argumentQualityA, argumentQualityB, rebuttalA, ..." (A/B field order). */
export function buildCriteriaFieldList(): string {
  return JUDGE_RUBRIC_CRITERIA.flatMap((criterion) => [criterion.fieldA, criterion.fieldB]).join(", ");
}
