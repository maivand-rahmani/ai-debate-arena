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
  readonly canAdvance: boolean;
  /** Judge/verdict waits until the viewer has seen every completed turn. */
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
  const canAdvance = unseenTurns > 0;
  const holdTerminal =
    (state.status === "judging" || state.status === "finished") &&
    panels.length > 0 &&
    focusedIndex < panels.length - 1;

  return { focusedPanel, focusedIndex, unseenTurns, canAdvance, holdTerminal };
}
