"use client";

import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import { CountUp } from "./atoms";

interface JudgePanelProps {
  readonly state: "evaluating" | "revealing" | "revealed";
  readonly reasoning?: string;
  readonly verdict?: DebateStreamVerdict;
}

export function JudgePanel({ state, reasoning, verdict }: JudgePanelProps) {
  if (state === "evaluating") {
    return (
      <section
        aria-live="polite"
        className="verdict-panel animate-panel-enter border-arena-gold-200/30"
      >
        <div className="flex flex-col items-center gap-5 text-center">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-arena-gold-100/40 bg-arena-gold-100/10 text-arena-gold-100 animate-shimmer"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path
                d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-arena-gold-100">
            Judge is evaluating
          </p>
          <h2 className="font-display text-2xl font-bold tracking-tight text-arena-50 sm:text-3xl">
            Weighing the arguments
          </h2>
          <p className="max-w-md text-sm text-arena-300">
            The judge reviews the transcript and scores each side across argument quality,
            rebuttal, consistency, and relevance.
          </p>
          <div className="mt-2 flex gap-2" aria-hidden="true">
            <span className="h-1.5 w-12 rounded-full bg-arena-gold-100/70" />
            <span className="h-1.5 w-12 rounded-full bg-arena-gold-100/30 animate-pulse" />
            <span className="h-1.5 w-12 rounded-full bg-arena-gold-100/15 animate-pulse" />
          </div>
        </div>
      </section>
    );
  }

  if (state === "revealing" || state === "revealed") {
    return <VerdictReveal reasoning={reasoning} verdict={verdict} />;
  }

  return null;
}

function VerdictReveal({ reasoning, verdict }: { reasoning?: string; verdict?: DebateStreamVerdict }) {
  const winner = verdict?.winner ?? "DRAW";
  const winnerLabel =
    winner === "DRAW" ? "Draw" : winner === "A" ? "The Challenger wins" : "The Advocate wins";
  const scoreA = verdict?.scoreA ?? 0;
  const scoreB = verdict?.scoreB ?? 0;
  const total = Math.max(1, scoreA + scoreB);
  const shareA = Math.round((scoreA / total) * 100);
  const shareB = 100 - shareA;

  return (
    <section
      aria-live="polite"
      className="verdict-panel animate-panel-enter border-arena-gold-200/40"
    >
      <div className="mb-8 flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-arena-gold-100">
          Verdict reached
        </p>
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-arena-300">
          {winner === "DRAW" ? "Tied" : winner === "A" ? "For the motion" : "Against the motion"}
        </p>
      </div>

      <h2 className="font-display text-3xl font-bold tracking-tight text-arena-50 sm:text-5xl">
        {winnerLabel}
      </h2>

      <div className="mt-10 grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <ScoreCard
          tone="coral"
          identity="The Challenger"
          score={scoreA}
          share={shareA}
          isWinner={winner === "A"}
        />
        <span aria-hidden="true" className="font-display text-xs font-bold uppercase tracking-[0.22em] text-arena-300">
          vs
        </span>
        <ScoreCard
          tone="violet"
          identity="The Advocate"
          score={scoreB}
          share={shareB}
          isWinner={winner === "B"}
        />
      </div>

      {verdict ? (
        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          <CriteriaBlock
            title="Argument quality"
            left={verdict.criteria.argumentQualityA}
            right={verdict.criteria.argumentQualityB}
          />
          <CriteriaBlock
            title="Rebuttal"
            left={verdict.criteria.rebuttalA}
            right={verdict.criteria.rebuttalB}
          />
          <CriteriaBlock
            title="Consistency"
            left={verdict.criteria.consistencyA}
            right={verdict.criteria.consistencyB}
          />
          <CriteriaBlock
            title="Relevance"
            left={verdict.criteria.relevanceA}
            right={verdict.criteria.relevanceB}
          />
        </div>
      ) : null}

      {reasoning ? (
        <div className="mt-10 border-t border-white/10 pt-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-gold-100">
            Reasoning
          </p>
          <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-arena-200">
            {reasoning}
          </p>
        </div>
      ) : null}
    </section>
  );
}

interface ScoreCardProps {
  readonly tone: "coral" | "violet";
  readonly identity: string;
  readonly score: number;
  readonly share: number;
  readonly isWinner: boolean;
}

function ScoreCard({ tone, identity, score, share, isWinner }: ScoreCardProps) {
  const coral = tone === "coral";
  const winnerClass = isWinner
    ? coral
      ? "border-arena-coral-300/50 bg-arena-coral-300/10"
      : "border-arena-violet-300/50 bg-arena-violet-300/10"
    : "border-white/10 bg-white/[0.04]";
  const stripeClass = coral ? "bg-arena-coral-300/60" : "bg-arena-violet-300/60";
  const labelClass = isWinner
    ? coral
      ? "text-arena-coral-100"
      : "text-arena-violet-100"
    : "text-arena-300";
  const barClass = coral ? "bg-arena-coral-300" : "bg-arena-violet-300";
  return (
    <div className={`relative overflow-hidden rounded-xl border p-5 transition ${winnerClass}`}>
      <div className={`absolute inset-x-0 top-0 h-px ${stripeClass}`} aria-hidden="true" />
      <p className={`text-[10px] font-bold uppercase tracking-[0.22em] ${labelClass}`}>
        {identity} · {isWinner ? "Winner" : "Runner up"}
      </p>
      <p className="mt-3 font-display text-4xl font-bold tracking-tight text-arena-50 sm:text-5xl">
        <CountUp value={score} />
        <span className="ml-1 text-base font-medium text-arena-300">/100</span>
      </p>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full transition-[width] duration-700 ${barClass}`}
          style={{ width: `${share}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

interface CriteriaBlockProps {
  readonly title: string;
  readonly left: number;
  readonly right: number;
}

function CriteriaBlock({ title, left, right }: CriteriaBlockProps) {
  const total = Math.max(1, left + right);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-arena-300">{title}</p>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="font-display text-lg font-bold text-arena-coral-100">
          A <span className="ml-1 text-arena-50"><CountUp value={left} /></span>
        </span>
        <span className="font-display text-lg font-bold text-arena-violet-100">
          <span className="ml-1 text-arena-50"><CountUp value={right} /></span> B
        </span>
      </div>
      <div className="mt-3 flex h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full bg-arena-coral-300/70" style={{ width: `${(left / total) * 100}%` }} aria-hidden="true" />
        <div className="h-full bg-arena-violet-300/70" style={{ width: `${(right / total) * 100}%` }} aria-hidden="true" />
      </div>
    </div>
  );
}
