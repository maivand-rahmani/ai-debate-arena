import type { DebateSide, MatchMode } from "./wire";

/** The semantic job of a turn, independent from its position in a format. */
export type MatchTurnRole = "opening" | "response";

/**
 * A format-owned turn descriptor. The id is persisted with a turn and is the
 * stable runtime key; labels are presentation metadata, not protocol logic.
 */
export interface MatchTurnSpec {
  readonly id: string;
  readonly side: DebateSide;
  readonly role: MatchTurnRole;
  readonly order: number;
  readonly label: string;
}

/**
 * A mode's fixed speaking order. Quick (and the disabled Hardcore alias) is a
 * predetermined list. Standard is variable length: only its two opening turns
 * are fixed, and response rounds are synthesized at runtime from the match's
 * credits/ready state via {@link standardRoundTurn}.
 */
export interface MatchFormat {
  readonly id: MatchMode;
  readonly label: string;
  readonly turns: readonly MatchTurnSpec[];
}

const QUICK_TURNS: readonly MatchTurnSpec[] = [
  { id: "quick-a-opening", side: "A", role: "opening", order: 1, label: "Challenger opens" },
  { id: "quick-b-opening", side: "B", role: "opening", order: 2, label: "Advocate opens" },
  { id: "quick-a-response-1", side: "A", role: "response", order: 3, label: "Challenger responds" },
  { id: "quick-b-response-1", side: "B", role: "response", order: 4, label: "Advocate responds" },
  { id: "quick-a-response-2", side: "A", role: "response", order: 5, label: "Challenger responds" },
  { id: "quick-b-response-2", side: "B", role: "response", order: 6, label: "Advocate responds" },
];

/**
 * Standard's only fixed turns. It always opens with one move per side; after
 * that the runner alternates paired open rounds until both sides are ready,
 * one side is ready (one paired answer round), or a side is depleted.
 */
export const STANDARD_OPENING_TURNS: readonly MatchTurnSpec[] = [
  { id: "standard-a-opening", side: "A", role: "opening", order: 1, label: "Challenger researches and opens" },
  { id: "standard-b-opening", side: "B", role: "opening", order: 2, label: "Advocate researches and opens" },
];

const SIDE_LABEL: Readonly<Record<DebateSide, string>> = { A: "Challenger", B: "Advocate" };

const STANDARD_ROUND_PATTERN = /^standard-([ab])-round-(\d+)$/;

/** The fixed opening turn for one Standard side. */
export function standardOpeningTurn(side: DebateSide): MatchTurnSpec {
  const turn = STANDARD_OPENING_TURNS.find((candidate) => candidate.side === side);
  if (!turn) throw new Error(`No Standard opening turn for side ${side}`);
  return turn;
}

/**
 * Synthesize the response turn for one side of a Standard open round. Order
 * continues the fixed opening order so existing order-based presentation
 * (progress, playback sorting) keeps working for variable-length matches.
 */
export function standardRoundTurn(side: DebateSide, round: number): MatchTurnSpec {
  return {
    id: `standard-${side.toLowerCase()}-round-${round}`,
    side,
    role: "response",
    order: 3 + (round - 1) * 2 + (side === "A" ? 0 : 1),
    label: `${SIDE_LABEL[side]} responds`,
  };
}

/** Resolve a dynamic Standard round id back to its turn descriptor. */
export function parseStandardRoundTurn(turnId: string): MatchTurnSpec | undefined {
  const match = STANDARD_ROUND_PATTERN.exec(turnId);
  if (!match) return undefined;
  const side = match[1] === "a" ? "A" : "B";
  const round = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(round) || round < 1) return undefined;
  return standardRoundTurn(side, round);
}

export const MATCH_FORMATS: Readonly<Record<MatchMode, MatchFormat>> = {
  quick: { id: "quick", label: "Quick", turns: QUICK_TURNS },
  standard: { id: "standard", label: "Standard", turns: STANDARD_OPENING_TURNS },
  hardcore: { id: "hardcore", label: "Hardcore", turns: QUICK_TURNS },
};

export function getMatchFormat(mode: MatchMode): MatchFormat {
  return MATCH_FORMATS[mode];
}

/** Resolve an active format turn, plus v0.3 Quick ids saved before formats. */
export function findMatchTurn(mode: MatchMode | string, turnId: string): MatchTurnSpec | undefined {
  const format = MATCH_FORMATS[mode as MatchMode];
  const active = format?.turns.find((turn) => turn.id === turnId);
  if (active) return active;
  const standard = STANDARD_KNOWN_TURNS[turnId] ?? parseStandardRoundTurn(turnId);
  if (standard) return standard;
  return LEGACY_QUICK_TURNS[turnId];
}

/**
 * Ids that Standard emitted before the lifecycle became variable length, plus
 * its fixed openings. Kept so locally saved Standard matches stay readable
 * after the runner stopped iterating a fixed Standard turn list.
 */
const STANDARD_KNOWN_TURNS: Readonly<Record<string, MatchTurnSpec>> = {
  ...Object.fromEntries(STANDARD_OPENING_TURNS.map((turn) => [turn.id, turn])),
  "standard-a-response": { id: "standard-a-response", side: "A", role: "response", order: 3, label: "Challenger responds" },
  "standard-b-response": { id: "standard-b-response", side: "B", role: "response", order: 4, label: "Advocate responds" },
};

const LEGACY_QUICK_TURNS: Readonly<Record<string, MatchTurnSpec>> = {
  OPENING_A: { id: "OPENING_A", side: "A", role: "opening", order: 1, label: "Challenger opens" },
  OPENING_B: { id: "OPENING_B", side: "B", role: "opening", order: 2, label: "Advocate opens" },
  REBUTTAL_A: { id: "REBUTTAL_A", side: "A", role: "response", order: 3, label: "Challenger responds" },
  REBUTTAL_B: { id: "REBUTTAL_B", side: "B", role: "response", order: 4, label: "Advocate responds" },
};
