"use client";

import { useEffect, useRef } from "react";
import type { DebateRuntimeState, SpeechPanel } from "@/features/run-debate/lib/reducer";
import { deriveCaptionView, type CaptionView } from "./caption-view";

interface LiveCaptionProps {
  readonly state: DebateRuntimeState;
  /** A spectator-selected speech that should remain on screen while later turns generate. */
  readonly focusedPanel?: SpeechPanel | null;
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
export function LiveCaption({ state, focusedPanel }: LiveCaptionProps) {
  const view = deriveCaptionView(state, focusedPanel);
  if (!view.visible) return null;
  return <CaptionPanel view={view} />;
}

function CaptionPanel({ view }: { view: CaptionView }) {
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
        <span className="live-caption__status" aria-live="polite">
          {status}
        </span>
      </header>
      <div ref={bodyRef} className="live-caption__body" aria-live="off">
        {view.text ? (
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
