"use client";

import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import { MatchActions, type RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";

interface VerdictCardProps {
  readonly verdict: DebateStreamVerdict;
  readonly topic: string;
  readonly footer?: {
    readonly matchId?: string;
    readonly canRejudge: boolean;
    readonly rejudgeStatus: RejudgeStatus;
    readonly rejudgeError?: string;
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
export function VerdictCard({ verdict, topic, footer }: VerdictCardProps) {
  const total = Math.max(1, verdict.scoreA + verdict.scoreB);
  const shareA = Math.round((verdict.scoreA / total) * 100);
  const shareB = 100 - shareA;
  const winner = verdict.winner;
  const winnerLabel =
    winner === "DRAW" ? "Draw" : winner === "A" ? "The Challenger wins" : "The Advocate wins";
  const tagline =
    winner === "DRAW" ? "Tied" : winner === "A" ? "For the motion" : "Against the motion";

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
          share={shareA}
          isWinner={winner === "A"}
        />
        <span aria-hidden="true" className="verdict-card__divider">
          vs
        </span>
        <ScoreCard
          tone="violet"
          identity="The Advocate"
          score={verdict.scoreB}
          share={shareB}
          isWinner={winner === "B"}
        />
      </div>

      {verdict.reasoning ? (
        <p className="verdict-card__reasoning">
          <span className="verdict-card__reasoning-label">Reasoning</span>
          {verdict.reasoning}
        </p>
      ) : null}

      {footer?.matchId ? (
        <div className="verdict-card__actions">
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

function ScoreCard({
  tone,
  identity,
  score,
  share,
  isWinner,
}: {
  readonly tone: "coral" | "violet";
  readonly identity: string;
  readonly score: number;
  readonly share: number;
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
        <span>{isWinner ? "Winner" : "Runner up"}</span>
      </div>
      <p className="verdict-card__score-value">
        {score}
        <span className="verdict-card__score-suffix">/ 100</span>
      </p>
      <div className="verdict-card__score-bar" aria-hidden="true">
        <div className="verdict-card__score-bar-fill" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}
