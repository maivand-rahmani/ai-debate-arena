"use client";

import type { RedactedProvider } from "@/shared/api/providers";
import type { StageSideActivity, StageView } from "../stage-state";
import { BroadcastMonitor } from "../monitor/monitor";
import { JudgeMascot } from "../mascots/judge-mascot";

interface JudgePlinthProps {
  readonly judgeProvider?: RedactedProvider;
  readonly judgeModel?: string;
  readonly activity: StageSideActivity;
  readonly view: StageView;
  readonly className?: string;
}

/**
 * Central judge plinth. Slightly larger than the contender desks, with a
 * raised base, a monitor showing the judge's provider/model, and the
 * judge mascot behind. Lit up by the stage's gold spotlight when the judge
 * is active.
 */
export function JudgePlinth({
  judgeProvider,
  judgeModel,
  activity,
  view,
  className = "",
}: JudgePlinthProps) {
  const statusLabel =
    view.mode === "judging"
      ? "Evaluating the debate"
      : view.mode === "verdict"
        ? view.rootDataAttributes["data-camera"] === "verdict"
          ? "Verdict reached"
          : "Verdict read"
        : view.mode === "cancelled"
          ? "Match ended"
          : view.mode === "error"
            ? "Match error"
            : "Standing by";

  const monitorTitle = judgeProvider?.name ?? "Judge —";
  const monitorMeta = judgeModel ?? "Awaiting configuration";

  return (
    <section
      className={`judge-plinth ${className}`}
      data-active={activity}
      data-stage={view.mode}
      data-camera={view.camera}
      aria-label="Judge plinth"
    >
      <BroadcastMonitor
        tone="gold"
        label="Judge"
        title={monitorTitle}
        meta={monitorMeta}
        status={
          <span className="broadcast-monitor__status-row">
            <span aria-hidden="true" className="broadcast-monitor__pulse broadcast-monitor__pulse--gold" />
            <span>{statusLabel}</span>
          </span>
        }
      />

      <div className="judge-plinth__platform" aria-hidden="true">
        <div className="judge-plinth__base" />
        <div className="judge-plinth__base-edge" />
        <div className="judge-plinth__rings" />
      </div>

      <div className="judge-plinth__mascot">
        <JudgeMascot className="judge-plinth__mascot-svg" />
      </div>
    </section>
  );
}
