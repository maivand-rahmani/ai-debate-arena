"use client";

import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import type { MatchPlayback } from "./use-match-playback";

interface PlaybackControlsProps {
  readonly state: DebateRuntimeState;
  readonly playback: MatchPlayback;
}

/** Clear, optional control between finished speeches — never pauses models. */
export function PlaybackControls({ state, playback }: PlaybackControlsProps) {
  if (!playback.focusedPanel?.sealed) return null;

  if (playback.canAdvance) {
    const waitingLabel = playback.unseenTurns === 1 ? "1 response ready" : `${playback.unseenTurns} responses ready`;
    return (
      <div className="playback-controls" aria-live="polite">
        <span className="playback-controls__status">
          {waitingLabel} · the models continue in the background
        </span>
        <button type="button" className="playback-controls__next" onClick={playback.advance}>
          <span>Next response</span>
          <kbd>Esc</kbd>
          <span aria-hidden="true">→</span>
        </button>
      </div>
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
