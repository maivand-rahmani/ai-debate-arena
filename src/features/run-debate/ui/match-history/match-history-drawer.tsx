"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMatch,
  fetchMatchList,
  rejudgeMatch,
  type MatchRecord,
  type MatchSummary,
  MatchesApiError,
} from "@/shared/api/matches";
import { MatchHistoryRow } from "./match-history-row";

interface MatchHistoryDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * Right-side slide-over that lists saved matches, fetches the full record on
 * row expansion, and exposes Export / Re-judge per row. Esc closes; the close
 * button is auto-focused on open so keyboard users land somewhere sensible.
 *
 * The drawer is a pure client component — it owns its loading + error states
 * and does not touch the live arena state. When `open` is false the component
 * unmounts entirely so reopening it resets to a fresh fetch.
 */
export function MatchHistoryDrawer({ open, onClose }: MatchHistoryDrawerProps) {
  if (!open) return null;
  return <MatchHistoryDrawerBody onClose={onClose} />;
}

function MatchHistoryDrawerBody({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [list, setList] = useState<readonly MatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Fetch the list once when the body mounts.
  useEffect(() => {
    let cancelled = false;
    fetchMatchList()
      .then((matches) => {
        if (cancelled) return;
        setList(matches);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(toMessage(reason));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Esc closes the drawer; auto-focus the close button on mount.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    closeButtonRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleLoadDetail = useCallback(async (matchId: string) => {
    return fetchMatch(matchId);
  }, []);

  const handleRejudge = useCallback(
    async (matchId: string) => {
      const result = await rejudgeMatch(matchId);
      // Patch the in-memory list so the row reflects the new winner/judgedAt
      // without waiting for a full reload.
      setList((current) =>
        current.map((entry) =>
          entry.id === matchId
            ? { ...entry, winner: result.summary.winner, judgedAt: result.judgedAt }
            : entry,
        ),
      );
      return { judgedAt: result.judgedAt, winner: result.summary.winner };
    },
    [],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Saved matches"
      className="fixed inset-0 z-40 flex justify-end"
    >
      <button
        type="button"
        aria-label="Close matches drawer"
        onClick={onClose}
        className="drawer-backdrop absolute inset-0 bg-arena-900/70 backdrop-blur-sm"
      />
      <aside className="drawer-panel relative flex h-full w-full max-w-[520px] flex-col border-l border-white/[0.08] bg-arena-800 shadow-2xl sm:max-w-[560px]">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-6 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
              Match history
            </p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-arena-50">
              Saved matches
            </h2>
            <p className="mt-2 text-sm text-arena-300">
              Every completed, errored or cancelled match is stored locally.
              Open one to inspect the transcript, re-run the judge, or export
              the record.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-arena-200 transition hover:border-white/25 hover:text-arena-50"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {status === "loading" ? (
            <p className="text-sm text-arena-300">Loading matches…</p>
          ) : status === "error" ? (
            <EmptyState
              title="Could not load matches"
              body={error ?? "The matches endpoint is unreachable."}
            />
          ) : status === "ready" && list.length === 0 ? (
            <EmptyState
              title="No saved matches yet"
              body="Run a match and it will appear here automatically."
            />
          ) : (
            <ul className="grid gap-3" aria-label="Saved matches">
              {list.map((summary) => (
                <MatchHistoryRow
                  key={summary.id}
                  summary={summary}
                  callbacks={{ onLoadDetail: handleLoadDetail, onRejudge: handleRejudge }}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-white/[0.06] px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-arena-400">
          {status === "ready" ? `${list.length} saved` : status === "loading" ? "Loading…" : "—"}
        </footer>
      </aside>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
        {title}
      </p>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-arena-300">{body}</p>
    </div>
  );
}

function toMessage(reason: unknown): string {
  if (reason instanceof MatchesApiError) return reason.message;
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "Could not load matches.";
}

/** Helper exported so the live arena can reuse the same fetchers for the live re-judge. */
export async function loadMatchDetail(matchId: string): Promise<MatchRecord> {
  return fetchMatch(matchId);
}
