/**
 * Judge rubric: the canonical criteria list the judge prompt composes from.
 * The built prompt string must stay byte-identical — see `rubric.test.ts`.
 */

/** Bump on any rubric wording change. */
export const RUBRIC_VERSION = "1";

/** Judge-prompt rubric generations. `"1"` is the default everywhere. */
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
 * draws.
 */
export const RUBRIC_VERSIONS: Record<RubricVersion, VersionedRubric> = {
  "1": { version: "1", extraGuidance: [] },
  "2": {
    version: "2",
    extraGuidance: [
      "Use these 0-100 band anchors for every score: 90 or above means exceptional, decisive superiority with strong evidence; 70-89 means solid, clear strengths with only minor gaps; 50-69 means adequate, a plausible case with thin evidence or weak engagement; below 50 means weak, bare assertions, off-topic material, or self-contradiction.",
      "Rebuttal quality requires directly addressing the opponent's actual points: a rebuttal that ignores the opponent's argument or merely restates one's own case must score below 50 for rebuttal.",
      "Set winner from the scores, but treat narrow wins as draws: use DRAW whenever scoreA and scoreB are within 2 points of each other, and never award A or B on a gap of 2 or less.",
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
