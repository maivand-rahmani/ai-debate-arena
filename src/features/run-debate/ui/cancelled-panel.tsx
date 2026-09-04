"use client";

import type { DebateRuntimeState } from "../lib/reducer";
import { PHASE_ROUNDS } from "../lib/reducer";

interface CancelledPanelProps {
  readonly state: DebateRuntimeState;
  readonly onNewMatch: () => void;
}

/**
 * Calm terminal screen for matches the user stopped before a verdict. Uses a
 * neutral cream/gold palette so it reads as "you paused the show" rather than
 * "something broke" — deliberately distinct from the coral error screen.
 */
export function CancelledPanel({ state, onNewMatch }: CancelledPanelProps) {
  const reached = PHASE_ROUNDS.find((round) => round.key === state.currentPhase);
  const reachedLabel = reached
    ? `Stopped during ${reached.label}`
    : state.currentPhase === "JUDGING"
      ? "Stopped while the judge was evaluating"
      : state.currentPhase === "FINISHED"
        ? "Stopped after the verdict"
        : "Stopped before any arguments were streamed";

  const streamedTurns = state.panels.length;
  const streamedCount =
    streamedTurns > 0
      ? `${streamedTurns} ${streamedTurns === 1 ? "argument" : "arguments"} streamed before the stop`
      : "No arguments were streamed before the stop";

  return (
    <section
      aria-live="polite"
      className="verdict-panel animate-panel-enter border-gold-100/30"
    >
      <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-10 sm:text-left">
        <div className="flex flex-col items-center gap-4 sm:items-start">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-gold-100/40 bg-gold-100/10 text-gold-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          </span>
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold-100">
            Match ended
          </p>
          <h2 className="font-display text-2xl font-bold tracking-tight text-arena-50 sm:text-3xl">
            Match ended before a verdict
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-arena-300">
            You stopped the debate before the judge could weigh in. Whatever had
            been argued is preserved on the corners &mdash; start a new match
            whenever you&rsquo;re ready.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 sm:items-end">
          <button type="button" onClick={onNewMatch} className="start-button">
            <span>New match</span>
            <span aria-hidden="true" className="font-display text-base leading-none">
              ↗
            </span>
          </button>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-left text-[11px] uppercase tracking-[0.18em] text-arena-300">
            <dt className="text-arena-400">Last round</dt>
            <dd className="text-right font-medium text-arena-100">{reachedLabel}</dd>
            <dt className="text-arena-400">Transcript</dt>
            <dd className="text-right font-medium text-arena-100">{streamedCount}</dd>
          </dl>
        </div>
      </div>
    </section>
  );
}
