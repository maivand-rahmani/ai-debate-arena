"use client";

import type { DebateRuntimeStatus } from "@/features/run-debate/lib/reducer";

interface BroadcastBannerProps {
  readonly topic: string;
  readonly mode: "quick" | "standard" | "hardcore";
  readonly status: DebateRuntimeStatus;
  readonly onEndMatch?: () => void;
  readonly onOpenHistory?: () => void;
  readonly className?: string;
}

/**
 * Broadcast banner — the strip that runs across the top of the arena.
 * Carries the show title, topic, one live-status label, and quiet actions.
 * History stays available from the idle/home surface; live broadcast chrome
 * stays focused on the match. Pure
 * presentation — driven by parent props, no internal state.
 */
export function BroadcastBanner({
  topic,
  mode,
  status,
  onEndMatch,
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
          DEBATE<span className="broadcast-banner__brand-slash">/</span>ARENA
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

        {onEndMatch ? (
          <button
            type="button"
            onClick={onEndMatch}
            className="broadcast-banner__toggle broadcast-banner__end"
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
