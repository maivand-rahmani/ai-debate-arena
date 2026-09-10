import type { DebateRuntimeState, SpeechPanel, SpeechPhase } from "@/features/run-debate/lib/reducer";

const PHASE_ORDER: Readonly<Record<SpeechPhase, number>> = {
  OPENING_A: 0,
  OPENING_B: 1,
  REBUTTAL_A: 2,
  REBUTTAL_B: 3,
  JUDGING: 4,
};

export interface MatchPlaybackSnapshot {
  readonly focusedPanel: SpeechPanel | null;
  readonly focusedIndex: number;
  readonly unseenTurns: number;
  /** Index to reveal next: a response, or the judge after the final response. */
  readonly nextIndex: number | null;
  readonly canAdvance: boolean;
  /** Judge/verdict waits until the viewer explicitly continues after the final response. */
  readonly holdTerminal: boolean;
}

/** Stable natural order, independent of network arrival timing. */
export function orderedSpeechPanels(panels: readonly SpeechPanel[]): readonly SpeechPanel[] {
  return [...panels].sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]);
}

/**
 * Projects the running stream into a spectator-controlled view. This never
 * feeds back into the engine: advancing reveals work already produced while
 * the models keep running in the background.
 */
export function deriveMatchPlayback(state: DebateRuntimeState, requestedIndex: number): MatchPlaybackSnapshot {
  const panels = orderedSpeechPanels(state.panels);
  const focusedIndex = panels.length === 0 ? 0 : Math.min(Math.max(0, requestedIndex), panels.length - 1);
  const focusedPanel = panels[focusedIndex] ?? null;
  const unseenTurns = focusedPanel ? panels.length - focusedIndex - 1 : 0;
  // `panels.length` is a deliberate sentinel: after the final speech it means
  // the viewer has explicitly elected to move on to the judge.
  const holdTerminal =
    (state.status === "judging" || state.status === "finished") &&
    panels.length > 0 &&
    requestedIndex < panels.length;
  const nextIndex = unseenTurns > 0 ? focusedIndex + 1 : holdTerminal ? panels.length : null;
  const canAdvance = nextIndex !== null;

  return { focusedPanel, focusedIndex, unseenTurns, nextIndex, canAdvance, holdTerminal };
}
