import type { DebateTurn } from "@/entities/debate/types";
import { AGENT_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "@/entities/debate/prompt";
import { RUBRIC_VERSION } from "@/entities/debate/rubric";
import type { MatchRecord } from "@/entities/debate/contract";
import { matchSummary } from "@/features/run-debate/server/export";
import { runJudge } from "@/features/run-debate/server/debate-runner";
import { toSafeErrorMessage } from "@/shared/api/llm/errors";
import { getProvider } from "@/shared/config/provider-store";
import { loadMatchRecord, matchRecordPath, saveMatchRecord } from "@/shared/config/match-store";
import { MATCH_TIMEOUT_MS } from "@/shared/token-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RejudgeRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/**
 * Controlled re-judge: re-runs ONLY the judge pipeline over the stored
 * transcript and overwrites the record with the new verdict. Debater models
 * are never called on this path.
 */
export async function POST(request: Request, context: RejudgeRouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    matchRecordPath(id);
  } catch {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }
  const record = await loadMatchRecord(id);
  if (!record) {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }
  if (record.terminal !== "completed" || record.transcript.length !== 4) {
    return Response.json({ error: "Match cannot be re-judged" }, { status: 409 });
  }
  const judgeRef = record.judge;
  if (!judgeRef) {
    return Response.json({ error: "Match has no judge provider" }, { status: 409 });
  }
  const config = await getProvider(judgeRef.providerId);
  if (!config) {
    return Response.json({ error: "Match has no judge provider" }, { status: 409 });
  }

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(MATCH_TIMEOUT_MS)]);
  let judged: { readonly verdict: MatchRecord["verdict"]; readonly judgeMs: number };
  try {
    judged = await runJudge(
      {
        topic: record.topic,
        turns: record.transcript.map(
          (turn): DebateTurn => ({ ...turn, phase: turn.phase as DebateTurn["phase"] }),
        ),
        providerId: judgeRef.providerId,
        model: judgeRef.model,
        maxOutputTokens: record.policy.judgeMaxOutputTokens,
      },
      { abortSignal: signal },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : toSafeErrorMessage(error);
    return Response.json({ error: message }, { status: 502 });
  }

  const judgedAt = new Date().toISOString();
  const updated: MatchRecord = {
    ...record,
    verdict: judged.verdict,
    judgedAt,
    promptVersions: { agent: AGENT_PROMPT_VERSION, judge: JUDGE_PROMPT_VERSION },
    rubricVersion: RUBRIC_VERSION,
    metrics: { ...record.metrics, judgeMs: judged.judgeMs },
  };
  await saveMatchRecord(updated);
  return Response.json({ ...matchSummary(updated), judgedAt });
}
