/**
 * Judge rubric: the canonical criteria list the judge prompt composes from.
 * The built prompt string must stay byte-identical — see `rubric.test.ts`.
 */

/** Bump on any rubric wording change. */
export const RUBRIC_VERSION = "1";

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
