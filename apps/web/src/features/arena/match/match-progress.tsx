"use client";

import type { DebateRuntimeState, SpeechPhase } from "@/features/run-debate/lib/reducer";
import { findMatchTurn, getMatchFormat } from "@arena/types";

interface MatchProgressProps {
  readonly state: DebateRuntimeState;
  /** The phase currently being watched, which can lag behind generation. */
  readonly viewingPhase?: SpeechPhase;
}

type ProgressState = "upcoming" | "current" | "complete";

interface ProgressStep {
  readonly phase: string;
  readonly label: string;
}

function stepsFor(state: DebateRuntimeState): readonly ProgressStep[] {
  return [
    ...getMatchFormat(state.mode).turns.map((turn) => ({ phase: turn.id, label: turn.label })),
    { phase: "JUDGING", label: "Judge's verdict" },
  ];
}

/**
 * The visible match spine. It deliberately reflects only server-backed
 * runtime phases, so it never implies that a turn or verdict exists before
 * the stream reports it.
 */
export function MatchProgress({ state, viewingPhase }: MatchProgressProps) {
  const steps = stepsFor(state);
  const activeIndex = viewingPhase ? steps.findIndex((step) => step.phase === viewingPhase) : progressIndex(state, steps);
  const resolvedIndex = activeIndex === -1 ? progressIndex(state, steps) : activeIndex;
  const completed = state.status === "finished" && viewingPhase === undefined;

  return (
    <nav className="match-progress" aria-label="Match progress">
      <span className="match-progress__summary" aria-live="polite">
        {progressSummary(state, steps, resolvedIndex, completed, viewingPhase !== undefined)}
      </span>
      <ol className="match-progress__steps">
        {steps.map((step, index) => {
          const progress = stepState(index, resolvedIndex, completed);
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

function progressIndex(state: DebateRuntimeState, steps: readonly ProgressStep[]): number {
  if (state.status === "judging" || state.status === "finished" || state.currentPhase === "JUDGING" || state.currentPhase === "FINISHED") {
    return steps.length - 1;
  }
  const turn = findMatchTurn(state.mode, state.currentPhase);
  return turn ? turn.order - 1 : 0;
}

function stepState(index: number, activeIndex: number, completed: boolean): ProgressState {
  if (completed || index < activeIndex) return "complete";
  return index === activeIndex ? "current" : "upcoming";
}

function progressSummary(
  state: DebateRuntimeState,
  steps: readonly ProgressStep[],
  activeIndex: number,
  completed: boolean,
  viewerControlled: boolean,
): string {
  if (completed) return "Match complete · verdict ready";
  if (viewerControlled) return `Viewing step ${activeIndex + 1} of ${steps.length} · ${steps[activeIndex]?.label ?? "match"}`;
  if (state.status === "starting") return "Preparing the opening round";
  return `Step ${activeIndex + 1} of ${steps.length} · ${steps[activeIndex]?.label ?? "match"}`;
}
