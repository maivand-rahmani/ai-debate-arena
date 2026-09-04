"use client";

import { markdownDownloadUrl } from "@/shared/api/matches";

export type RejudgeStatus = "idle" | "flying" | "error";

interface MatchActionsProps {
  readonly matchId: string;
  readonly rejudgeStatus: RejudgeStatus;
  readonly rejudgeError?: string;
  readonly canRejudge: boolean;
  readonly onExportJson: (matchId: string) => void | Promise<unknown>;
  readonly onRejudge: (matchId: string) => void | Promise<unknown>;
}

/**
 * Per-match action row: Export Markdown (server-attachment link), Export JSON
 * (fetched and saved as a local blob), and Re-judge (POST with disabled state
 * while in flight, inline coral error otherwise).
 *
 * Reused by the history drawer rows and the live judge-panel footer.
 */
export function MatchActions({
  matchId,
  rejudgeStatus,
  rejudgeError,
  canRejudge,
  onExportJson,
  onRejudge,
}: MatchActionsProps) {
  const disabled = rejudgeStatus === "flying";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={markdownDownloadUrl(matchId)}
          download={`match-${matchId}.md`}
          className="ghost-action"
        >
          Export Markdown
        </a>
        <button
          type="button"
          onClick={() => void onExportJson(matchId)}
          disabled={disabled}
          className="ghost-action"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => void onRejudge(matchId)}
          disabled={disabled || !canRejudge}
          title={
            !canRejudge
              ? "This match cannot be re-judged (no saved transcript)."
              : disabled
                ? "Re-judging…"
                : "Re-run the judge on the saved transcript."
          }
          className="coral-action"
        >
          {rejudgeStatus === "flying" ? "Re-judging…" : "Re-judge"}
        </button>
      </div>
      {rejudgeStatus === "error" && rejudgeError ? (
        <p role="alert" className="text-[12px] leading-snug text-arena-coral-200">
          Could not re-judge: {rejudgeError}
        </p>
      ) : null}
    </div>
  );
}

export function exportJsonBlob(json: unknown, matchId: string): void {
  const text = JSON.stringify(json, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `match-${matchId}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Free the object URL on the next tick so the browser can finish downloading.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
