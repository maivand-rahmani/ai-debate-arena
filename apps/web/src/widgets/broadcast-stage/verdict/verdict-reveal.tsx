"use client";

import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
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

interface VerdictRevealProps {
  readonly verdict: DebateStreamVerdict;
  readonly reasoning?: string;
  readonly footer?: JudgePanelFooter;
}

/**
 * Dramatic TV reveal surface for a finished verdict. Big winner headline,
 * side-by-side score cards, four criterion bars, judge reasoning prose, and
 * the existing match actions. Built on top of the v0.2 verdict data
 * semantics — only the visual surface changes.
 */
export function VerdictReveal({ verdict, reasoning, footer }: VerdictRevealProps) {
  const winner = verdict.winner;
  const winnerLabel =
    winner === "DRAW" ? "Draw" : winner === "A" ? "The Challenger wins" : "The Advocate wins";
  const total = Math.max(1, verdict.scoreA + verdict.scoreB);
  const shareA = Math.round((verdict.scoreA / total) * 100);
  const shareB = 100 - shareA;
  const tagline =
    winner === "DRAW"
      ? "Tied"
      : winner === "A"
        ? "For the motion"
        : "Against the motion";

  return (
    <section className="verdict-reveal" aria-live="polite">
      <header className="verdict-reveal__head">
        <span className="verdict-reveal__head-tag">
          <span aria-hidden="true">★</span>
          Verdict reached
        </span>
        <span>{tagline}</span>
      </header>

      <h2 className="verdict-reveal__winner">
        {winnerLabel}
        <span className="verdict-reveal__winner-mark" aria-hidden="true">
          {winner === "DRAW" ? "—" : "✦"}
        </span>
      </h2>

      <div className="verdict-reveal__scores">
        <ScoreCard
          tone="coral"
          identity="The Challenger"
          score={verdict.scoreA}
          share={shareA}
          isWinner={winner === "A"}
        />
        <span aria-hidden="true" className="score-card__divider">vs</span>
        <ScoreCard
          tone="violet"
          identity="The Advocate"
          score={verdict.scoreB}
          share={shareB}
          isWinner={winner === "B"}
        />
      </div>

      <div className="verdict-reveal__criteria">
        <CriteriaRow
          title="Argument quality"
          left={verdict.criteria.argumentQualityA}
          right={verdict.criteria.argumentQualityB}
        />
        <CriteriaRow
          title="Rebuttal"
          left={verdict.criteria.rebuttalA}
          right={verdict.criteria.rebuttalB}
        />
        <CriteriaRow
          title="Consistency"
          left={verdict.criteria.consistencyA}
          right={verdict.criteria.consistencyB}
        />
        <CriteriaRow
          title="Relevance"
          left={verdict.criteria.relevanceA}
          right={verdict.criteria.relevanceB}
        />
      </div>

      {reasoning ? (
        <div className="verdict-reveal__reasoning">
          <p className="verdict-reveal__reasoning-head">{"Judge\u2019s reasoning"}</p>
          <p className="verdict-reveal__reasoning-body">{reasoning}</p>
        </div>
      ) : null}

      {footer?.matchId ? (
        <div className="verdict-reveal__actions">
          <span className="verdict-reveal__actions-left">
            {footer.judgedAt ? "Re-judged · " : ""}Save & inspect
          </span>
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

interface ScoreCardProps {
  readonly tone: "coral" | "violet";
  readonly identity: string;
  readonly score: number;
  readonly share: number;
  readonly isWinner: boolean;
}

function ScoreCard({ tone, identity, score, share, isWinner }: ScoreCardProps) {
  const cls = `score-card score-card--${tone}${isWinner ? " score-card--winner" : ""}`;
  return (
    <div className={cls}>
      <div className="score-card__head">
        <span>{identity}</span>
        <span>{isWinner ? "Winner" : "Runner up"}</span>
      </div>
      <p className="score-card__value">
        {score}
        <span style={{ fontSize: "0.4em", marginLeft: "6px", color: "#b8a285", fontWeight: 700 }}>
          / 100
        </span>
      </p>
      <div className="score-card__bar" aria-hidden="true">
        <div className="score-card__bar-fill" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

interface CriteriaRowProps {
  readonly title: string;
  readonly left: number;
  readonly right: number;
}

function CriteriaRow({ title, left, right }: CriteriaRowProps) {
  const total = Math.max(1, left + right);
  const leftPct = (left / total) * 100;
  return (
    <div className="criteria-row">
      <div className="criteria-row__head">
        <span>{title}</span>
        <span>
          A {left} · {right} B
        </span>
      </div>
      <div className="criteria-row__values">
        <span style={{ color: "#e8b59b" }}>A {left}</span>
        <span style={{ color: "#b89cbe" }}>{right} B</span>
      </div>
      <div className="criteria-row__bar" aria-hidden="true">
        <div className="criteria-row__bar-a" style={{ width: `${leftPct}%` }} />
        <div className="criteria-row__bar-b" style={{ width: `${100 - leftPct}%` }} />
      </div>
    </div>
  );
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
