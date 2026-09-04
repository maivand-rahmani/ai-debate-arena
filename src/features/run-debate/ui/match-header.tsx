"use client";

import type { ReactNode } from "react";
import { PHASE_ROUNDS } from "../lib/reducer";

interface MatchHeaderProps {
  readonly topic: string;
  readonly currentPhase: string;
  readonly mode: "quick" | "standard" | "hardcore";
}

const PHASE_ORDER = PHASE_ROUNDS.map((round) => round.key);

export function MatchHeader({ topic, currentPhase, mode }: MatchHeaderProps) {
  const activeIndex = PHASE_ORDER.indexOf(currentPhase as (typeof PHASE_ORDER)[number]);
  return (
    <header className="topic-panel relative overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
            Live debate · {mode === "quick" ? "Quick mode" : mode}
          </p>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-arena-50 sm:text-3xl">
            {topic}
          </h1>
        </div>
        <RoundDots activeIndex={activeIndex} />
      </div>
    </header>
  );
}

function RoundDots({ activeIndex }: { activeIndex: number }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Match rounds">
      {PHASE_ROUNDS.map((round, index) => {
        const status =
          activeIndex === -1
            ? "pending"
            : index < activeIndex
              ? "done"
              : index === activeIndex
                ? "active"
                : "pending";
        return (
          <li key={round.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full transition ${
                status === "active"
                  ? "scale-125 bg-arena-gold-100"
                  : status === "done"
                    ? "bg-arena-success"
                    : "bg-arena-400"
              }`}
            />
            <span
              className={`hidden text-[10px] font-bold uppercase tracking-[0.2em] sm:inline ${
                status === "active"
                  ? "text-arena-gold-100"
                  : status === "done"
                    ? "text-arena-200"
                    : "text-arena-400"
              }`}
            >
              {round.label}
            </span>
            {index < PHASE_ROUNDS.length - 1 ? (
              <span aria-hidden="true" className="hidden h-px w-6 bg-arena-500/60 sm:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function StatusLine({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "judge" | "error" }) {
  const toneClass =
    tone === "judge"
      ? "bg-arena-gold-100/10 text-arena-gold-50"
      : tone === "error"
        ? "bg-arena-coral-300/10 text-arena-coral-100"
        : "bg-white/[0.06] text-arena-200";
  return (
    <div className={`status-strip border border-white/[0.07] ${toneClass}`}>
      <span className="pulse-dot" aria-hidden="true" />
      <span className="font-medium">{children}</span>
    </div>
  );
}
