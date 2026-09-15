"use client";

import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import type { MatchPlayback } from "./use-match-playback";

interface PlaybackControlsProps {
  readonly state: DebateRuntimeState;
  readonly playback: MatchPlayback;
}

/** Clear, optional control between finished speeches — never pauses models. */
export function PlaybackControls({ state, playback }: PlaybackControlsProps) {
  const terminalPosition = playback.focusedPanel === null && playback.isTerminalFrame && playback.canGoPrevious;
  if (!playback.focusedPanel?.sealed && !terminalPosition) return null;

  if (playback.canAdvance || playback.canGoPrevious || playback.canCatchUp) {
    const isLastResponse = playback.unseenTurns === 0;
    const waitingLabel = terminalPosition
      ? "Verdict is live"
      : isLastResponse
      ? "Last response is ready · the judge works in the background"
      : playback.unseenTurns === 1
        ? "1 response ready · the models continue in the background"
        : `${playback.unseenTurns} responses ready · the models continue in the background`;
    const positionLabel = terminalPosition
      ? `Live verdict · ${state.panels.length} speeches`
      : `Speech ${playback.focusedIndex + 1} of ${Math.max(1, state.panels.length)}`;
    return (
      <nav className="playback-controls" aria-label="Speech playback controls">
        <span className="playback-controls__status" aria-live="polite">
          <strong>{positionLabel}</strong>
          <span>{waitingLabel}</span>
        </span>
        <span className="playback-controls__actions">
          <button
            type="button"
            className="playback-controls__next playback-controls__previous"
            onClick={() => playback.previous?.()}
            disabled={!playback.canGoPrevious}
            aria-label="Show previous speech"
            aria-keyshortcuts="ArrowLeft"
          >
            <span aria-hidden="true">←</span>
            <span>Previous</span>
            <kbd>←</kbd>
          </button>
          {playback.canCatchUp && playback.catchUpToLive ? (
            <button
              type="button"
              className="playback-controls__next playback-controls__catch-up"
              onClick={() => playback.catchUpToLive?.()}
              aria-label="Catch up to live"
            >
              <span>Catch up to live</span>
            </button>
          ) : null}
          {playback.canAdvance ? (
            <button
              type="button"
              className="playback-controls__next"
              onClick={playback.advance}
              aria-label={isLastResponse ? "Show judge" : "Show next speech"}
              aria-keyshortcuts="ArrowRight Escape"
            >
              <span>{isLastResponse ? "Show judge" : "Next speech"}</span>
              <kbd>→</kbd>
              <span aria-hidden="true">→</span>
            </button>
          ) : null}
        </span>
      </nav>
    );
  }

  if (state.status === "streaming") {
    return (
      <p className="playback-controls playback-controls--waiting" role="status">
        Preparing the next response…
      </p>
    );
  }

  return null;
}
