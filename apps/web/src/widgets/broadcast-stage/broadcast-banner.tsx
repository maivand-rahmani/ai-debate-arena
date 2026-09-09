"use client";

interface BroadcastBannerProps {
  readonly topic: string;
  readonly mode: "quick" | "standard" | "hardcore";
  readonly inMatch: boolean;
  readonly onEndMatch?: () => void;
  readonly onOpenHistory?: () => void;
  readonly reactionsMuted: boolean;
  readonly onToggleMute?: () => void;
  readonly className?: string;
}

/**
 * Broadcast banner — the strip that runs across the top of the arena.
 * Carries the show title, episode mark, mode chip, a live-status chip, a
 * reactions mute toggle, and the actions (history / end match). Pure
 * presentation — driven by parent props, no internal state.
 */
export function BroadcastBanner({
  topic,
  mode,
  inMatch,
  onEndMatch,
  onOpenHistory,
  reactionsMuted,
  onToggleMute,
  className = "",
}: BroadcastBannerProps) {
  const episode = "Tonight's motion";
  return (
    <header className={`broadcast-banner ${className}`} data-stage-banner={inMatch ? "live" : "idle"}>
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

      <div className="broadcast-banner__actions" aria-label="Broadcast status">
        <span className={`broadcast-banner__chip${inMatch ? " broadcast-banner__chip--live" : ""}`}>
          <span className="broadcast-banner__chip-dot" aria-hidden="true" />
          {inMatch ? "On air" : "Studio idle"}
        </span>
        <span className="broadcast-banner__chip">
          {mode === "quick" ? "Quick mode" : mode}
        </span>
        {topic ? (
          <span className="broadcast-banner__chip" style={{ maxWidth: "320px", overflow: "hidden", textOverflow: "ellipsis" }}>
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
            <span aria-hidden="true">{reactionsMuted ? "🔇" : "🔊"}</span>
            <span>{reactionsMuted ? "Muted" : "Reactions"}</span>
          </button>
        ) : null}

        {onOpenHistory ? (
          <button
            type="button"
            onClick={onOpenHistory}
            className="broadcast-banner__toggle"
          >
            History
          </button>
        ) : null}

        {onEndMatch && inMatch ? (
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
