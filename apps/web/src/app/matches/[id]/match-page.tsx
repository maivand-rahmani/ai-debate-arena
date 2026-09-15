"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchMatch,
  rejudgeMatch,
  MatchesApiError,
  type MatchRecord,
} from "@/shared/api/matches";
import { exportJsonBlob, MatchActions, type ExportStatus, type RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";
import { CriteriaView } from "@/features/run-debate/ui/match-history/criteria-view";
import { formatMatchDate, TERMINAL_LABEL, WINNER_LABEL } from "@/features/run-debate/ui/match-history/format-helpers";
import { TranscriptThread } from "@/features/arena/match/transcript-thread";

interface MatchPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

/**
 * Per-match archive: a continuous match story with the public transcript,
 * recorded tool evidence, and a distinct closing verdict. This surface is
 * intentionally separate from the live arena; it is for reading the match
 * back, not for replaying its runtime.
 */
export default function MatchPage({ params }: MatchPageProps) {
  const { id } = use(params);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [record, setRecord] = useState<MatchRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [rejudgeStatus, setRejudgeStatus] = useState<RejudgeStatus>("idle");
  const [rejudgeError, setRejudgeError] = useState<string | undefined>(undefined);
  const [refreshError, setRefreshError] = useState<string | undefined>(undefined);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportError, setExportError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchMatch(id)
      .then((match) => {
        if (cancelled) return;
        setRecord(match);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          reason instanceof MatchesApiError ? reason.message : "Could not load this match.",
        );
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const retryLoad = useCallback(() => {
    setErrorMessage(null);
    setStatus("loading");
    setReloadKey((key) => key + 1);
  }, []);

  const handleExportJson = useCallback(() => {
    if (!record) return;
    setExportStatus("flying");
    setExportError(undefined);
    try {
      exportJsonBlob(record, record.matchId);
      setExportStatus("idle");
    } catch (reason) {
      setExportStatus("error");
      setExportError(reason instanceof Error ? reason.message : "Could not export this match.");
    }
  }, [record]);

  const handleRejudge = useCallback(async () => {
    setRejudgeStatus("flying");
    setRejudgeError(undefined);
    setRefreshError(undefined);
    try {
      await rejudgeMatch(id);
    } catch (reason) {
      setRejudgeStatus("error");
      setRejudgeError(
        reason instanceof Error ? reason.message : "Could not re-judge this match.",
      );
      return;
    }
    try {
      const next = await fetchMatch(id);
      setRecord(next);
      setRejudgeStatus("idle");
    } catch (reason) {
      setRejudgeStatus("idle");
      setRefreshError(reason instanceof Error ? reason.message : "Could not refresh this match.");
    }
  }, [id]);

  return (
    <main className="match-page" aria-label="Match archive">
      <div className="match-page__backdrop" aria-hidden="true" />
      <article className="match-page__panel">
        <nav className="match-page__nav" aria-label="Breadcrumb">
          <Link href="/" className="match-page__home">
            <span aria-hidden="true">←</span> Arena
          </Link>
        </nav>

        {status === "loading" ? (
          <p className="match-page__status" role="status">
            Loading match…
          </p>
        ) : status === "error" || !record ? (
          <ErrorState message={errorMessage ?? "The match could not be loaded."} onRetry={retryLoad} />
        ) : (
          <MatchBody
            record={record}
            rejudgeStatus={rejudgeStatus}
            rejudgeError={rejudgeError}
            refreshError={refreshError}
            exportStatus={exportStatus}
            exportError={exportError}
            onExportJson={handleExportJson}
            onRejudge={handleRejudge}
          />
        )}
      </article>
    </main>
  );
}

function MatchBody({
  record,
  rejudgeStatus,
  rejudgeError,
  refreshError,
  exportStatus,
  exportError,
  onExportJson,
  onRejudge,
}: {
  readonly record: MatchRecord;
  readonly rejudgeStatus: RejudgeStatus;
  readonly rejudgeError: string | undefined;
  readonly refreshError: string | undefined;
  readonly exportStatus: ExportStatus;
  readonly exportError: string | undefined;
  readonly onExportJson: () => void;
  readonly onRejudge: () => void;
}) {
  const canRejudge = record.terminal === "completed";
  const verdict = record.verdict;
  return (
    <>
      <header className="match-page__head">
        <p className="match-page__eyebrow">
          Archive · {record.mode === "quick" ? "Quick" : record.mode} · {TERMINAL_LABEL[record.terminal]}
          {record.judgedAt ? " · Re-judged" : ""}
        </p>
        <h1 className="match-page__topic">{record.topic}</h1>
        <div className="match-page__matchup" aria-label="Matchup">
          <MatchSide identity="ember" name="Ember" role="Challenger" side={record.sides.A} />
          <span className="match-page__versus" aria-hidden="true">VS</span>
          <MatchSide identity="vesper" name="Vesper" role="Advocate" side={record.sides.B} />
        </div>
        <div className="match-page__meta-row">
          <span>{formatMatchDate(record.startedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDuration(record.metrics.totalMs)}</span>
          <span aria-hidden="true">·</span>
          <span>{record.transcript.length} {record.transcript.length === 1 ? "turn" : "turns"}</span>
          <span aria-hidden="true">·</span>
          <span>{record.mode === "quick" ? "Quick format" : "Standard evidence match"}</span>
        </div>
        <div className="match-page__result" aria-label="Match result">
          <span className="match-page__result-label">{verdict ? "Winner" : "Terminal state"}</span>
          <strong className={`match-page__winner-name match-page__winner-name--${winnerTone(verdict?.winner)}`}>
            {winnerName(verdict?.winner)}
          </strong>
          {verdict ? <span className="match-page__score">{verdict.scoreA} <span aria-hidden="true">—</span> {verdict.scoreB}</span> : null}
          <span className="match-page__terminal">{TERMINAL_LABEL[record.terminal]}</span>
        </div>
      </header>

      <section className="match-page__section" aria-labelledby="match-transcript">
        <div className="match-page__section-head">
          <div>
            <p className="match-page__section-kicker">The public record</p>
            <h2 id="match-transcript" className="match-page__section-title">Match story</h2>
          </div>
          <span className="match-page__section-note">{record.transcript.length} {record.transcript.length === 1 ? "turn" : "turns"} recorded</span>
        </div>
        <TranscriptThread mode={record.mode} turns={record.transcript} toolEvents={record.toolEvents} />
      </section>

      {verdict ? (
        <section className="match-page__section match-page__verdict" aria-labelledby="match-verdict">
          <div className="match-page__section-head">
            <div>
              <p className="match-page__section-kicker">The closing call</p>
              <h2 id="match-verdict" className="match-page__section-title">Judge&apos;s verdict</h2>
            </div>
            <span className="match-page__section-note">{record.judgedAt ? `Judged ${formatMatchDate(record.judgedAt)}` : "Final review"}</span>
          </div>
          <div className="match-page__verdict-summary">
            <span className="match-page__result-label">{winnerName(verdict.winner)}</span>
            <strong>{verdict.scoreA} — {verdict.scoreB}</strong>
          </div>
          <CriteriaView record={record} />
          <ArchiveActions
            record={record}
            rejudgeStatus={rejudgeStatus}
            rejudgeError={rejudgeError}
            refreshError={refreshError}
            exportStatus={exportStatus}
            exportError={exportError}
            canRejudge={canRejudge}
            onExportJson={onExportJson}
            onRejudge={onRejudge}
          />
        </section>
      ) : (
        <section className="match-page__section">
          <div className="match-page__no-verdict">
            <p className="match-page__section-kicker">Closing state</p>
            <p className="match-page__status">No verdict was reached for this match.{record.terminalReason ? ` ${record.terminalReason}` : ""}</p>
          </div>
          <ArchiveActions
            record={record}
            rejudgeStatus={rejudgeStatus}
            rejudgeError={rejudgeError}
            refreshError={refreshError}
            exportStatus={exportStatus}
            exportError={exportError}
            canRejudge={canRejudge}
            onExportJson={onExportJson}
            onRejudge={onRejudge}
          />
        </section>
      )}
    </>
  );
}

function MatchSide({
  identity,
  name,
  role,
  side,
}: {
  readonly identity: "ember" | "vesper";
  readonly name: string;
  readonly role: string;
  readonly side: MatchRecord["sides"]["A"];
}) {
  return (
    <div className={`match-page__side match-page__side--${identity}`}>
      <span className="match-page__side-mark" aria-hidden="true">{name[0]}</span>
      <span className="match-page__side-copy">
        <strong>{name}</strong>
        <span>{role}</span>
        <small>{side.providerName} · {side.modelId}</small>
      </span>
    </div>
  );
}

function ArchiveActions({
  record,
  rejudgeStatus,
  rejudgeError,
  refreshError,
  exportStatus,
  exportError,
  canRejudge,
  onExportJson,
  onRejudge,
}: {
  readonly record: MatchRecord;
  readonly rejudgeStatus: RejudgeStatus;
  readonly rejudgeError: string | undefined;
  readonly refreshError: string | undefined;
  readonly exportStatus: ExportStatus;
  readonly exportError: string | undefined;
  readonly canRejudge: boolean;
  readonly onExportJson: () => void;
  readonly onRejudge: () => void;
}) {
  return (
    <div className="match-page__archive-actions">
      <div>
        <p className="match-page__section-kicker">Archive tools</p>
        <p className="match-page__actions-note">Export the saved record or ask the judge to review it again.</p>
      </div>
      <MatchActions
        matchId={record.matchId}
        rejudgeStatus={rejudgeStatus}
        rejudgeError={rejudgeError}
        refreshError={refreshError}
        exportStatus={exportStatus}
        exportError={exportError}
        canRejudge={canRejudge}
        onExportJson={() => onExportJson()}
        onRejudge={() => void onRejudge()}
      />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="match-page__error" role="alert">
      <p className="match-page__error-eyebrow">Match not found</p>
      <h1 className="match-page__error-title">We could not load that match.</h1>
      <p className="match-page__error-body">{message}</p>
      <button type="button" className="match-page__error-retry" onClick={onRetry}>
        Try again
      </button>
      <Link href="/" className="match-page__error-link">
        ← Back to the arena
      </Link>
    </div>
  );
}

function winnerName(winner: "A" | "B" | "DRAW" | null | undefined): string {
  if (winner === "A") return "Ember wins";
  if (winner === "B") return "Vesper wins";
  if (winner === "DRAW") return WINNER_LABEL.DRAW;
  return "No verdict";
}

function winnerTone(winner: "A" | "B" | "DRAW" | null | undefined): "a" | "b" | "draw" | "pending" {
  if (winner === "A") return "a";
  if (winner === "B") return "b";
  if (winner === "DRAW") return "draw";
  return "pending";
}

function formatDuration(totalMs: number): string {
  if (!Number.isFinite(totalMs) || totalMs < 0) return "Duration unavailable";
  const totalSeconds = Math.round(totalMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
