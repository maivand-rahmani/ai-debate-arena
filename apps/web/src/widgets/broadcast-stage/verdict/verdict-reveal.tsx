"use client";

import { MatchActions, type ExportStatus, type RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";
import type { JudgeActivityState } from "@/features/run-debate/lib/reducer";
import type { DebateStreamJudgeActivityStage } from "@arena/types";

export interface JudgePanelFooter {
  /** Server-assigned match id from the v1 stream envelope (may be undefined for very early states). */
  readonly matchId?: string;
  /** True once the match has a full saved transcript on disk (terminal=completed, transcript.length=4). */
  readonly canRejudge: boolean;
  readonly rejudgeStatus: RejudgeStatus;
  readonly rejudgeError?: string;
  readonly refreshError?: string;
  readonly exportStatus?: ExportStatus;
  readonly exportError?: string;
  /** Optional ISO timestamp of the most recent re-judge for the "re-judged" indicator. */
  readonly judgedAt?: string;
  readonly onExportJson: (matchId: string) => void | Promise<unknown>;
  readonly onRejudge: (matchId: string) => void | Promise<unknown>;
}

interface VerdictEvaluatingProps {
  readonly title?: string;
  readonly body?: string;
  readonly footer?: JudgePanelFooter;
  readonly judgeActivity?: JudgeActivityState;
}

const REVIEW_STAGES: readonly { readonly id: DebateStreamJudgeActivityStage; readonly label: string }[] = [
  { id: "record-loaded", label: "Record loaded" },
  { id: "evidence-check", label: "Public evidence checked" },
  { id: "rubric-check", label: "Rubric checked" },
  { id: "comparing", label: "Comparing both sides" },
];

/**
 * Calm "Judge is evaluating" panel — used while the judge works.
 * Replaces the v0.1 verdict-panel evaluating state with the v0.3 surface.
 */
export function VerdictEvaluating({
  title = "Weighing the arguments",
  body = "The judge reviews the transcript and scores each side across argument quality, rebuttal, consistency, and relevance.",
  footer,
  judgeActivity,
}: VerdictEvaluatingProps) {
  const currentStage = REVIEW_STAGES.find((stage) => stage.id === judgeActivity?.stage);
  const currentStatus = currentStage?.label ?? "Preparing the public review";

  return (
    <section className="verdict-evaluating" aria-label="Judge review">
      <span className="verdict-evaluating__pulse">JUDGE REVIEW</span>
      <p className="verdict-evaluating__status" role="status" aria-live="polite" aria-atomic="true">
        {currentStatus}
      </p>
      <h2 className="verdict-evaluating__title">{title}</h2>
      <p className="verdict-evaluating__body">{body}</p>
      <div className="verdict-evaluating__console">
        <div className="verdict-evaluating__metadata" aria-label="Public review metadata">
          <span>{judgeActivity?.turnCount ?? 0} turns</span>
          <span>
            {judgeActivity?.successfulEvidenceCount ?? 0} / {judgeActivity?.evidenceCount ?? 0} public evidence successful
          </span>
          <span>{judgeActivity?.criteria.length ?? 0} criteria</span>
        </div>
        <ol className="verdict-evaluating__stages" aria-label="Judge review stages">
          {REVIEW_STAGES.map((stage, index) => {
            const state = stageState(stage.id, judgeActivity);
            return (
              <li key={stage.id} className={`verdict-evaluating__stage verdict-evaluating__stage--${state}`}>
                <span className="verdict-evaluating__stage-marker" aria-hidden="true">
                  {state === "complete" ? "✓" : index + 1}
                </span>
                <span>{stage.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
      {footer?.matchId ? (
        <div className="verdict-reveal__actions" style={{ marginTop: "8px" }}>
          <span className="verdict-reveal__actions-left">Save & inspect</span>
          <MatchActions
            matchId={footer.matchId}
            rejudgeStatus={footer.rejudgeStatus}
            rejudgeError={footer.rejudgeError}
            refreshError={footer.refreshError}
            exportStatus={footer.exportStatus}
            exportError={footer.exportError}
            canRejudge={footer.canRejudge}
            onExportJson={footer.onExportJson}
            onRejudge={footer.onRejudge}
          />
        </div>
      ) : null}
    </section>
  );
}

function stageState(
  stage: DebateStreamJudgeActivityStage,
  activity: JudgeActivityState | undefined,
): "complete" | "current" | "upcoming" {
  if (!activity) return "upcoming";
  if (activity.stage === stage) return "current";
  return activity.stages.includes(stage) ? "complete" : "upcoming";
}
