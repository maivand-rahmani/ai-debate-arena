import { findMatchTurn } from "@arena/types";
import type { DebateRuntimeState, SpeechPanel } from "@/features/run-debate/lib/reducer";

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
  return [...panels].sort(
    (a, b) =>
      (a.turn?.order ?? findMatchTurn("quick", a.phase)?.order ?? Number.MAX_SAFE_INTEGER) -
      (b.turn?.order ?? findMatchTurn("quick", b.phase)?.order ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Projects the running stream into a spectator-controlled view. This never
 * feeds back into the engine: advancing reveals work already produced while
 * the models keep running in the background.
 */
export function deriveMatchPlayback(state: DebateRuntimeState, requestedIndex: number): MatchPlaybackSnapshot {
  const panels = orderedSpeechPanels(state.panels);
  // `panels.length` is the explicit "continue to judge" sentinel. Do not
  // clamp it back to the last panel: doing so can make the timeline say the
  // audience is on a speech while the judge surface takes over.
  const terminalSelected = panels.length > 0 && requestedIndex >= panels.length;
  const focusedIndex = terminalSelected
    ? panels.length
    : panels.length === 0
      ? 0
      : Math.min(Math.max(0, requestedIndex), panels.length - 1);
  const focusedPanel = terminalSelected ? null : panels[focusedIndex] ?? null;
  const unseenTurns = focusedPanel ? panels.length - focusedIndex - 1 : 0;
  // `panels.length` is a deliberate sentinel: after the final speech it means
  // the viewer has explicitly elected to move on to the judge.
  const holdTerminal =
    (state.status === "judging" || state.status === "finished") &&
    panels.length > 0 &&
    !terminalSelected;
  const nextIndex = unseenTurns > 0 ? focusedIndex + 1 : holdTerminal ? panels.length : null;
  const canAdvance = nextIndex !== null;

  return { focusedPanel, focusedIndex, unseenTurns, nextIndex, canAdvance, holdTerminal };
}
