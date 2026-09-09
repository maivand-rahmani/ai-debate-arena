"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchMatch,
  rejudgeMatch,
  MatchesApiError,
  type MatchRecord,
} from "@/shared/api/matches";
import { exportJsonBlob, MatchActions, type RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";
import { CriteriaView } from "@/features/run-debate/ui/match-history/criteria-view";
import { formatMatchDate, TERMINAL_LABEL, WINNER_LABEL } from "@/features/run-debate/ui/match-history/format-helpers";
import { TranscriptThread } from "@/features/arena/match/transcript-thread";

interface MatchPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

/**
 * Per-match page: full transcript chat-thread + verdict card with
 * criteria/scores + export + re-judge actions. The page is a focused
 * reading surface (no 3D canvas, no live arena) sitting on a dark
 * blurred backdrop.
 */
export default function MatchPage({ params }: MatchPageProps) {
  const { id } = use(params);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [record, setRecord] = useState<MatchRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rejudgeStatus, setRejudgeStatus] = useState<RejudgeStatus>("idle");
  const [rejudgeError, setRejudgeError] = useState<string | undefined>(undefined);

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
  }, [id]);

  const handleExportJson = useCallback(() => {
    if (!record) return;
    exportJsonBlob(record, record.matchId);
  }, [record]);

  const handleRejudge = useCallback(async () => {
    setRejudgeStatus("flying");
    setRejudgeError(undefined);
    try {
      await rejudgeMatch(id);
      const next = await fetchMatch(id);
      setRecord(next);
      setRejudgeStatus("idle");
    } catch (reason) {
      setRejudgeStatus("error");
      setRejudgeError(
        reason instanceof Error ? reason.message : "Could not re-judge this match.",
      );
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
          <ErrorState message={errorMessage ?? "The match could not be loaded."} />
        ) : (
          <MatchBody
            record={record}
            rejudgeStatus={rejudgeStatus}
            rejudgeError={rejudgeError}
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
  onExportJson,
  onRejudge,
}: {
  readonly record: MatchRecord;
  readonly rejudgeStatus: RejudgeStatus;
  readonly rejudgeError: string | undefined;
  readonly onExportJson: () => void;
  readonly onRejudge: () => void;
}) {
  const canRejudge = record.terminal === "completed";
  return (
    <>
      <header className="match-page__head">
        <p className="match-page__eyebrow">
          {record.mode === "quick" ? "Quick" : record.mode} · {TERMINAL_LABEL[record.terminal]}
          {record.judgedAt ? " · Re-judged" : ""}
        </p>
        <h1 className="match-page__topic">{record.topic}</h1>
        <p className="match-page__meta">
          {formatMatchDate(record.startedAt)} → {formatMatchDate(record.finishedAt)}
        </p>
        {record.verdict ? (
          <p className="match-page__winner">
            <span
              className={`match-page__winner-badge match-page__winner-badge--${
                record.verdict.winner === "A"
                  ? "a"
                  : record.verdict.winner === "B"
                    ? "b"
                    : "draw"
              }`}
            >
              {record.verdict.winner === null
                ? "Pending"
                : record.verdict.winner === "DRAW"
                  ? WINNER_LABEL.DRAW
                  : record.verdict.winner === "A"
                    ? WINNER_LABEL.A
                    : WINNER_LABEL.B}
            </span>
            <span>
              {record.verdict.scoreA} · {record.verdict.scoreB}
            </span>
          </p>
        ) : null}
      </header>

      <section className="match-page__section" aria-labelledby="match-transcript">
        <h2 id="match-transcript" className="match-page__section-title">
          Transcript
        </h2>
        <TranscriptThread turns={record.transcript} />
      </section>

      {record.verdict ? (
        <section className="match-page__section" aria-labelledby="match-verdict">
          <h2 id="match-verdict" className="match-page__section-title">
            Verdict
          </h2>
          <CriteriaView record={record} />
        </section>
      ) : (
        <section className="match-page__section">
          <p className="match-page__status">
            No verdict was reached for this match.
            {record.terminalReason ? ` (${record.terminalReason})` : ""}
          </p>
        </section>
      )}

      <section className="match-page__section match-page__section--actions">
        <h2 className="match-page__section-title">Save &amp; inspect</h2>
        <MatchActions
          matchId={record.matchId}
          rejudgeStatus={rejudgeStatus}
          rejudgeError={rejudgeError}
          canRejudge={canRejudge}
          onExportJson={() => onExportJson()}
          onRejudge={() => void onRejudge()}
        />
      </section>
    </>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="match-page__error" role="alert">
      <p className="match-page__error-eyebrow">Match not found</p>
      <h1 className="match-page__error-title">We could not load that match.</h1>
      <p className="match-page__error-body">{message}</p>
      <Link href="/" className="match-page__error-link">
        ← Back to the arena
      </Link>
    </div>
  );
}
