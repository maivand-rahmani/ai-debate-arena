"use client";

import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";

interface MatchProgressProps {
  readonly state: DebateRuntimeState;
}

type ProgressState = "upcoming" | "current" | "complete";

interface ProgressStep {
  readonly phase: DebateRuntimeState["currentPhase"];
  readonly label: string;
}

const STEPS: readonly ProgressStep[] = [
  { phase: "OPENING_A", label: "Challenger opens" },
  { phase: "OPENING_B", label: "Advocate opens" },
  { phase: "REBUTTAL_A", label: "Challenger responds" },
  { phase: "REBUTTAL_B", label: "Advocate responds" },
  { phase: "JUDGING", label: "Judge's verdict" },
];

/**
 * The visible match spine. It deliberately reflects only server-backed
 * runtime phases, so it never implies that a turn or verdict exists before
 * the stream reports it.
 */
export function MatchProgress({ state }: MatchProgressProps) {
  const activeIndex = progressIndex(state);
  const completed = state.status === "finished";

  return (
    <nav className="match-progress" aria-label="Match progress">
      <span className="match-progress__summary" aria-live="polite">
        {progressSummary(state, activeIndex, completed)}
      </span>
      <ol className="match-progress__steps">
        {STEPS.map((step, index) => {
          const progress = stepState(index, activeIndex, completed);
          return (
            <li
              key={step.phase}
              className={`match-progress__step match-progress__step--${progress}`}
              aria-current={progress === "current" ? "step" : undefined}
            >
              <span className="match-progress__marker" aria-hidden="true">
                {progress === "complete" ? "✓" : index + 1}
              </span>
              <span className="match-progress__label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function progressIndex(state: DebateRuntimeState): number {
  if (state.status === "judging" || state.status === "finished" || state.currentPhase === "JUDGING" || state.currentPhase === "FINISHED") {
    return 4;
  }
  const index = STEPS.findIndex((step) => step.phase === state.currentPhase);
  return index === -1 ? 0 : index;
}

function stepState(index: number, activeIndex: number, completed: boolean): ProgressState {
  if (completed || index < activeIndex) return "complete";
  return index === activeIndex ? "current" : "upcoming";
}

function progressSummary(state: DebateRuntimeState, activeIndex: number, completed: boolean): string {
  if (completed) return "Match complete · verdict ready";
  if (state.status === "starting") return "Preparing the opening round";
  return `Step ${activeIndex + 1} of ${STEPS.length} · ${STEPS[activeIndex].label}`;
}
