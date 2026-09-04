"use client";

import type { StageView } from "../stage-state";

interface RoundMarkerProps {
  readonly view: StageView;
  readonly className?: string;
}

/**
 * Central round/status marker. A floating chip at the top of the broadcast
 * composition that names the current round, the active side, and the broad
 * mode. Driven entirely by `view` (a pure projection of the runtime state),
 * so it cannot drift from the actual phase.
 */
export function RoundMarker({ view, className = "" }: RoundMarkerProps) {
  const mode = view.mode;
  const round = view.round;
  const side = view.activeSide;

  const roundLabel =
    round === "1" ? "Round 1" : round === "2" ? "Round 2" : "Round —";
  const stageLabel =
    round === "2" ? "Rebuttal" : round === "1" ? "Opening" : null;

  const headline = view.stageLabel;
  let pillText: string;
  let pillTone: "coral" | "violet" | "gold" | "neutral";

  if (mode === "speaking") {
    pillText = side === "A" ? "A LIVE" : "B LIVE";
    pillTone = side === "A" ? "coral" : "violet";
  } else if (mode === "judging") {
    pillText = "JUDGE";
    pillTone = "gold";
  } else if (mode === "verdict") {
    pillText = "VERDICT";
    pillTone = "gold";
  } else if (mode === "cancelled") {
    pillText = "ENDED";
    pillTone = "neutral";
  } else if (mode === "error") {
    pillText = "ERROR";
    pillTone = "neutral";
  } else {
    pillText = "READY";
    pillTone = "neutral";
  }

  return (
    <div
      className={`round-marker round-marker--${pillTone} ${className}`}
      data-mode={mode}
      aria-label={headline}
    >
      <span className="round-marker__line" aria-hidden="true" />
      <div className="round-marker__inner">
        <span className={`round-marker__pill round-marker__pill--${pillTone}`}>
          {pillText}
        </span>
        <p className="round-marker__round">{roundLabel}</p>
        {stageLabel ? <p className="round-marker__stage">{stageLabel}</p> : null}
      </div>
      <span className="round-marker__line" aria-hidden="true" />
    </div>
  );
}
