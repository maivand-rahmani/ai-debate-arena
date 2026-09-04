"use client";

import type { DebateSide } from "@/entities/debate";
import type { RedactedProvider } from "@/shared/api/providers";
import type { StageSideActivity, StageView } from "../stage-state";
import { BroadcastMonitor } from "../monitor/monitor";
import { ContenderMascot } from "../mascots/contender-mascot";

interface AgentDeskProps {
  readonly side: DebateSide;
  readonly tone: "coral" | "violet";
  readonly identity: string;
  readonly position: "FOR" | "AGAINST";
  readonly provider?: RedactedProvider;
  readonly model?: string;
  readonly activity: StageSideActivity;
  readonly view: StageView;
  readonly className?: string;
}

/**
 * One contender's desk — a stylized podium with a monitor on top of it and
 * the inline-SVG contender mascot behind. The activity state drives a single
 * `data-active` attribute which CSS uses to light up the spotlight on the
 * active side only.
 */
export function AgentDesk({
  side,
  tone,
  identity,
  position,
  provider,
  model,
  activity,
  view,
  className = "",
}: AgentDeskProps) {
  const statusLabel =
    activity === "active"
      ? view.mode === "speaking" && view.round === "2"
        ? "Rebutting"
        : "Speaking"
      : view.mode === "judging"
        ? "Waiting on judge"
        : view.mode === "verdict"
          ? "Verdict read"
          : view.mode === "cancelled"
            ? "Match ended"
            : view.mode === "error"
              ? "Match error"
              : "Standing by";

  const monitorTitle = provider?.name ?? "Provider —";
  const monitorMeta = model ?? "Model —";

  return (
    <section
      className={`agent-desk agent-desk--${tone} ${className}`}
      data-side={side.toLowerCase()}
      data-active={activity}
      data-stage={view.mode}
      data-camera={view.camera}
      aria-label={`${identity} desk`}
    >
      <BroadcastMonitor
        tone={tone}
        label={`Contender ${side}`}
        title={monitorTitle}
        meta={monitorMeta}
        status={
          <span className="broadcast-monitor__status-row">
            <span aria-hidden="true" className="broadcast-monitor__pulse" />
            <span>{statusLabel}</span>
            <span className="broadcast-monitor__divider" aria-hidden="true">
              ·
            </span>
            <span>{position === "FOR" ? "Arguing for" : "Arguing against"}</span>
          </span>
        }
      />

      <div className="agent-desk__platform" aria-hidden="true">
        <div className="agent-desk__desk" />
        <div className="agent-desk__desk-edge" />
        <div className="agent-desk__mic" />
      </div>

      <div className="agent-desk__mascot">
        <ContenderMascot side={side} className="agent-desk__mascot-svg" />
      </div>

      <p className="agent-desk__identity">
        <span className="agent-desk__identity-mark">{side}</span>
        <span className="agent-desk__identity-name">{identity}</span>
      </p>
    </section>
  );
}
