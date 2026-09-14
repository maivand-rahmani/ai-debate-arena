"use client";

import { useState } from "react";
import type { MatchMode } from "@arena/types";
import type { StandardToolEventRecord, TranscriptTurnRecord } from "@/shared/api/matches";
import { shouldClampTurn, turnPhaseLabel, turnSideLabel } from "@/features/run-debate/ui/match-history/format-helpers";

interface TranscriptThreadProps {
  readonly turns: readonly TranscriptTurnRecord[];
  readonly mode?: MatchMode;
  readonly toolEvents?: readonly StandardToolEventRecord[];
}

/**
 * Big chat-style thread for the match archive page. Speaker
 * identity is the headline; round/phase chip is the metadata. Each
 * turn is a card with an accent that follows the speaker, so the
 * reader can scan a four-turn match and instantly see who said what.
 */
export function TranscriptThread({ turns, mode, toolEvents = [] }: TranscriptThreadProps) {
  const groups = groupToolEvents(turns, toolEvents);
  if (turns.length === 0) {
    return (
      <div className="transcript-thread__empty-state">
        <p className="transcript-thread__empty">
          No transcript turns were saved for this match.
        </p>
        {toolEvents.length > 0 ? <ToolEventGroup events={toolEvents} unmatched /> : null}
        {toolEvents.length === 0 ? <ToolHistoryState mode={mode} /> : null}
      </div>
    );
  }
  return (
    <>
      <ol className="transcript-thread" aria-label="Debate transcript">
        {turns.map((turn, index) => (
          <li key={turn.id ?? `${turn.side}-${turn.phase}-${index}`}>
            <TurnBubble turn={turn} />
            {groups.byTurn.get(turn.id)?.length ? (
              <ToolEventGroup events={groups.byTurn.get(turn.id) ?? []} />
            ) : null}
          </li>
        ))}
        {groups.unmatched.length > 0 ? (
          <li className="transcript-thread__between">
            <ToolEventGroup events={groups.unmatched} unmatched />
          </li>
        ) : null}
      </ol>
      {toolEvents.length === 0 ? <ToolHistoryState mode={mode} /> : null}
    </>
  );
}

function TurnBubble({ turn }: { turn: TranscriptTurnRecord }) {
  const clamped = shouldClampTurn(turn.content);
  const [expanded, setExpanded] = useState(false);
  const accent = turn.side === "A" ? "coral" : "violet";
  const identity = turn.side === "A"
    ? { name: "Ember", role: "Challenger" }
    : { name: "Vesper", role: "Advocate" };
  return (
    <article
      className={`transcript-thread__bubble transcript-thread__bubble--${accent}`}
      aria-label={`${turnSideLabel(turn)} · ${turnPhaseLabel(turn)}`}
    >
      <header className="transcript-thread__head">
        <div className="transcript-thread__speaker-block">
          <p
          className={`transcript-thread__speaker transcript-thread__speaker--${accent}`}
          >
            {identity.name}
          </p>
          <span className="transcript-thread__role">{identity.role}</span>
        </div>
        <div className="transcript-thread__meta">
          <span className="transcript-thread__phase">{turnPhaseLabel(turn)}</span>
          <span className="transcript-thread__model">{turn.model}</span>
          <time dateTime={turn.createdAt} title={turn.createdAt}>{formatHistoryTime(turn.createdAt)}</time>
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
      <footer className="transcript-thread__foot">
        <span className="transcript-thread__ended-mark" aria-hidden="true">✓</span>
        <span>Turn ended</span>
        <time dateTime={turn.createdAt}>{formatHistoryTime(turn.createdAt)}</time>
        <span className="sr-only">Recorded speaker: {turnSideLabel(turn)}</span>
      </footer>
    </article>
  );
}

function ToolEventGroup({
  events,
  unmatched = false,
}: {
  readonly events: readonly StandardToolEventRecord[];
  readonly unmatched?: boolean;
}) {
  return (
    <aside className={`transcript-thread__evidence${unmatched ? " transcript-thread__evidence--between" : ""}`} aria-label={unmatched ? "Evidence between turns" : "Public tool evidence"}>
      <div className="transcript-thread__evidence-head">
        <span className="transcript-thread__evidence-kicker">{unmatched ? "Between turns" : "Public evidence"}</span>
        <span>{events.length} {events.length === 1 ? "call" : "calls"}</span>
      </div>
      <ul className="transcript-thread__evidence-list">
        {events.map((event) => <ToolEvent key={event.callId} event={event} />)}
      </ul>
    </aside>
  );
}

function ToolEvent({ event }: { readonly event: StandardToolEventRecord }) {
  const output = event.ok ? event.output : event.error ?? event.output;
  return (
    <li className={`transcript-thread__tool transcript-thread__tool--${event.ok ? "success" : "failure"}`}>
      <div className="transcript-thread__tool-preview">
        <div className="transcript-thread__tool-head">
          <span className="transcript-thread__tool-mark" aria-hidden="true" />
          <strong>{toolLabel(event.tool)}</strong>
          <span className="transcript-thread__tool-status">{event.ok ? "Succeeded" : "Failed"}</span>
          <time dateTime={event.createdAt}>{formatHistoryTime(event.createdAt)}</time>
        </div>
        <p className="transcript-thread__tool-query"><span>Query</span>{compactText(event.query, 150)}</p>
        <p className="transcript-thread__tool-excerpt"><span>{event.ok ? "Recorded output" : "Failure"}</span>{compactText(output, 190)}</p>
      </div>
      <details className="transcript-thread__tool-details">
        <summary>Inspect recorded call</summary>
        <dl>
          <div><dt>Call</dt><dd>{event.callId}</dd></div>
          <div><dt>Request</dt><dd>{event.query || "No query recorded."}</dd></div>
          <div><dt>Output</dt><dd>{output || "No output recorded."}</dd></div>
        </dl>
      </details>
    </li>
  );
}

function ToolHistoryState({ mode }: { readonly mode?: MatchMode }) {
  return (
    <p className="transcript-thread__tool-state">
      {mode === "quick" ? "Quick format · no tool calls recorded." : "No public tool calls were recorded for this match."}
    </p>
  );
}

function groupToolEvents(
  turns: readonly TranscriptTurnRecord[],
  events: readonly StandardToolEventRecord[],
): { readonly byTurn: ReadonlyMap<string, readonly StandardToolEventRecord[]>; readonly unmatched: readonly StandardToolEventRecord[] } {
  const byTurn = new Map<string, StandardToolEventRecord[]>();
  const unmatched: StandardToolEventRecord[] = [];
  for (const event of events) {
    const eventTime = Date.parse(event.createdAt);
    const candidate = turns
      .filter((turn) => turn.side === event.side)
      .map((turn) => ({ turn, time: Date.parse(turn.createdAt) }))
      .filter(({ time }) => Number.isFinite(eventTime) && Number.isFinite(time) && time >= eventTime)
      .sort((a, b) => a.time - b.time)[0]?.turn;
    if (!candidate) {
      unmatched.push(event);
      continue;
    }
    byTurn.set(candidate.id, [...(byTurn.get(candidate.id) ?? []), event]);
  }
  return { byTurn, unmatched };
}

function toolLabel(tool: StandardToolEventRecord["tool"]): string {
  if (tool === "web_search") return "Web search";
  if (tool === "fetch_url") return "URL fetch";
  return "Code run";
}

function compactText(value: string, limit: number): string {
  const compact = value.trim().replace(/\s+/g, " ");
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact || "Not recorded.";
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
}
