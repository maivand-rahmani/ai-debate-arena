"use client";

import { useEffect, useRef } from "react";
import type { DebateRuntimeState, SpeechPanel } from "@/features/run-debate/lib/reducer";
import { deriveCaptionView, type CaptionView } from "./caption-view";

interface LiveCaptionProps {
  readonly state: DebateRuntimeState;
  /** A spectator-selected speech that should remain on screen while later turns generate. */
  readonly focusedPanel?: SpeechPanel | null;
  /** Standard-only spectator pacing control. */
  readonly onNextResponse?: () => void;
  readonly canAdvanceNextResponse?: boolean;
  readonly isWaitingForNextResponse?: boolean;
  /**
   * Optional status row that the caption sits above (typically the
   * compact round/status chip from the broadcast header). Rendered
   * once, used for sizing the column.
   */
  readonly children?: React.ReactNode;
}

/**
 * The single bottom-center speech surface that replaces the two
 * side-by-side teleprompters. Big readable text, dimmed/blurred glass
 * panel, speaker name + phase chip, auto-switches between the active
 * speaker / judge / verdict / cancelled / error. Designed to stay
 * readable when the 3D scene is dimmed behind it.
 */
export function LiveCaption({
  state,
  focusedPanel,
  onNextResponse,
  canAdvanceNextResponse = false,
  isWaitingForNextResponse = false,
}: LiveCaptionProps) {
  const view = deriveCaptionView(state, focusedPanel);
  if (!view.visible) return null;
  return (
    <CaptionPanel
      state={state}
      view={view}
      onNextResponse={onNextResponse}
      canAdvanceNextResponse={canAdvanceNextResponse}
      isWaitingForNextResponse={isWaitingForNextResponse}
    />
  );
}

function CaptionPanel({
  state,
  view,
  onNextResponse,
  canAdvanceNextResponse,
  isWaitingForNextResponse,
}: {
  readonly state: DebateRuntimeState;
  readonly view: CaptionView;
  readonly onNextResponse?: () => void;
  readonly canAdvanceNextResponse: boolean;
  readonly isWaitingForNextResponse: boolean;
}) {
  const status = statusLabel(view);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The body is intentionally bounded so a long response does not cover the
  // whole arena. Keep the newest streamed tokens in view as they arrive.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [view.kind?.kind, view.phaseLabel, view.text]);

  return (
    <section
      className={`live-caption live-caption--${view.tone}`}
      role="region"
      aria-label="Debate speech"
      data-kind={view.kind?.kind ?? "idle"}
    >
      <header className="live-caption__head">
        <span className={`live-caption__chip live-caption__chip--${view.tone}`}>
          {view.speakerLabel}
        </span>
        <span className="live-caption__phase">{view.phaseLabel}</span>
        <span className="live-caption__status">
          {status}
        </span>
      </header>
      <span className="live-caption__announcement" role="status" aria-live="polite">
        {captionAnnouncement(view)}
      </span>
      {toolAnnouncement(state) ? (
        <span className="live-caption__announcement" role="status" aria-live="polite">
          {toolAnnouncement(state)}
        </span>
      ) : null}
      <div ref={bodyRef} className="live-caption__body" aria-live="off">
        {publicActivity(state, view) ? (
          <div className="live-caption__activity">
            <span className="live-caption__activity-label">Public activity</span>
            <span>{publicActivity(state, view)}</span>
          </div>
        ) : view.text ? (
          <p className="live-caption__text">
            {view.text}
            {view.isLive ? (
              <span className="live-caption__caret" aria-hidden="true" />
            ) : null}
          </p>
        ) : (
          <p className="live-caption__text live-caption__text--idle">
            {idleMessage(view)}
          </p>
        )}
      </div>
      {canAdvanceNextResponse && onNextResponse ? (
        <div className="playback-controls live-caption__next-response" role="status">
          <span className="playback-controls__status">Next response is ready</span>
          <button
            type="button"
            className="playback-controls__next"
            aria-label="Show next response"
            onClick={() => onNextResponse()}
          >
            <span>Next response</span>
            <kbd>Enter</kbd>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : isWaitingForNextResponse ? (
        <p className="playback-controls playback-controls--waiting live-caption__next-response" role="status">
          Preparing the next response…
        </p>
      ) : null}
    </section>
  );
}

function statusLabel(view: CaptionView): string {
  if (!view.kind) return "—";
  if (view.kind.kind === "speaker") {
    if (view.isLive) return "Speaking";
    return view.kind.sealed ? "Sealed" : "Listening";
  }
  if (view.kind.kind === "judge-evaluating") return "Judge is evaluating";
  if (view.kind.kind === "verdict") return "Verdict reached";
  if (view.kind.kind === "cancelled") return "Match ended";
  if (view.kind.kind === "error") return "Error";
  return "—";
}

function idleMessage(view: CaptionView): string {
  if (!view.kind) return "";
  if (view.kind.kind === "speaker" && !view.isLive) return "Listening for the first words…";
  if (view.kind.kind === "speaker" && view.isLive) return "Waiting for the first words…";
  if (view.kind.kind === "judge-evaluating") return "Listening to the closing arguments…";
  if (view.kind.kind === "verdict") return "The judge has reached a verdict.";
  if (view.kind.kind === "cancelled") return "The match ended before a verdict.";
  if (view.kind.kind === "error") return view.kind.message;
  return "";
}

function publicActivity(state: DebateRuntimeState, view: CaptionView): string | null {
  if (view.kind?.kind !== "speaker" || view.text.trim().length > 0) return null;

  const event = state.activeStandardEvents[state.activeStandardEvents.length - 1];
  if (!event) return "Preparing a public response…";
  if (event.type === "tool-start") return `Researching with ${toolLabel(event.tool.tool)}…`;
  if (event.result.rejected || !event.result.ok) return "Adjusting after a tool issue…";
  return "Reviewing public evidence…";
}

function captionAnnouncement(view: CaptionView): string {
  if (!view.kind) return "";
  if (view.kind.kind === "speaker") {
    return `${view.speakerLabel} · ${view.phaseLabel} · ${view.isLive ? "speaking" : "speech ready"}`;
  }
  if (view.kind.kind === "judge-evaluating") return "The judge is evaluating the public match record.";
  if (view.kind.kind === "verdict") return "The judge has reached a verdict.";
  if (view.kind.kind === "cancelled") return "The match has ended before a verdict.";
  return `Match error: ${view.kind.message}`;
}

function toolAnnouncement(state: DebateRuntimeState): string | null {
  const event = state.activeStandardEvents[state.activeStandardEvents.length - 1];
  if (!event) return null;
  const speaker = event.type === "tool-start"
    ? event.tool.side === "A" ? "Ember" : "Vesper"
    : event.result.side === "A" ? "Ember" : "Vesper";
  const tool = event.type === "tool-start" ? event.tool.tool : event.result.tool;
  const label = toolLabel(tool).toLowerCase();
  if (event.type === "tool-start") return `${speaker} started ${label}.`;
  if (event.result.rejected) return `${speaker}'s ${label} was not run${toolReason(event.result.error)}.`;
  if (!event.result.ok) return `${speaker}'s ${label} failed${toolReason(event.result.error)}.`;
  return `${speaker}'s ${label} returned a public result.`;
}

function toolLabel(tool: string): string {
  if (tool === "web_search") return "Web search";
  if (tool === "fetch_url") return "URL fetch";
  return "Code execution";
}

function toolReason(reason: string | undefined): string {
  const clean = reason?.trim().replace(/\s+/g, " ");
  return clean ? `: ${clean.length > 90 ? `${clean.slice(0, 87)}…` : clean}` : "";
}
