"use client";

import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import { MatchActions, type ExportStatus, type RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";

interface VerdictCardProps {
  readonly verdict: DebateStreamVerdict;
  readonly topic: string;
  readonly sideAPosition?: "FOR" | "AGAINST";
  readonly sideBPosition?: "FOR" | "AGAINST";
  /** Returns the viewer to the arena's start screen to begin another match. */
  readonly onNewMatch?: () => void;
  readonly footer?: {
    readonly matchId?: string;
    readonly canRejudge: boolean;
    readonly rejudgeStatus: RejudgeStatus;
    readonly rejudgeError?: string;
    readonly refreshError?: string;
    readonly exportStatus?: ExportStatus;
    readonly exportError?: string;
    readonly judgedAt?: string;
    readonly onExportJson: (matchId: string) => void | Promise<unknown>;
    readonly onRejudge: (matchId: string) => void | Promise<unknown>;
  };
}

/**
 * Verdict card that lives inside the live-match caption region. Same
 * content as the old terminal panel but rendered in the bottom-center
 * caption chrome so the 3D scene stays visible behind. When the user
 * wants the full-screen detail (re-judge flow, export, etc.) the
 * actions use the existing match-actions + criteria-view bits.
 */
export function VerdictCard({
  verdict,
  topic,
  sideAPosition = "FOR",
  sideBPosition = "AGAINST",
  onNewMatch,
  footer,
}: VerdictCardProps) {
  const winner = verdict.winner;
  const winnerLabel =
    winner === "DRAW" ? "Draw" : winner === "A" ? "The Challenger wins" : "The Advocate wins";
  const winnerPosition = winner === "A" ? sideAPosition : sideBPosition;
  const scoreMargin = Math.abs(verdict.scoreA - verdict.scoreB);
  const tagline = winner === "DRAW"
    ? `${scoreMargin}-point gap · scored as a draw`
    : `${scoreMargin}-point margin · ${winnerPosition === "FOR" ? "for" : "against"} the motion`;

  return (
    <section className="verdict-card" aria-label="Verdict" aria-live="polite">
      <header className="verdict-card__head">
        <span className="verdict-card__chip">
          <span aria-hidden="true">★</span>
          Verdict
        </span>
        <span className="verdict-card__tagline">{tagline}</span>
      </header>
      <h2 className="verdict-card__winner">
        {winnerLabel}
        <span aria-hidden="true" className="verdict-card__winner-mark">
          {winner === "DRAW" ? "—" : "✦"}
        </span>
      </h2>
      <p className="verdict-card__topic" title={topic}>
        {topic}
      </p>

      <div className="verdict-card__scores">
        <ScoreCard
          tone="coral"
          identity="The Challenger"
          score={verdict.scoreA}
          outcome={winner === "DRAW" ? "Draw" : winner === "A" ? "Winner" : "Runner up"}
          isWinner={winner === "A"}
        />
        <span aria-hidden="true" className="verdict-card__divider">
          vs
        </span>
        <ScoreCard
          tone="violet"
          identity="The Advocate"
          score={verdict.scoreB}
          outcome={winner === "DRAW" ? "Draw" : winner === "B" ? "Winner" : "Runner up"}
          isWinner={winner === "B"}
        />
      </div>

      <table className="verdict-card__criteria">
        <caption className="sr-only">Judge scorecard</caption>
        <thead>
          <tr className="verdict-card__criteria-head">
            <th scope="col">Criterion</th>
            <th scope="col" aria-label={`Challenger score ${verdict.scoreA}`}>Challenger</th>
            <th scope="col" aria-label={`Advocate score ${verdict.scoreB}`}>Advocate</th>
          </tr>
        </thead>
        <tbody>
          {CRITERIA.map((criterion) => {
          const scoreA = verdict.criteria[criterion.a];
          const scoreB = verdict.criteria[criterion.b];
          const leader = scoreA === scoreB ? "tie" : scoreA > scoreB ? "a" : "b";
          return (
            <tr key={criterion.label} className="verdict-card__criterion">
              <th scope="row">{criterion.label}</th>
              <td className={leader === "a" ? "is-leading" : ""}>{scoreA}</td>
              <td className={leader === "b" ? "is-leading" : ""}>{scoreB}</td>
            </tr>
          );
          })}
        </tbody>
      </table>

      {verdict.reasoning ? (
        <p className="verdict-card__reasoning">
          <span className="verdict-card__reasoning-label">Judge’s rationale</span>
          {verdict.reasoning}
        </p>
      ) : null}

      {onNewMatch || footer?.matchId ? (
        <div className="verdict-card__actions">
          {onNewMatch ? (
            <button type="button" className="verdict-card__new-match" onClick={onNewMatch}>
              New debate
              <span aria-hidden="true">→</span>
            </button>
          ) : null}
          {footer?.matchId ? (
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
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ScoreCard({
  tone,
  identity,
  score,
  outcome,
  isWinner,
}: {
  readonly tone: "coral" | "violet";
  readonly identity: string;
  readonly score: number;
  readonly outcome: "Winner" | "Runner up" | "Draw";
  readonly isWinner: boolean;
}) {
  return (
    <div
      className={`verdict-card__score verdict-card__score--${tone}${
        isWinner ? " verdict-card__score--winner" : ""
      }`}
    >
      <div className="verdict-card__score-head">
        <span>{identity}</span>
        <span>{outcome}</span>
      </div>
      <p className="verdict-card__score-value">
        {score}
        <span className="verdict-card__score-suffix">/ 100</span>
      </p>
      <div className="verdict-card__score-bar" aria-hidden="true">
        <div className="verdict-card__score-bar-fill" style={{ width: `${clampScore(score)}%` }} />
      </div>
    </div>
  );
}

const CRITERIA = [
  { label: "Argument quality", a: "argumentQualityA", b: "argumentQualityB" },
  { label: "Rebuttal", a: "rebuttalA", b: "rebuttalB" },
  { label: "Consistency", a: "consistencyA", b: "consistencyB" },
  { label: "Relevance", a: "relevanceA", b: "relevanceB" },
] as const;

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, score));
}
