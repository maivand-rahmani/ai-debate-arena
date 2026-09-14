"use client";

import type { DebateRuntimeStatus } from "@/features/run-debate/lib/reducer";

interface BroadcastBannerProps {
  readonly topic: string;
  readonly mode: "quick" | "standard" | "hardcore";
  readonly status: DebateRuntimeStatus;
  readonly onEndMatch?: () => void;
  readonly onOpenHistory?: () => void;
  readonly reactionsMuted: boolean;
  readonly onToggleMute?: () => void;
  readonly className?: string;
}

/**
 * Broadcast banner — the strip that runs across the top of the arena.
 * Carries the show title, topic, one live-status label, a reactions mute
 * toggle, and the actions (history / end match). Pure
 * presentation — driven by parent props, no internal state.
 */
export function BroadcastBanner({
  topic,
  mode,
  status,
  onEndMatch,
  onOpenHistory,
  reactionsMuted,
  onToggleMute,
  className = "",
}: BroadcastBannerProps) {
  const episode = "Tonight's motion";
  const statusView = bannerStatus(status);
  return (
    <header className={`broadcast-banner ${className}`} data-stage-banner={statusView.tone}>
      <div className="broadcast-banner__brand">
        <span className="broadcast-banner__brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
            <path
              d="M12 2.5 13.8 10l7.7 2-7.7 2-1.8 7.5-1.8-7.5-7.7-2 7.7-2L12 2.5Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="broadcast-banner__brand-text">
          DEBATE<span style={{ color: "#d4a843" }}>/</span>ARENA
          <span className="broadcast-banner__brand-sub">{episode}</span>
        </span>
      </div>

      <div className="broadcast-banner__actions" aria-label="Broadcast controls">
        <span className={`broadcast-banner__chip broadcast-banner__chip--${statusView.tone}`} role="status" aria-live="polite">
          <span className="broadcast-banner__chip-dot" aria-hidden="true" />
          {statusView.label}
        </span>
        <span className="broadcast-banner__mode">{mode === "quick" ? "Quick" : "Standard"}</span>
        {topic ? (
          <span className="broadcast-banner__topic" title={topic}>
            {topic}
          </span>
        ) : null}

        {onToggleMute ? (
          <button
            type="button"
            aria-pressed={reactionsMuted}
            aria-label={reactionsMuted ? "Unmute reactions" : "Mute reactions"}
            onClick={onToggleMute}
            className="broadcast-banner__toggle"
          >
            <span>{reactionsMuted ? "Unmute reactions" : "Mute reactions"}</span>
          </button>
        ) : null}

        {onOpenHistory ? (
          <button
            type="button"
            onClick={onOpenHistory}
            className="broadcast-banner__toggle"
          >
            Open history
          </button>
        ) : null}

        {onEndMatch ? (
          <button
            type="button"
            onClick={onEndMatch}
            className="broadcast-banner__toggle"
          >
            End match
          </button>
        ) : null}
      </div>
    </header>
  );
}

function bannerStatus(status: DebateRuntimeStatus): { readonly label: string; readonly tone: string } {
  switch (status) {
    case "starting":
      return { label: "Preparing match", tone: "pending" };
    case "streaming":
      return { label: "On air", tone: "live" };
    case "judging":
      return { label: "Judge reviewing", tone: "judging" };
    case "finished":
      return { label: "Verdict ready", tone: "complete" };
    case "cancelled":
      return { label: "Match stopped", tone: "stopped" };
    case "error":
      return { label: "Match needs attention", tone: "error" };
    case "idle":
    default:
      return { label: "Studio ready", tone: "idle" };
  }
}
