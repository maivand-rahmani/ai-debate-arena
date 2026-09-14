"use client";

import { useState } from "react";
import type { MatchRecord, MatchSummary } from "@/shared/api/matches";
import { CriteriaView } from "./criteria-view";
import { TranscriptView } from "./transcript-view";
import { formatMatchDate, isRejudged, TERMINAL_LABEL, WINNER_LABEL } from "./format-helpers";
import { MatchActions, exportJsonBlob, type RejudgeStatus } from "./match-actions";

export interface RowCallbacks {
  readonly onLoadDetail: (matchId: string) => Promise<MatchRecord>;
  readonly onRejudge: (matchId: string) => Promise<{ readonly judgedAt: string; readonly winner: MatchSummary["winner"] }>;
}

interface MatchHistoryRowProps {
  readonly summary: MatchSummary;
  readonly callbacks: RowCallbacks;
}

/**
 * One history row: summary in the header, inline expansion for the full
 * transcript + verdict criteria when the user clicks the topic. Loading and
 * re-judge states are scoped to this row so multiple rows can act
 * independently.
 */
export function MatchHistoryRow({ summary, callbacks }: MatchHistoryRowProps) {
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<MatchRecord | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [rejudgeStatus, setRejudgeStatus] = useState<RejudgeStatus>("idle");
  const [rejudgeError, setRejudgeError] = useState<string | undefined>(undefined);
  const [localJudgedAt, setLocalJudgedAt] = useState<string | undefined>(summary.judgedAt);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (record || loadingDetail) return;
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const next = await callbacks.onLoadDetail(summary.id);
      setRecord(next);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not load this match.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRejudge = async () => {
    setRejudgeStatus("flying");
    setRejudgeError(undefined);
    try {
      const { judgedAt } = await callbacks.onRejudge(summary.id);
      setRejudgeStatus("idle");
      setLocalJudgedAt(judgedAt);
      // Refresh the inline detail so criteria + reasoning reflect the new verdict.
      try {
        const next = await callbacks.onLoadDetail(summary.id);
        setRecord(next);
      } catch {
        /* swallow — keep the previously-loaded detail */
      }
    } catch (error) {
      setRejudgeStatus("error");
      setRejudgeError(
        error instanceof Error ? error.message : "Could not re-judge this match.",
      );
    }
  };

  const handleExportJson = async () => {
    // Make sure we have the freshest record, then trigger a local download.
    let snapshot = record;
    if (!snapshot) {
      try {
        snapshot = await callbacks.onLoadDetail(summary.id);
        setRecord(snapshot);
      } catch (error) {
        setRejudgeStatus("error");
        setRejudgeError(error instanceof Error ? error.message : "Could not export this match.");
        return;
      }
    }
    exportJsonBlob(snapshot, summary.id);
  };

  const rejudged = isRejudgedLocal(summary, localJudgedAt);
  const canRejudge = summary.terminal === "completed";

  return (
    <li
      className={`rounded-2xl border transition ${
        open ? "border-white/15 bg-white/[0.04]" : "border-white/[0.08] bg-white/[0.02]"
      }`}
    >
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-controls={`history-row-${summary.id}`}
        className="flex w-full flex-col gap-3 rounded-2xl px-5 py-4 text-left transition hover:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold text-arena-50">
              {summary.topic}
            </span>
            {rejudged ? <RejudgedBadge /> : null}
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-arena-300">
            {formatMatchDate(summary.date)} · {summary.mode === "quick" ? "Quick" : summary.mode} · {TERMINAL_LABEL[summary.terminal]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <WinnerBadge winner={summary.winner} />
          <span aria-hidden="true" className={`font-display text-lg transition ${open ? "text-arena-50" : "text-arena-400"}`}>
            ⌄
          </span>
        </div>
      </button>

      {open ? (
        <div id={`history-row-${summary.id}`} className="border-t border-white/[0.06] px-5 py-5">
          <div className="grid gap-5">
            {loadingDetail ? (
              <p className="text-sm text-arena-300">Loading transcript…</p>
            ) : detailError ? (
              <p role="alert" className="text-sm text-arena-coral-200">
                Could not load this match: {detailError}
              </p>
            ) : record ? (
              <>
                <section>
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
                    Transcript
                  </p>
                  <TranscriptView turns={record.transcript} />
                </section>
                {record.verdict ? <CriteriaView record={record} /> : (
                  <p className="text-sm text-arena-400">No verdict was reached for this match.</p>
                )}
              </>
            ) : null}

            <MatchActions
              matchId={summary.id}
              rejudgeStatus={rejudgeStatus}
              rejudgeError={rejudgeError}
              canRejudge={canRejudge}
              onExportJson={handleExportJson}
              onRejudge={handleRejudge}
            />
          </div>
        </div>
      ) : null}
    </li>
  );
}

function WinnerBadge({ winner }: { winner: MatchSummary["winner"] }) {
  if (winner === "A") {
    return (
      <span className="rounded-full border border-arena-coral-300/40 bg-arena-coral-300/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-arena-coral-100">
        Ember wins
      </span>
    );
  }
  if (winner === "B") {
    return (
      <span className="rounded-full border border-arena-violet-300/40 bg-arena-violet-300/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-arena-violet-100">
        Vesper wins
      </span>
    );
  }
  if (winner === "DRAW") {
    return (
      <span className="rounded-full border border-arena-gold-100/30 bg-arena-gold-100/[0.06] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-arena-gold-100">
        {WINNER_LABEL.DRAW}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-arena-coral-300/30 bg-arena-coral-300/[0.06] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-arena-coral-100">
      Pending
    </span>
  );
}

function RejudgedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-arena-gold-100/30 bg-arena-gold-100/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-arena-gold-100">
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-arena-gold-100" />
      Re-judged
    </span>
  );
}

/** True when this summary carries a `judgedAt` (either server-side or locally after re-judge). */
function isRejudgedLocal(summary: MatchSummary, localJudgedAt: string | undefined): boolean {
  if (localJudgedAt && localJudgedAt !== summary.judgedAt) return true;
  return isRejudged(summary);
}
