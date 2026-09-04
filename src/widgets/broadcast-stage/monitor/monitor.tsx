"use client";

import type { ReactNode } from "react";

interface BroadcastMonitorProps {
  readonly label: string;
  readonly title: string;
  readonly meta?: string;
  readonly status: ReactNode;
  readonly tone: "coral" | "violet" | "gold";
  readonly className?: string;
}

/**
 * A stylized "broadcast monitor" tile that sits on top of a desk or plinth.
 * Carries provider/model identity plus a status pill — the rest of the
 * composition (mascot, desk, backdrop) handles the visual atmosphere. The
 * monitor text is plain DOM text, so it stays accessible and screen-readable.
 */
export function BroadcastMonitor({
  label,
  title,
  meta,
  status,
  tone,
  className = "",
}: BroadcastMonitorProps) {
  return (
    <div
      className={`broadcast-monitor broadcast-monitor--${tone} ${className}`}
      data-tone={tone}
      role="group"
      aria-label={`${label} monitor`}
    >
      <div className="broadcast-monitor__bar">
        <span aria-hidden="true" className="broadcast-monitor__dot" />
        <span className="broadcast-monitor__label">{label}</span>
      </div>
      <p className="broadcast-monitor__title">{title}</p>
      {meta ? <p className="broadcast-monitor__meta">{meta}</p> : null}
      <div className="broadcast-monitor__status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}
