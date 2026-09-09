import type { DebateTurn } from "../types";
import { buildCriteriaFieldList, buildRubricPhrase, RUBRIC_VERSIONS, type RubricVersion } from "../rubric";

export const JUDGE_SYSTEM_PROMPT = [
  "You are the final, impartial judge of a formal debate.",
  "Judge the quality of the exchange, not eloquence alone: reward clear claims, sound reasoning, relevant support, and direct engagement with the opponent.",
  "Do not favor a side because you agree with its conclusion. Treat unsupported assertions, invented evidence, evasion, and repetition as weaknesses.",
  "Return only the requested JSON object.",
].join(" ");

export interface BuildJudgePromptOptions {
  /** Rubric generation to render. Defaults to the active rubric version. */
  readonly rubricVersion?: RubricVersion;
}

export function buildJudgePrompt(
  topic: string,
  turns: readonly DebateTurn[],
  options?: BuildJudgePromptOptions,
): string {
  const rubricVersion = options?.rubricVersion ?? "2";
  if (rubricVersion === "1") return buildLegacyJudgePrompt(topic, turns);
  const rubric = RUBRIC_VERSIONS[rubricVersion] ?? RUBRIC_VERSIONS["2"];
  const transcript = turns.length
    ? turns.map((turn) => `[Debater ${turn.side} / ${turn.phase}]: ${turn.content}`).join("\n\n")
    : "(no turns were recorded)";

  return [
    `Motion: "${topic}"`,
    "You are judging the complete transcript below. Compare Debater A and Debater B directly and independently.",
    "Transcript:",
    transcript,
    "Score each side with integers from 0 to 100. Use the full range when justified: 90-100 is exceptional and decisive; 70-89 is strong with minor gaps; 50-69 is plausible but limited; below 50 is weak, unsupported, evasive, contradictory, or off-topic.",
    "Evaluate these criteria for each side: argument quality (clear thesis, logical reasons, meaningful support), rebuttal quality (accurately identifies and answers the opponent's strongest points), consistency (stable claims without contradictions), and relevance (stays focused on the motion and the actual exchange).",
    "Direct engagement with the opponent is mandatory: a side that does not answer the opposing case cannot receive a top overall score.",
    ...rubric.extraGuidance,
    "A rebuttal that ignores the opponent or only restates the speaker's own case must score below 50 for rebuttal quality. Do not reward confident wording without reasoning.",
    "Set winner to A or B according to the overall scores. Set winner to DRAW whenever the scores are within 2 points of each other. The winner field must agree with the scores.",
    "Reasoning must be concise but specific: name the decisive strength and weakness for each side, including whether the rebuttals actually answered the opposing claims.",
    `Return STRICT JSON only with integer fields ${buildCriteriaFieldList()} and no markdown, commentary, or extra keys. Use this exact shape:`,
    '{"winner":"A","scoreA":78,"scoreB":64,"criteria":{"argumentQualityA":80,"argumentQualityB":66,"rebuttalA":76,"rebuttalB":62,"consistencyA":79,"consistencyB":65,"relevanceA":78,"relevanceB":63},"reasoning":"Side A answered the strongest opposing claim and supported its position more clearly; Side B relied more on repetition and unsupported assertions."}',
  ].join("\n\n");
}

/** Preserve the v1 prompt for historical evaluation and stored comparisons. */
function buildLegacyJudgePrompt(topic: string, turns: readonly DebateTurn[]): string {
  const transcript = turns.length
    ? turns.map((turn) => `[${turn.side} / ${turn.phase}]: ${turn.content}`).join("\n\n")
    : "(no turns were recorded)";
  return [
    `You are the judge of a formal debate on the topic: "${topic}".`,
    "Full transcript:",
    transcript,
    "Compare both sides and score each side as an integer 0-100 for scoreA and scoreB using this rubric: " +
      `${buildRubricPhrase()}.`,
    "Also provide criteria as integers 0-100 each: argumentQualityA, argumentQualityB, rebuttalA, rebuttalB, consistencyA, consistencyB, relevanceA, relevanceB.",
    "Set winner from the scores: the higher score wins (A if scoreA is higher, B if scoreB is higher). Use DRAW only when the scores are within 2 points of each other.",
    "Never return 0 for any score unless the transcript is empty; a debated round must have non-zero scores that reflect the comparison.",
    "Respond with STRICT JSON only, no markdown, no extra text, matching this shape with concrete numbers, for example:",
    '{"winner":"A","scoreA":78,"scoreB":64,"criteria":{"argumentQualityA":80,"argumentQualityB":66,"rebuttalA":76,"rebuttalB":62,"consistencyA":79,"consistencyB":65,"relevanceA":78,"relevanceB":63},"reasoning":"..."}',
  ].join("\n\n");
}
