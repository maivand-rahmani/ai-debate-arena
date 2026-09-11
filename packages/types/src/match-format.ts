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
 * A mode's complete speaking order. Adding a new format is intentionally a
 * data change here rather than a cross-cutting runner/reducer/UI rewrite.
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

export const MATCH_FORMATS: Readonly<Record<MatchMode, MatchFormat>> = {
  quick: { id: "quick", label: "Quick", turns: QUICK_TURNS },
  // Kept as inactive catalog entries until their own product rules land.
  standard: { id: "standard", label: "Standard", turns: QUICK_TURNS },
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
  return LEGACY_QUICK_TURNS[turnId];
}

const LEGACY_QUICK_TURNS: Readonly<Record<string, MatchTurnSpec>> = {
  OPENING_A: { id: "OPENING_A", side: "A", role: "opening", order: 1, label: "Challenger opens" },
  OPENING_B: { id: "OPENING_B", side: "B", role: "opening", order: 2, label: "Advocate opens" },
  REBUTTAL_A: { id: "REBUTTAL_A", side: "A", role: "response", order: 3, label: "Challenger responds" },
  REBUTTAL_B: { id: "REBUTTAL_B", side: "B", role: "response", order: 4, label: "Advocate responds" },
};
