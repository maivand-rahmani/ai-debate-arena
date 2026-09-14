"use client";

import { useEffect, useState } from "react";
import type { DebateRuntimeState, StandardTimelineEvent } from "@/features/run-debate/lib/reducer";
import { StandardEvidenceCard, type StandardEvidenceCardData } from "./standard-evidence-card";

interface StandardEventTimelineProps {
  readonly state: DebateRuntimeState;
  readonly standardLimits?: {
    readonly startingCredits?: number;
    readonly maxToolsPerMove?: number;
    readonly toolTimeoutMs?: number;
  };
}

export function StandardEventTimeline({ state, standardLimits }: StandardEventTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const sync = () => setExpanded(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  if (state.mode !== "standard" || state.standardEvents.length === 0) return null;
  const cards = deriveEvidenceCards(state.standardEvents);
  const resultCount = cards.filter((card) => card.status !== "pending").length;
  const successCount = cards.filter((card) => card.status === "success").length;
  const failureCount = cards.filter((card) => card.status === "failure").length;
  const startingCredits = standardLimits?.startingCredits ?? 12;
  const toolAllowance = standardLimits?.maxToolsPerMove ?? 2;
  const toolCalls = cards.length;
  const remainingFor = (side: "A" | "B") => Math.max(
    0,
    startingCredits - state.panels.filter((panel) => panel.side === side).length - cards.filter((card) => card.side === side).length * 2,
  );
  const estimatedCredits = Math.min(remainingFor("A"), remainingFor("B"));
  return (
    <aside
      className={`standard-event-timeline${expanded ? " is-expanded" : ""}`}
      aria-label="Standard public evidence rail"
      data-expanded={expanded}
    >
      <header className="standard-event-timeline__head">
        <div>
          <span className="standard-event-timeline__eyebrow">Public record</span>
          <h2>Evidence rail</h2>
        </div>
        <button
          type="button"
          className="standard-event-timeline__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide rail" : `Show evidence (${resultCount})`}
        </button>
      </header>
      <div className="standard-event-timeline__body">
        <p className="standard-event-timeline__intro">Research, tool results, and failures stay visible here without covering the argument.</p>
        <dl className="standard-event-timeline__summary" aria-label="Standard match resources">
          <div><dt>Length</dt><dd>Open-ended</dd></div>
          <div><dt>Credits</dt><dd>{estimatedCredits} est. left</dd></div>
          <div><dt>Tools</dt><dd>{toolCalls} used · {toolAllowance} / move</dd></div>
          <div><dt>Readiness</dt><dd>{state.status === "finished" ? "Match closed" : "Agent-led"}</dd></div>
        </dl>
        <p className="standard-event-timeline__results" role="status">
          {successCount} succeeded · {failureCount} failed · {resultCount} complete
        </p>
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
      </div>
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
    return `For ${card.side === "A" ? "the Challenger" : "the Advocate"} · ${state.currentTurn.label}`;
  }
  return `For ${card.side === "A" ? "the Challenger" : "the Advocate"}`;
}
