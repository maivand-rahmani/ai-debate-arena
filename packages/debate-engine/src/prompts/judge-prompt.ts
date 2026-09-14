import type { DebateTurn } from "../types";
import type { StandardToolCall } from "../standard";
import { buildCriteriaFieldList, buildRubricPhrase, RUBRIC_VERSIONS, type RubricVersion } from "../rubric";
import { JUDGE_MAX_CONTEXT_CHARS } from "../token-policy";

export const JUDGE_SYSTEM_PROMPT = [
  "You are the final, impartial judge of a formal debate.",
  "Judge the quality of the exchange, not eloquence alone: reward clear claims, sound reasoning, relevant support, and direct engagement with the opponent.",
  "Do not favor a side because you agree with its conclusion. Treat unsupported assertions, invented evidence, evasion, and repetition as weaknesses.",
  "Return only the requested JSON object.",
].join(" ");

export interface BuildJudgePromptOptions {
  /** Rubric generation to render. Defaults to the active rubric version. */
  readonly rubricVersion?: RubricVersion;
  /** Maximum characters of transcript context sent to the judge. */
  readonly maxTranscriptChars?: number;
  readonly toolEvents?: readonly StandardToolCall[];
}

export function buildJudgePrompt(
  topic: string,
  turns: readonly DebateTurn[],
  options?: BuildJudgePromptOptions,
): string {
  const rubricVersion = options?.rubricVersion ?? "2";
  const maxTranscriptChars = options?.maxTranscriptChars ?? JUDGE_MAX_CONTEXT_CHARS;
  if (rubricVersion === "1") return buildLegacyJudgePrompt(topic, turns, maxTranscriptChars);
  const rubric = RUBRIC_VERSIONS[rubricVersion] ?? RUBRIC_VERSIONS["2"];
  const transcript = renderTranscript(turns, maxTranscriptChars);
  const toolEvents = options?.toolEvents;
  const hasToolEvidence = Boolean(toolEvents?.length);
  const evidence = toolEvents?.length
    ? toolEvents.map((event) => `[${event.side} · ${event.tool} · ${event.ok ? "success" : "failed"}] ${event.query}\n${event.output}${event.error ? `\nError: ${event.error}` : ""}`).join("\n\n")
    : "(no tool evidence was recorded)";
  const evidenceGuidance = hasToolEvidence
    ? [
        "Decisive evidence: before scoring, identify which claims each side supported with the visible tool results above and which remained unsupported assertions. Treat a claim as backed only when a recorded tool result directly supports it; count bare assertions, overstated findings, failed lookups, and results used for a different claim as unsupported.",
        "Reasoning must cite the public tool evidence that decided the exchange by side, tool, and query, name the side that produced each result, and explain how it changed the comparison. Cite only the public tool results shown above; never invent evidence or reveal hidden or private reasoning.",
      ]
    : [];

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
    ...(options?.toolEvents ? ["Visible tool evidence:", evidence] : []),
    ...evidenceGuidance,
    `Return STRICT JSON only with integer fields ${buildCriteriaFieldList()} and no markdown, commentary, or extra keys. Use this exact shape:`,
    '{"winner":"A","scoreA":78,"scoreB":64,"criteria":{"argumentQualityA":80,"argumentQualityB":66,"rebuttalA":76,"rebuttalB":62,"consistencyA":79,"consistencyB":65,"relevanceA":78,"relevanceB":63},"reasoning":"Side A answered the strongest opposing claim and supported its position more clearly; Side B relied more on repetition and unsupported assertions."}',
  ].join("\n\n");
}

/** Preserve the v1 prompt for historical evaluation and stored comparisons. */
function buildLegacyJudgePrompt(topic: string, turns: readonly DebateTurn[], maxTranscriptChars: number): string {
  const transcript = renderTranscript(turns, maxTranscriptChars, (turn) => `[${turn.side} / ${turn.phase}]: `);
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

function renderTranscript(
  turns: readonly DebateTurn[],
  maxChars: number,
  prefixFor: (turn: DebateTurn) => string = (turn) => `[Debater ${turn.side} / ${turn.phase}]: `,
): string {
  if (turns.length === 0) return "(no turns were recorded)";
  const cap = Math.max(1, Math.floor(maxChars));
  const separatorChars = (turns.length - 1) * 2;
  const prefixChars = turns.reduce((sum, turn) => sum + prefixFor(turn).length, 0);
  const available = Math.max(0, cap - separatorChars - prefixChars);
  const perTurn = Math.floor(available / turns.length);
  let remainder = available - perTurn * turns.length;

  return turns
    .map((turn) => {
      const budget = perTurn + (remainder-- > 0 ? 1 : 0);
      return `${prefixFor(turn)}${clipTranscriptText(turn.content, budget)}`;
    })
    .join("\n\n");
}

function clipTranscriptText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, maxChars);
  const marker = " …[middle truncated]… ";
  if (maxChars <= marker.length) return text.slice(0, maxChars);
  const remaining = maxChars - marker.length;
  const headChars = Math.ceil(remaining * 0.6);
  const tailChars = remaining - headChars;
  return `${text.slice(0, headChars)}${marker}${tailChars > 0 ? text.slice(-tailChars) : ""}`;
}
