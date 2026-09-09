"use client";

import { useState } from "react";
import type { TranscriptTurnRecord } from "@/shared/api/matches";
import { shouldClampTurn, turnPhaseLabel, turnSideLabel } from "@/features/run-debate/ui/match-history/format-helpers";

interface TranscriptThreadProps {
  readonly turns: readonly TranscriptTurnRecord[];
}

/**
 * Big chat-style thread for the match archive page. Speaker
 * identity is the headline; round/phase chip is the metadata. Each
 * turn is a card with an accent that follows the speaker, so the
 * reader can scan a four-turn match and instantly see who said what.
 */
export function TranscriptThread({ turns }: TranscriptThreadProps) {
  if (turns.length === 0) {
    return (
      <p className="transcript-thread__empty">
        No transcript turns were saved for this match.
      </p>
    );
  }
  return (
    <ol className="transcript-thread" aria-label="Debate transcript">
      {turns.map((turn, index) => (
        <li key={turn.id ?? `${turn.side}-${turn.phase}-${index}`}>
          <TurnBubble turn={turn} />
        </li>
      ))}
    </ol>
  );
}

function TurnBubble({ turn }: { turn: TranscriptTurnRecord }) {
  const clamped = shouldClampTurn(turn.content);
  const [expanded, setExpanded] = useState(false);
  const accent = turn.side === "A" ? "coral" : "violet";
  return (
    <article
      className={`transcript-thread__bubble transcript-thread__bubble--${accent}`}
      aria-label={`${turnSideLabel(turn)} · ${turnPhaseLabel(turn)}`}
    >
      <header className="transcript-thread__head">
        <p
          className={`transcript-thread__speaker transcript-thread__speaker--${accent}`}
        >
          {turnSideLabel(turn)}
        </p>
        <div className="transcript-thread__meta">
          <span className="transcript-thread__phase">{turnPhaseLabel(turn)}</span>
          <span className="transcript-thread__model">{turn.model}</span>
        </div>
      </header>
      <div
        className={
          clamped && !expanded
            ? "transcript-thread__text transcript-thread__text--clamped"
            : "transcript-thread__text"
        }
      >
        {turn.content}
        {clamped && !expanded ? (
          <span
            aria-hidden="true"
            className="transcript-thread__fade"
          />
        ) : null}
      </div>
      {clamped ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="transcript-thread__toggle"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </article>
  );
}
