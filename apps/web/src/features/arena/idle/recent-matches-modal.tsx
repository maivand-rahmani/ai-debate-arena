"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMatchList, type MatchRecord, type MatchSummary, MatchesApiError } from "@/shared/api/matches";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/shared/ui/modal";
import { MatchSummaryRow } from "@/features/run-debate/ui/match-history/match-summary-row";
import { useMatchListDetails } from "@/features/run-debate/ui/match-history/use-match-list-details";

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
    <Modal open={open} onClose={onClose} panelClassName="modal--narrow">
      <RecentMatchesModalBody onClose={onClose} onOpenMatch={onOpenMatch} />
    </Modal>
  );
}

function RecentMatchesModalBody({ onClose, onOpenMatch }: Omit<RecentMatchesModalProps, "open">) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [list, setList] = useState<readonly MatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const details = useMatchListDetails(list);

  const loadMatches = useCallback(() => {
    const requestId = ++requestRef.current;
    void fetchMatchList()
      .then((matches) => {
        if (requestId !== requestRef.current) return;
        setList(matches);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (requestId !== requestRef.current) return;
        setError(reason instanceof MatchesApiError ? reason.message : "Could not load recent matches.");
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    loadMatches();
    return () => { requestRef.current += 1; };
  }, [loadMatches]);

  const retry = () => {
    setError(null);
    setStatus("loading");
    loadMatches();
  };

  return (
    <>
      <ModalHeader
        eyebrow="Archive"
        title="Recent matches"
        sub="Open a saved match to read its public record, evidence, and closing state."
      />
      <ModalBody>
        {status === "loading" ? (
          <p className="recent-matches__status">Loading recent matches…</p>
        ) : status === "error" ? (
          <div className="recent-matches__error" role="alert">
            <p className="recent-matches__error-title">Could not load recent matches</p>
            <p className="recent-matches__error-body">{error ?? "The matches endpoint is unreachable."}</p>
            <button type="button" className="modal__ghost" onClick={retry}>Try again</button>
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
                record={details.get(summary.id)}
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

function RecentMatchRow({ summary, record, onOpen }: { summary: MatchSummary; record?: MatchRecord; onOpen?: () => void }) {
  return (
    <li>
      <MatchSummaryRow summary={summary} record={record} onOpen={onOpen} className="recent-matches__row history-match-row" />
    </li>
  );
}
