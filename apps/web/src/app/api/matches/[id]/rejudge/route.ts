import {
  AGENT_PROMPT_VERSION,
  JUDGE_PROMPT_VERSION,
  MATCH_TIMEOUT_MS,
  RUBRIC_VERSION,
  type DebateTurn,
  type MatchRecord,
} from "@arena/debate-engine";
import { matchSummary } from "@/features/run-debate/server/export";
import { runJudge, type ModelUsage, sessionKeyForMatchSlot } from "@arena/debate-engine";
import { webCallModel } from "@/features/run-debate/server/web-adapter";
import { toSafeErrorMessage } from "@arena/ai";
import { getProvider } from "@/shared/config/provider-store";
import { loadMatchRecord, matchRecordPath, saveMatchRecord } from "@/shared/config/match-store";
import { withRecordLock } from "@/shared/config/record-lock";

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

  // Keep the whole re-judge read-modify-write under one per-record lock so
  // concurrent re-judge requests cannot interleave and lose updates.
  try {
    return await withRecordLock(matchRecordPath(id), async () => {
      return await rejudgeLocked(request, id);
    });
  } catch (error) {
    if (error instanceof Error && /Another operation is in progress/.test(error.message)) {
      return Response.json({ error: "Another match operation is in progress" }, { status: 409 });
    }
    throw error;
  }
}

async function rejudgeLocked(request: Request, id: string): Promise<Response> {
  const record = await loadMatchRecord(id);
  if (!record) {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }
  if (record.terminal !== "completed" || record.transcript.length !== record.policy.rounds) {
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
  let judged: { readonly verdict: MatchRecord["verdict"]; readonly judgeMs: number; readonly usage: ModelUsage };
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
      { callModel: webCallModel, abortSignal: signal, sessionKey: sessionKeyForMatchSlot(id, "judge") },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : toSafeErrorMessage(error);
    return Response.json({ error: message }, { status: 502 });
  }

  const judgedAt = new Date().toISOString();
  const priorUsage = record.metrics.usage ?? { promptTokens: 0, completionTokens: 0 };
  const updated: MatchRecord = {
    ...record,
    verdict: judged.verdict,
    judgedAt,
    promptVersions: { agent: AGENT_PROMPT_VERSION, judge: JUDGE_PROMPT_VERSION },
    rubricVersion: RUBRIC_VERSION,
    metrics: {
      ...record.metrics,
      judgeMs: judged.judgeMs,
      usage: {
        promptTokens: priorUsage.promptTokens + judged.usage.promptTokens,
        completionTokens: priorUsage.completionTokens + judged.usage.completionTokens,
      },
    },
  };
  await saveMatchRecord(updated);
  return Response.json({ ...matchSummary(updated), judgedAt });
}
