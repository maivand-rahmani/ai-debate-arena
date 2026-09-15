import type { MatchRecord, RejudgeSuccess } from "@/shared/api/matches";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";

export interface LiveRejudgeDeps {
  /** POSTs the re-judge request and resolves with the fresh summary. */
  readonly rejudge: (matchId: string) => Promise<RejudgeSuccess>;
  /** Re-fetches the match so the live verdict reflects the new judgement. */
  readonly refresh: (matchId: string) => Promise<MatchRecord>;
  /** Publishes the refreshed verdict to the live stream reducer. */
  readonly onVerdict: (verdict: DebateStreamVerdict, judgedAt: string) => void;
  /** Re-judge succeeded but the refreshed record could not be loaded. */
  readonly onRefreshFailure: (error: unknown) => void;
  /** Re-judge itself failed. Must surface the error without rejecting. */
  readonly onFailure: (error: unknown) => void;
}

export type LiveRejudgeResult =
  | {
      readonly ok: true;
      readonly judgedAt: string;
      readonly winner: RejudgeSuccess["summary"]["winner"];
      readonly refreshed: boolean;
    }
  | { readonly ok: false };

/**
 * Runs the live footer's re-judge flow. The caller is fire-and-forget
 * (`void onRejudge(...)`), so this never rejects: a failed re-judge is
 * reported through `onFailure` and resolves with `{ ok: false }`. A failed
 * refresh is reported through `onRefreshFailure` while still returning the
 * new judgement metadata.
 */
export async function performLiveRejudge(
  matchId: string,
  deps: LiveRejudgeDeps,
): Promise<LiveRejudgeResult> {
  let result: RejudgeSuccess;
  try {
    result = await deps.rejudge(matchId);
  } catch (error) {
    deps.onFailure(error);
    return { ok: false };
  }

  let record: MatchRecord;
  try {
    record = await deps.refresh(matchId);
  } catch (error) {
    deps.onRefreshFailure(error);
    return { ok: true, judgedAt: result.judgedAt, winner: result.summary.winner, refreshed: false };
  }

  if (record.verdict) {
    deps.onVerdict(record.verdict, result.judgedAt);
  }
  return { ok: true, judgedAt: result.judgedAt, winner: result.summary.winner, refreshed: true };
}
