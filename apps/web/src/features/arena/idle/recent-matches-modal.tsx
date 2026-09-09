"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchMatchList, type MatchSummary, MatchesApiError } from "@/shared/api/matches";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/shared/ui/modal";
import { formatMatchDate, TERMINAL_LABEL, WINNER_LABEL } from "@/features/run-debate/ui/match-history/format-helpers";

interface RecentMatchesModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onOpenMatch?: (matchId: string) => void;
}

/**
 * Recent-matches dialog opened from the idle hero. Same modal shell
 * as ManageProvidersModal + SetupModal. Lists the saved matches
 * from `/api/matches` and links each one to its dedicated
 * `/matches/[id]` page. The full transcript / verdict detail lives
 * on that page now (F4-36); the modal stays as a quick launcher.
 */
export function RecentMatchesModal({ open, onClose, onOpenMatch }: RecentMatchesModalProps) {
  return (
    <Modal open={open} onClose={onClose} panelClassName="modal--narrow" ariaLabel="Recent matches">
      <RecentMatchesModalBody onClose={onClose} onOpenMatch={onOpenMatch} />
    </Modal>
  );
}

function RecentMatchesModalBody({ onClose, onOpenMatch }: Omit<RecentMatchesModalProps, "open">) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [list, setList] = useState<readonly MatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        setError(reason instanceof MatchesApiError ? reason.message : "Could not load recent matches.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <ModalHeader
        eyebrow="Archive"
        title="Recent matches"
        sub="Every completed, errored, or cancelled match is saved with a full transcript and verdict."
      />
      <ModalBody>
        {status === "loading" ? (
          <p className="recent-matches__status">Loading recent matches…</p>
        ) : status === "error" ? (
          <div className="recent-matches__error" role="alert">
            <p className="recent-matches__error-title">Could not load recent matches</p>
            <p className="recent-matches__error-body">{error ?? "The matches endpoint is unreachable."}</p>
          </div>
        ) : list.length === 0 ? (
          <p className="recent-matches__status">
            No saved matches yet. Run a match and it will appear here.
          </p>
        ) : (
          <ul className="recent-matches__list" aria-label="Recent matches">
            {list.map((summary) => (
              <RecentMatchRow
                key={summary.id}
                summary={summary}
                onOpen={onOpenMatch ? () => onOpenMatch(summary.id) : undefined}
              />
            ))}
          </ul>
        )}
      </ModalBody>
      <ModalFooter>
        <span />
        <button type="button" onClick={onClose} className="modal__ghost">
          Close
        </button>
      </ModalFooter>
    </>
  );
}

function RecentMatchRow({ summary, onOpen }: { summary: MatchSummary; onOpen?: () => void }) {
  const href = `/matches/${encodeURIComponent(summary.id)}`;
  return (
    <li>
      <Link
        href={href}
        onClick={(event) => {
          if (onOpen) {
            event.preventDefault();
            onOpen();
          }
        }}
        className="recent-matches__row"
      >
        <span className="recent-matches__row-text">
          <span className="recent-matches__row-topic">{summary.topic}</span>
          <span className="recent-matches__row-meta">
            {formatMatchDate(summary.date)} · {summary.mode === "quick" ? "Quick" : summary.mode} · {TERMINAL_LABEL[summary.terminal]}
          </span>
        </span>
        <span
          className={`recent-matches__row-badge recent-matches__row-badge--${
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
