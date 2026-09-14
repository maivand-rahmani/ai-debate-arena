"use client";

import type { DebateRuntimeState, StandardTimelineEvent } from "@/features/run-debate/lib/reducer";
import { StandardEvidenceCard, type StandardEvidenceCardData } from "./standard-evidence-card";

export function StandardEventTimeline({ state }: { readonly state: DebateRuntimeState }) {
  if (state.mode !== "standard" || state.standardEvents.length === 0) return null;
  const cards = deriveEvidenceCards(state.standardEvents);
  const resultCount = cards.filter((card) => card.status !== "pending").length;

  return (
    <aside className="standard-event-timeline" aria-label="Standard public evidence timeline" aria-live="polite">
      <header className="standard-event-timeline__head">
        <div>
          <span className="standard-event-timeline__eyebrow">Standard match</span>
          <h2>Evidence trail</h2>
        </div>
        <strong>{resultCount} {resultCount === 1 ? "result" : "results"}</strong>
      </header>
      <p className="standard-event-timeline__intro">Research appears here before it reaches the public move.</p>
      <ol className="standard-event-timeline__list">
        {cards.map((card, index) => (
          <li key={card.callId}>
            <StandardEvidenceCard
              card={card}
              number={index + 1}
              moveLabel={moveLabelFor(state, card)}
            />
          </li>
        ))}
      </ol>
    </aside>
  );
}

function deriveEvidenceCards(events: readonly StandardTimelineEvent[]): StandardEvidenceCardData[] {
  const cards: StandardEvidenceCardData[] = [];
  const cardIndexes = new Map<string, number>();

  for (const event of events) {
    if (event.type === "tool-start") {
      if (cardIndexes.has(event.tool.callId)) continue;
      cardIndexes.set(event.tool.callId, cards.length);
      cards.push({
        callId: event.tool.callId,
        side: event.tool.side,
        tool: event.tool.tool,
        query: event.tool.query,
        status: "pending",
      });
      continue;
    }

    const existingIndex = cardIndexes.get(event.result.callId);
    const result: StandardEvidenceCardData = {
      callId: event.result.callId,
      side: event.result.side,
      tool: event.result.tool,
      query: event.result.query,
      status: event.result.ok ? "success" : "failure",
      output: event.result.output,
      error: event.result.error,
    };
    if (existingIndex === undefined) {
      cardIndexes.set(event.result.callId, cards.length);
      cards.push(result);
    } else {
      cards[existingIndex] = result;
    }
  }

  return cards;
}

function moveLabelFor(state: DebateRuntimeState, card: StandardEvidenceCardData): string {
  if (state.currentSide === card.side && state.currentTurn) {
    return `For Agent ${card.side}'s public move · ${state.currentTurn.label}`;
  }
  return `For Agent ${card.side}'s public move`;
}
