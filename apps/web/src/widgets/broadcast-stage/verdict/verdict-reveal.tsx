"use client";

import { MatchActions, type RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";

export interface JudgePanelFooter {
  /** Server-assigned match id from the v1 stream envelope (may be undefined for very early states). */
  readonly matchId?: string;
  /** True once the match has a full saved transcript on disk (terminal=completed, transcript.length=4). */
  readonly canRejudge: boolean;
  readonly rejudgeStatus: RejudgeStatus;
  readonly rejudgeError?: string;
  /** Optional ISO timestamp of the most recent re-judge for the "re-judged" indicator. */
  readonly judgedAt?: string;
  readonly onExportJson: (matchId: string) => void | Promise<unknown>;
  readonly onRejudge: (matchId: string) => void | Promise<unknown>;
}

interface VerdictEvaluatingProps {
  readonly title?: string;
  readonly body?: string;
  readonly footer?: JudgePanelFooter;
}

/**
 * Calm "Judge is evaluating" panel — used while the judge works.
 * Replaces the v0.1 verdict-panel evaluating state with the v0.3 surface.
 */
export function VerdictEvaluating({
  title = "Weighing the arguments",
  body = "The judge reviews the transcript and scores each side across argument quality, rebuttal, consistency, and relevance.",
  footer,
}: VerdictEvaluatingProps) {
  return (
    <section className="verdict-evaluating" aria-live="polite">
      <span className="verdict-evaluating__pulse">Judge is evaluating</span>
      <h2 className="verdict-evaluating__title">{title}</h2>
      <p className="verdict-evaluating__body">{body}</p>
      {footer?.matchId ? (
        <div className="verdict-reveal__actions" style={{ marginTop: "8px" }}>
          <span className="verdict-reveal__actions-left">Save & inspect</span>
          <MatchActions
            matchId={footer.matchId}
            rejudgeStatus={footer.rejudgeStatus}
            rejudgeError={footer.rejudgeError}
            canRejudge={footer.canRejudge}
            onExportJson={footer.onExportJson}
            onRejudge={footer.onRejudge}
          />
        </div>
      ) : null}
    </section>
  );
}
