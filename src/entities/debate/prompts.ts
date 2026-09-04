import { DebatePhase, type DebatePosition, type DebateSide, type DebateTurn } from "./types";

export const PHASE_INSTRUCTIONS: Readonly<Record<string, string>> = {
  [DebatePhase.OPENING_A]: "Present your opening case with one focused argument and supporting reasons.",
  [DebatePhase.OPENING_B]: "Present your opening case with one focused argument and supporting reasons.",
  [DebatePhase.REBUTTAL_A]: "Rebut the opponent's points directly, then reinforce your strongest argument.",
  [DebatePhase.REBUTTAL_B]: "Rebut the opponent's points directly, then reinforce your strongest argument.",
};

export function buildAgentSystemPrompt(side: DebateSide, position: DebatePosition, topic: string): string {
  const stance = position === "FOR" ? "arguing FOR" : "arguing AGAINST";
  return [
    `You are debater ${side} in a formal debate ${stance} the topic: "${topic}".`,
    "Make one focused argument for the current phase, do not converse, respect the token budget, plain text only.",
  ].join(" ");
}

export function buildAgentPrompt(
  side: DebateSide,
  position: DebatePosition,
  topic: string,
  phase: DebatePhase,
): { system: string; instruction: string } {
  return {
    system: buildAgentSystemPrompt(side, position, topic),
    instruction: PHASE_INSTRUCTIONS[phase] ?? "Make one focused argument for the current phase.",
  };
}

export function buildJudgePrompt(topic: string, turns: readonly DebateTurn[]): string {
  const transcript =
    turns.length > 0
      ? turns.map((turn) => `[${turn.side} / ${turn.phase}]: ${turn.content}`).join("\n\n")
      : "(no turns were recorded)";
  return [
    `You are the judge of a formal debate on the topic: "${topic}".`,
    "Full transcript:",
    transcript,
    "Compare both sides and score each side as an integer 0-100 for scoreA and scoreB using this rubric: argument quality, rebuttal quality, consistency, relevance.",
    "Also provide criteria as integers 0-100 each: argumentQualityA, argumentQualityB, rebuttalA, rebuttalB, consistencyA, consistencyB, relevanceA, relevanceB.",
    "Set winner from the scores: the higher score wins (A if scoreA is higher, B if scoreB is higher). Use DRAW only when the scores are within 2 points of each other.",
    "Never return 0 for any score unless the transcript is empty; a debated round must have non-zero scores that reflect the comparison.",
    "Respond with STRICT JSON only, no markdown, no extra text, matching this shape with concrete numbers, for example:",
    '{"winner":"A","scoreA":78,"scoreB":64,"criteria":{"argumentQualityA":80,"argumentQualityB":66,"rebuttalA":76,"rebuttalB":62,"consistencyA":79,"consistencyB":65,"relevanceA":78,"relevanceB":63},"reasoning":"..."}',
  ].join("\n\n");
}

export const JUDGE_SYSTEM_PROMPT =
  "You are an impartial debate judge. Respond with STRICT JSON only matching the verdict schema.";
