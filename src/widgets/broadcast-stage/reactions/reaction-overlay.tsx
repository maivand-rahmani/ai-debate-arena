"use client";

import type { ReactionView } from "../reaction";

interface ReactionOverlayProps {
  readonly reaction: ReactionView | null;
  readonly muted: boolean;
  readonly position?: "top-left" | "top-right" | "bottom-center";
  readonly className?: string;
}

/**
 * Floating reaction sticker. Driven by the pure `reaction` projection;
 * `muted` honors the broadcast banner toggle. The CSS animation that pops
 * the sticker in is automatically neutralised by the global reduced-motion
 * override, so we don't need to do anything extra here.
 */
export function ReactionOverlay({
  reaction,
  muted,
  position = "top-right",
  className = "",
}: ReactionOverlayProps) {
  if (!reaction || muted) return null;

  return (
    <div
      className={`reaction-overlay reaction-overlay--${position} ${className}`}
      aria-hidden="true"
    >
      <div className={`reaction-sticker reaction-sticker--${reaction.tone}`}>
        <span className="reaction-sticker__icon" aria-hidden="true">
          <ReactionIcon id={reaction.id} />
        </span>
        <span>{reaction.label}</span>
      </div>
    </div>
  );
}

function ReactionIcon({ id }: { id: ReactionView["id"] }) {
  switch (id) {
    case "cooking":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 14 V18 a2 2 0 0 0 2 2 h10 a2 2 0 0 0 2 -2 V14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M7 12 L9 6 h6 l2 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M12 4 V7 M9 5 L12 8 M15 5 L12 8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "panicking":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 12 Q 12 4 20 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="9" cy="13" r="1" fill="currentColor" />
          <circle cx="15" cy="13" r="1" fill="currentColor" />
          <path
            d="M9 17 q 3 2 6 0"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      );
    case "objection":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 12 H19 M14 6 L20 12 L14 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "judge-not-impressed":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path
            d="M8 14 Q 12 10 16 14"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="9" cy="10" r="1" fill="currentColor" />
          <circle cx="15" cy="10" r="1" fill="currentColor" />
        </svg>
      );
    case "argument-stopped":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path
            d="M9 9 L15 15 M15 9 L9 15"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "timeout":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 8 V13 L15 15"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M9 3 H15"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "verdict-landed":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3 12 L9 18 L21 6"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}
