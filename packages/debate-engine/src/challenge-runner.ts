/**
 * Challenge runner (v0.4 bounded post-match challenge slice, F10-11..13).
 *
 * Executes one challenge lifecycle against a completed match record using the
 * injected `callModel` port (the same port the debate runner uses):
 *
 * - Exactly ONE bounded challenged-agent call, then AT MOST ONE bounded judge
 *   call. No retries, no tools, no web, no filesystem, no sandbox.
 * - The agent reply is parsed as strict structured JSON: `answer` (bounded
 *   content + cited allowed evidence ids) or `unable` (explicit reason).
 * - Unparsable agent output, invented evidence ids, provider errors
 *   (timeout/auth/transport), and judge failures all classify as `failed` —
 *   never `unable`. `unable` is only the agent's own explicit admission.
 * - An abort before the response attempt classifies as `expired`.
 * - Evidence reaches the challenged agent and judge only through the shared
 *   untrusted-evidence renderer (user prompts); system prompts never carry
 *   raw evidence.
 */
import type { ChallengeAdjudication, ChallengeAgentResponse, EvidenceBundle, MatchChallenge } from "@arena/types";
import { extractJsonObject } from "./verdict";
import {
  CHALLENGE_LIMITS,
  challengeAgentResponseInputSchema,
  challengeAdjudicationInputSchema,
} from "./challenge-contract";
import {
  CHALLENGE_AGENT_SYSTEM_PROMPT,
  CHALLENGE_JUDGE_SYSTEM_PROMPT,
  buildChallengeAgentPrompt,
  buildChallengeJudgePrompt,
} from "./prompts/challenge-prompt";
import { toSafeErrorMessage } from "./runner";
import type { ModelCallArgs, ModelCallResult } from "./runner";

export type ChallengeCallKind = "challenge-agent" | "challenge-judge";

/** Stable per-conversation session keys for challenge calls. */
export function challengeSessionKey(matchId: string, kind: ChallengeCallKind, requestId: string): string {
  return `${matchId}:${kind}:${requestId}`;
}

export interface ChallengeAgentInput {
  readonly providerId: string;
  readonly model: string;
}

export interface ChallengeJudgeInput {
  readonly providerId: string;
  readonly model: string;
}

export interface RunChallengeInput {
  readonly matchId: string;
  readonly topic: string;
  /** Challenged side (derived server-side from the target turn). */
  readonly side: "A" | "B";
  /** The challenged proposition (exact bounded excerpt). */
  readonly claimText: string;
  /** Full content of the target turn. */
  readonly turnContent: string;
  /** Allowed stored evidence ids the agent may cite. */
  readonly allowedEvidenceIds: readonly string[];
  /** Stored evidence bundle rendered as untrusted data. */
  readonly evidence?: EvidenceBundle;
  readonly agent: ChallengeAgentInput;
  readonly judge?: ChallengeJudgeInput;
  /** Client idempotency key (already validated; used in session keys). */
  readonly requestId: string;
}

export interface RunChallengeDeps {
  readonly callModel: (args: ModelCallArgs) => Promise<ModelCallResult>;
  readonly abortSignal?: AbortSignal;
  /**
   * Persisted-state hook: invoked before the challenged-agent call
   * (`"responding"`) and before the judge call (`"adjudicating"`) so the
   * caller can persist each lifecycle transition. Errors propagate and
   * abort the challenge before the next model call.
   */
  readonly onPhase?: (phase: "responding" | "adjudicating") => void | Promise<void>;
}

/**
 * Internal re-check: is the challenge still active, or did an abort land
 * while we were persisting a phase? Returns the terminal outcome to use, or
 * `undefined` when the challenge should proceed.
 */
function abortOutcomeIfAborted(
  signal: AbortSignal | undefined,
  phase: "responding" | "adjudicating",
): RunChallengeOutcome | undefined {
  if (signal?.aborted) {
    // Hardening (P1-10): an abort detected after phase persistence, before
    // the agent call, is `expired` (no response attempt was made); an abort
    // after a response attempt is `failed`.
    return phase === "responding" ? { outcome: "expired" } : { outcome: "failed", reason: "Challenge aborted before adjudication" };
  }
  return undefined;
}

export type RunChallengeOutcome =
  | {
      readonly outcome: "resolved";
      readonly response: ChallengeAgentResponse;
      readonly adjudication: ChallengeAdjudication;
    }
  | { readonly outcome: "unable"; readonly response: ChallengeAgentResponse }
  | { readonly outcome: "expired" }
  | { readonly outcome: "failed"; readonly reason: string };

/** Parse + validate the agent's structured reply; `undefined` = malformed. */
function parseAgentResponse(
  text: string,
  model: string,
  allowedEvidenceIds: readonly string[],
): ChallengeAgentResponse | undefined {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(text));
  } catch {
    return undefined;
  }
  const parsed = challengeAgentResponseInputSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const response = parsed.data;
  const now = new Date().toISOString();
  if (response.kind === "answer") {
    // The agent must not invent evidence ids: any cited id outside the
    // allowed set makes the whole reply malformed.
    const allowed = new Set(allowedEvidenceIds);
    if (!response.citedEvidenceIds.every((id) => allowed.has(id))) return undefined;
    // Hardening (P1-6): an answer must cite at least one allowed evidence
    // id; an answer with none is malformed (failed), not accepted.
    if (response.citedEvidenceIds.length === 0) return undefined;
    return { ...response, model, createdAt: now };
  }
  return { ...response, model, createdAt: now };
}

/** Parse + validate the judge's structured adjudication; `undefined` = malformed. */
function parseAdjudication(
  text: string,
  judgeModel: string,
  allowedEvidenceIds: readonly string[],
): ChallengeAdjudication | undefined {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(text));
  } catch {
    return undefined;
  }
  const parsed = challengeAdjudicationInputSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const adjudication = parsed.data;
  const allowed = new Set(allowedEvidenceIds);
  if (!adjudication.evidenceAssessments.every((entry) => allowed.has(entry.evidenceId))) {
    return undefined;
  }
  return {
    ...adjudication,
    method: "judge_model",
    judgeModel,
    createdAt: new Date().toISOString(),
  };
}

function safeFailure(error: unknown): string {
  const message = toSafeErrorMessage(error);
  return message.slice(0, 300) || "Challenge failed";
}

/**
 * Run one bounded challenge lifecycle. Throws only on programmer error
 * (missing deps); all provider/model outcomes are returned as outcomes so
 * the caller can persist them without try/catch ambiguity.
 */
export async function runChallenge(
  input: RunChallengeInput,
  deps: RunChallengeDeps,
): Promise<RunChallengeOutcome> {
  const { callModel } = deps;

  // Expired: aborted before the response attempt even started.
  if (deps.abortSignal?.aborted) {
    return { outcome: "expired" };
  }
  await deps.onPhase?.("responding");
  // Hardening (P1-10): re-check abort AFTER phase persistence — an abort
  // that lands during the save is `expired`, not `failed`.
  const preAgentAbort = abortOutcomeIfAborted(deps.abortSignal, "responding");
  if (preAgentAbort) return preAgentAbort;

  // --- Exactly one bounded challenged-agent call -------------------------
  const agentPrompt = buildChallengeAgentPrompt({
    topic: input.topic,
    claimText: input.claimText,
    turnContent: input.turnContent,
    side: input.side,
    allowedEvidenceIds: input.allowedEvidenceIds,
    evidence: input.evidence,
  });
  let agentText: string;
  try {
    const result = await callModel({
      kind: "agent",
      providerId: input.agent.providerId,
      modelId: input.agent.model,
      system: CHALLENGE_AGENT_SYSTEM_PROMPT,
      prompt: agentPrompt,
      maxOutputTokens: CHALLENGE_LIMITS.agentMaxOutputTokens,
      abortSignal: deps.abortSignal,
      sessionKey: challengeSessionKey(input.matchId, "challenge-agent", input.requestId),
      // P1-8: exactly one provider request — no streaming/structured fallback.
      singleAttempt: true,
    });
    agentText = result.text;
  } catch (error) {
    // Provider timeout/auth/transport failure is `failed`, never `unable`.
    return { outcome: "failed", reason: safeFailure(error) };
  }

  const response = parseAgentResponse(agentText, input.agent.model, input.allowedEvidenceIds);
  if (response === undefined) {
    // Malformed agent output is a failure, never `unable`.
    return { outcome: "failed", reason: "Challenged agent returned a malformed response" };
  }
  if (response.kind === "unable") {
    return { outcome: "unable", response };
  }

  // --- At most one bounded judge call ------------------------------------
  const judge = input.judge;
  if (!judge) {
    return { outcome: "failed", reason: "Match has no judge provider for adjudication" };
  }
  if (deps.abortSignal?.aborted) {
    return { outcome: "failed", reason: "Challenge aborted before adjudication" };
  }
  await deps.onPhase?.("adjudicating");
  const preJudgeAbort = abortOutcomeIfAborted(deps.abortSignal, "adjudicating");
  if (preJudgeAbort) return preJudgeAbort;
  const judgePrompt = buildChallengeJudgePrompt({
    topic: input.topic,
    claimText: input.claimText,
    turnContent: input.turnContent,
    response,
    allowedEvidenceIds: input.allowedEvidenceIds,
    evidence: input.evidence,
  });
  let judgeText: string;
  try {
    const result = await callModel({
      kind: "agent",
      providerId: judge.providerId,
      modelId: judge.model,
      system: CHALLENGE_JUDGE_SYSTEM_PROMPT,
      prompt: judgePrompt,
      maxOutputTokens: CHALLENGE_LIMITS.judgeMaxOutputTokens,
      abortSignal: deps.abortSignal,
      sessionKey: challengeSessionKey(input.matchId, "challenge-judge", input.requestId),
      // P1-8: exactly one provider request — no streaming/structured fallback.
      singleAttempt: true,
    });
    judgeText = result.text;
  } catch (error) {
    return { outcome: "failed", reason: safeFailure(error) };
  }

  const adjudication = parseAdjudication(judgeText, judge.model, input.allowedEvidenceIds);
  if (adjudication === undefined) {
    return { outcome: "failed", reason: "Challenge judge returned a malformed adjudication" };
  }
  return { outcome: "resolved", response, adjudication };
}

/**
 * Build the persisted `MatchChallenge` patch fields for an outcome. Pure:
 * no I/O, no model calls.
 */
export function challengeOutcomeFields(
  challenge: MatchChallenge,
  outcome: RunChallengeOutcome,
  now: string,
): Pick<MatchChallenge, "status" | "response" | "adjudication" | "failureReason" | "updatedAt"> {
  switch (outcome.outcome) {
    case "resolved":
      return {
        status: "resolved",
        response: outcome.response,
        adjudication: outcome.adjudication,
        failureReason: undefined,
        updatedAt: now,
      };
    case "unable":
      return {
        status: "unable",
        response: outcome.response,
        adjudication: undefined,
        failureReason: undefined,
        updatedAt: now,
      };
    case "expired":
      return {
        status: "expired",
        response: undefined,
        adjudication: undefined,
        failureReason: "Challenge expired before a response attempt",
        updatedAt: now,
      };
    case "failed":
      return {
        status: "failed",
        response: undefined,
        adjudication: undefined,
        failureReason: outcome.reason,
        updatedAt: now,
      };
  }
}
