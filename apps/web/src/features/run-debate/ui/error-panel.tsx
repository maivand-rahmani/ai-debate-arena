"use client";

import type { DebateRuntimeState } from "../lib/reducer";

interface ErrorPanelProps {
  readonly state: DebateRuntimeState;
  readonly onNewMatch: () => void;
}

/** Single terminal surface for a provider or stream failure. */
export function ErrorPanel({ state, onNewMatch }: ErrorPanelProps) {
  return (
    <section aria-live="assertive" className="verdict-panel animate-panel-enter border-coral-100/40">
      <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-10 sm:text-left">
        <div className="flex flex-col items-center gap-4 sm:items-start">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-coral-100/40 bg-coral-100/10 text-coral-100"
          >
            ×
          </span>
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-coral-100">
            Match stopped
          </p>
          <h2 className="font-display text-2xl font-bold tracking-tight text-arena-50 sm:text-3xl">
            The debate could not finish
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-arena-300">
            The match stopped before the judge could publish a verdict.
            {state.panels.length > 0 ? " The streamed transcript is preserved in history." : ""}
          </p>
          <p className="max-w-xl break-words text-sm leading-relaxed text-coral-100/90">
            {state.errorMessage ?? "The match could not finish. Try starting another match."}
          </p>
        </div>

        <button type="button" onClick={onNewMatch} className="start-button">
          <span>Try again</span>
          <span aria-hidden="true" className="font-display text-base leading-none">
            ↗
          </span>
        </button>
      </div>
    </section>
  );
}
