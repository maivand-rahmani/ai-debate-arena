"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchMatchList, type MatchSummary, MatchesApiError } from "@/shared/api/matches";
import { formatMatchDate, TERMINAL_LABEL, WINNER_LABEL } from "./format-helpers";

interface MatchHistoryDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * Right-side slide-over that lists saved matches as a launcher for
 * the dedicated `/matches/[id]` page (F4-36). The drawer no longer
 * inlines the transcript / verdict / re-judge actions — those live
 * on the per-match page now so the drawer stays scannable.
 *
 * Esc closes; the close button receives focus on open.
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
        setError(reason instanceof MatchesApiError ? reason.message : "Could not load matches.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Esc closes; auto-focus the close button.
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recent matches"
      className="drawer-shell"
    >
      <button
        type="button"
        aria-label="Close recent matches"
        onClick={onClose}
        className="drawer-shell__backdrop"
      />
      <aside className="drawer-shell__panel" aria-label="Recent matches">
        <header className="drawer-shell__head">
          <div>
            <p className="drawer-shell__eyebrow">Recent</p>
            <h2 className="drawer-shell__title">Saved matches</h2>
            <p className="drawer-shell__sub">
              Pick a match to open the full transcript and verdict on its own page.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="drawer-shell__close"
          >
            Close
          </button>
        </header>

        <div className="drawer-shell__body">
          {status === "loading" ? (
            <p className="drawer-shell__status">Loading matches…</p>
          ) : status === "error" ? (
            <p className="drawer-shell__status" role="alert">
              {error ?? "The matches endpoint is unreachable."}
            </p>
          ) : list.length === 0 ? (
            <p className="drawer-shell__status">
              No saved matches yet. Run a match and it will appear here.
            </p>
          ) : (
            <ul className="drawer-shell__list" aria-label="Saved matches">
              {list.map((summary) => (
                <DrawerRow key={summary.id} summary={summary} />
              ))}
            </ul>
          )}
        </div>

        <footer className="drawer-shell__foot">
          {status === "ready" ? `${list.length} saved` : status === "loading" ? "Loading…" : "—"}
        </footer>
      </aside>
    </div>
  );
}

function DrawerRow({ summary }: { summary: MatchSummary }) {
  return (
    <li>
      <Link
        href={`/matches/${encodeURIComponent(summary.id)}`}
        className="drawer-shell__row"
      >
        <span className="drawer-shell__row-text">
          <span className="drawer-shell__row-topic">{summary.topic}</span>
          <span className="drawer-shell__row-meta">
            {formatMatchDate(summary.date)} · {summary.mode === "quick" ? "Quick" : summary.mode} · {TERMINAL_LABEL[summary.terminal]}
          </span>
        </span>
        <span
          className={`drawer-shell__row-badge drawer-shell__row-badge--${
            summary.winner === "A" ? "a" : summary.winner === "B" ? "b" : "draw"
          }`}
        >
          {summary.winner === null
            ? "Pending"
            : summary.winner === "DRAW"
              ? WINNER_LABEL.DRAW
              : summary.winner === "A"
                ? WINNER_LABEL.A
                : WINNER_LABEL.B}
        </span>
      </Link>
    </li>
  );
}
