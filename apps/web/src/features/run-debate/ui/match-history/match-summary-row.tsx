import Link from "next/link";
import type { MatchRecord, MatchSummary } from "@/shared/api/matches";
import { formatMatchDate, TERMINAL_LABEL, WINNER_LABEL } from "./format-helpers";

interface MatchSummaryRowProps {
  readonly summary: MatchSummary;
  readonly record?: MatchRecord;
  readonly className: string;
  readonly onOpen?: () => void;
}

export function MatchSummaryRow({ summary, record, className, onOpen }: MatchSummaryRowProps) {
  const winner = winnerLabel(summary.winner);
  const href = `/matches/${encodeURIComponent(summary.id)}`;
  const turns = record?.transcript.length;
  const toolCalls = record?.toolEvents?.length;
  const score = record?.verdict ? `${record.verdict.scoreA} — ${record.verdict.scoreB}` : null;

  return (
    <Link
      href={href}
      onClick={(event) => {
        if (onOpen) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={className}
    >
      <span className="history-match-row__main">
        <span className="history-match-row__topic">{summary.topic}</span>
        <span className="history-match-row__meta">
          <span>{summary.mode === "quick" ? "Quick" : summary.mode}</span>
          <span aria-hidden="true">·</span>
          <span>{formatMatchDate(summary.date)}</span>
        </span>
      </span>
      <span className="history-match-row__result">
        <span className={`history-match-row__winner history-match-row__winner--${winner.tone}`}>{winner.label}</span>
        {score ? <span className="history-match-row__score">{score}</span> : null}
        <span className="history-match-row__terminal">{TERMINAL_LABEL[summary.terminal]}</span>
      </span>
      <span className="history-match-row__signals" aria-label="Match signals">
        <span>{turns === undefined ? "—" : turns} {turns === 1 ? "turn" : "turns"}</span>
        <span>{toolCalls === undefined ? "—" : toolCalls} {toolCalls === 1 ? "tool call" : "tool calls"}</span>
      </span>
      <span className="history-match-row__arrow" aria-hidden="true">→</span>
    </Link>
  );
}

function winnerLabel(winner: MatchSummary["winner"]): { readonly label: string; readonly tone: "a" | "b" | "draw" | "pending" } {
  if (winner === "A") return { label: "Ember wins", tone: "a" };
  if (winner === "B") return { label: "Vesper wins", tone: "b" };
  if (winner === "DRAW") return { label: WINNER_LABEL.DRAW, tone: "draw" };
  return { label: "Pending", tone: "pending" };
}
