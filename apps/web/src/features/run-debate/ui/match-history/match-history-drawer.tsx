"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fetchMatchList, type MatchSummary, MatchesApiError } from "@/shared/api/matches";
import { MatchSummaryRow } from "./match-summary-row";
import { useMatchListDetails } from "./use-match-list-details";

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
  const details = useMatchListDetails(list);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

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

  // Esc closes, focus stays in the drawer, and focus returns to its trigger.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      const restore = restoreFocusRef.current;
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="drawer-shell"
    >
      <button
        type="button"
        aria-label="Close recent matches"
        onClick={onClose}
        className="drawer-shell__backdrop"
      />
      <aside ref={panelRef} className="drawer-shell__panel" tabIndex={-1}>
        <header className="drawer-shell__head">
          <div>
            <p className="drawer-shell__eyebrow">Recent</p>
            <h2 id={titleId} className="drawer-shell__title">Saved matches</h2>
            <p id={descriptionId} className="drawer-shell__sub">
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
                <li key={summary.id}>
                  <MatchSummaryRow
                    summary={summary}
                    record={details.get(summary.id)}
                    className="drawer-shell__row history-match-row"
                  />
                </li>
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
