"use client";

import { useState } from "react";
import type { TranscriptTurnRecord } from "@/shared/api/matches";
import { shouldClampTurn, turnPhaseLabel, turnSideLabel } from "./format-helpers";

interface TranscriptViewProps {
  readonly turns: readonly TranscriptTurnRecord[];
}

/**
 * Renders the saved transcript as a vertical list of turns. Long turns are
 * clamped to a fixed height with a "Show more / Show less" toggle so the
 * history row stays scannable. F9-21 (inline collapse/expand per turn).
 */
export function TranscriptView({ turns }: TranscriptViewProps) {
  if (turns.length === 0) {
    return (
      <p className="text-sm text-arena-400">
        No transcript turns were saved for this match.
      </p>
    );
  }
  return (
    <ol className="grid gap-3" aria-label="Debate transcript">
      {turns.map((turn, index) => (
        <li key={turn.id ?? `${turn.side}-${turn.phase}-${index}`}>
          <TurnItem turn={turn} />
        </li>
      ))}
    </ol>
  );
}

function TurnItem({ turn }: { turn: TranscriptTurnRecord }) {
  const clamped = shouldClampTurn(turn.content);
  const [expanded, setExpanded] = useState(false);
  const accent =
    turn.side === "A"
      ? "border-arena-coral-300/40"
      : "border-arena-violet-300/40";
  const labelClass =
    turn.side === "A" ? "text-arena-coral-100" : "text-arena-violet-100";
  return (
    <article
      className={`rounded-xl border ${accent} bg-white/[0.04] p-4 transition`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={`text-[10px] font-bold uppercase tracking-[0.22em] ${labelClass}`}
        >
          {turnPhaseLabel(turn)}
        </p>
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-arena-400">
          {turnSideLabel(turn)} · {turn.model}
        </p>
      </header>
      <div
        className={
          clamped && !expanded
            ? "mt-3 max-h-[220px] overflow-hidden whitespace-pre-wrap font-body text-[14px] leading-relaxed text-arena-50"
            : "mt-3 whitespace-pre-wrap font-body text-[14px] leading-relaxed text-arena-50"
        }
      >
        {turn.content}
        {clamped && !expanded ? (
          <span
            aria-hidden="true"
            className="pointer-events-none block h-12 bg-gradient-to-b from-transparent to-arena-900/90"
          />
        ) : null}
      </div>
      {clamped ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-arena-coral-200 transition hover:text-arena-50"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </article>
  );
}
