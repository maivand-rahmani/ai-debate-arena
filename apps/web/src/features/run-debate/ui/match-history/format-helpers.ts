/**
 * Pure formatters for the match-history UI.
 *
 * Kept dependency-free and side-effect-free so they are easy to unit-test and
 * safe to import from any component (including server contexts during build).
 */

import type {
  MatchRecord,
  MatchSummary,
  TranscriptTurnRecord,
} from "@/shared/api/matches";
import { findMatchTurn } from "@arena/types";

export const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatMatchDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return DATE_FORMATTER.format(date);
}

export const PHASE_LABEL: Readonly<Record<string, string>> = {
  CREATED: "Created",
  OPENING_A: "Opening · A",
  OPENING_B: "Opening · B",
  REBUTTAL_A: "Rebuttal · A",
  REBUTTAL_B: "Rebuttal · B",
  JUDGING: "Judge",
  FINISHED: "Finished",
};

export interface CriteriaRow {
  readonly title: string;
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly left: number;
  readonly right: number;
}

/**
 * 8-criterion breakdown used by the "Why this verdict" panel. Order matches
 * the rubric's natural reading order (argument → rebuttal → consistency →
 * relevance) so the bars line up with the judge's prose.
 */
export function buildCriteriaRows(record: MatchRecord): readonly CriteriaRow[] {
  if (!record.verdict) return [];
  const c = record.verdict.criteria;
  return [
    { title: "Argument quality", leftLabel: "A", rightLabel: "B", left: c.argumentQualityA, right: c.argumentQualityB },
    { title: "Rebuttal", leftLabel: "A", rightLabel: "B", left: c.rebuttalA, right: c.rebuttalB },
    { title: "Consistency", leftLabel: "A", rightLabel: "B", left: c.consistencyA, right: c.consistencyB },
    { title: "Relevance", leftLabel: "A", rightLabel: "B", left: c.relevanceA, right: c.relevanceB },
  ];
}

export const TRANSCRIPT_COLLAPSE_THRESHOLD = 480;
/** Maximum height (px) when a long transcript turn is clamped. */
export const TRANSCRIPT_CLAMP_HEIGHT = 220;

/** True when the turn text is long enough to warrant a "show more" toggle. */
export function shouldClampTurn(content: string): boolean {
  return content.length > TRANSCRIPT_COLLAPSE_THRESHOLD || content.split("\n").length > 8;
}

/** True when this match was re-judged at least once (judgedAt present). */
export function isRejudged(summary: MatchSummary): boolean {
  return summary.judgedAt !== undefined;
}

/** Human label for a turn's phase + speaker ("Opening · A", "Rebuttal · B"…). */
export function turnPhaseLabel(turn: TranscriptTurnRecord): string {
  const legacyLabel = PHASE_LABEL[turn.phase];
  if (legacyLabel) return legacyLabel;
  const formatTurn = findMatchTurn("quick", turn.phase);
  return formatTurn ? `Turn ${formatTurn.order} · ${formatTurn.role === "opening" ? "Opening" : "Response"}` : turn.phase;
}

/** Human label for which side produced a turn. */
export function turnSideLabel(turn: TranscriptTurnRecord): "The Challenger" | "The Advocate" {
  return turn.side === "A" ? "The Challenger" : "The Advocate";
}

export const WINNER_LABEL: Readonly<Record<"A" | "B" | "DRAW", string>> = {
  A: "A wins",
  B: "B wins",
  DRAW: "Draw",
};

export const TERMINAL_LABEL: Readonly<Record<MatchSummary["terminal"], string>> = {
  completed: "Completed",
  error: "Errored",
  cancelled: "Cancelled",
};
