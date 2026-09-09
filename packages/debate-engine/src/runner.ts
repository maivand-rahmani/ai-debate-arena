import { randomUUID } from "node:crypto";
import {
  AGENT_PROMPT_VERSION,
  buildDebatePrompt,
  buildPromptContext,
  JUDGE_PROMPT_VERSION,
} from "./prompt";
import { buildAgentSystemPrompt, buildJudgePrompt, JUDGE_SYSTEM_PROMPT } from "./prompts";
import { appendTurn, attachVerdict, createDebateState } from "./state";
import {
  DebatePhase,
  type DebateConfig,
  type DebatePosition,
  type DebateSide,
  type DebateState,
  type DebateTurn,
  type DebateVerdict,
} from "./types";
import { isDegenerateVerdict, normalizeVerdictWinner, parseDebateVerdict } from "./verdict";
import { MATCH_PROFILES, type MatchProfile } from "./token-policy";
import { RUBRIC_VERSION, type RubricVersion } from "./rubric";
import {
  CONTRACT_VERSION,
  type MatchMode,
  type MatchRecord,
  type MatchTerminal,
} from "./contract";
import type {
  DebateStreamEvent,
  DebateStreamEventBody,
  DebateStreamTerminal,
  DebateStreamTurn,
  DebateStreamVerdict,
} from "@arena/types";

/**
 * Canonical stream wire types (see `@arena/types`). The inline event body
 * shapes that used to live in the web `debate-runner.ts` were verified
 * byte-equivalent to these canonical shapes, so the runner now uses them
 * directly. The `DebateStreamEvent` / `DebateStreamTurn` alias names are
 * re-exported here so existing importers keep working unchanged.
 */
export type {
  DebateStreamEvent,
  DebateStreamEventBody,
  DebateStreamTerminal,
  DebateStreamTurn,
  DebateStreamVerdict,
};

/**
 * Verbatim mirror of the error-normalization helpers in `@arena/ai`
 * (`packages/ai/src/errors.ts`).
 *
 * The engine keeps zero SDK/Next dependencies, so the normalization lives
 * here as a copy instead of an import. User-facing error texts are part of
 * the v0.3 freeze: keep this block identical to `@arena/ai` errors.ts.
 */
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT"]);
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EPIPE",
]);

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readText(err: unknown): string {
  if (typeof err === "string") return err;
  const record = readRecord(err);
  if (!record) return "";
  const parts: string[] = [];
  if (typeof record["name"] === "string") parts.push(record["name"]);
  if (typeof record["message"] === "string") parts.push(record["message"]);
  const causeText = readText(record["cause"]);
  if (causeText) parts.push(causeText);
  return parts.join(": ");
}

function readCode(err: unknown): string {
  const record = readRecord(err);
  const code = record?.["code"] ?? readRecord(record?.["cause"])?.["code"];
  return typeof code === "string" ? code.toUpperCase() : "";
}

function readStatus(err: unknown): number | undefined {
  const records = [readRecord(err), readRecord(readRecord(err)?.["cause"])].filter(
    (record): record is Record<string, unknown> => record !== undefined,
  );
  for (const record of records) {
    for (const key of ["status", "statusCode"]) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    const status = readRecord(record["response"])?.["status"];
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return undefined;
}

function sanitizeErrorText(text: string): string {
  return text
    .replace(/(\w+:\/\/[^/\s:]+:)[^/\s@]+@/g, "$1<redacted>@")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "<redacted-key>")
    .replace(/((?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?)[^"'\s&;,]+/gi, "$1<redacted>")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1<redacted>");
}

function toSafeErrorMessage(err: unknown): string {
  const status = readStatus(err);
  const text = readText(err);
  const code = readCode(err);
  const name = readRecord(err)?.["name"];

  if (status === 401 || status === 403 || /unauthorized|\bforbidden\b|invalid api key|incorrect api key/i.test(text)) {
    return "Provider authentication failed. Check the configured API key.";
  }
  if (status === 429 || /rate limit|too many requests/i.test(text)) {
    return "Provider rate limit exceeded. Please wait and try again.";
  }
  if (
    TIMEOUT_CODES.has(code) ||
    name === "AbortError" ||
    /timed out|\btimeout\b|\babort/i.test(text)
  ) {
    return "Provider request timed out. Please try again.";
  }
  if (
    UNREACHABLE_CODES.has(code) ||
    /fetch failed|failed to fetch|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|network unreachable|connection refused|unable to connect/i.test(
      text,
    )
  ) {
    return "Provider is unreachable. Check the base URL and network connection.";
  }
  if (status !== undefined) {
    return `Provider request failed (status ${status}).`;
  }
  const clean = sanitizeErrorText(text).slice(0, 200).trim();
  return clean || "Model request failed.";
}

export interface RunnerAgentInput {
  readonly providerId: string;
  readonly model: string;
  readonly position: DebatePosition;
}

export interface RunDebateInput {
  readonly topic: string;
  readonly mode: MatchMode;
  readonly agentA: RunnerAgentInput;
  readonly agentB: RunnerAgentInput;
  readonly judge?: { readonly providerId: string; readonly model: string };
}

export interface RunnerSideInput {
  readonly providerName: string;
  readonly modelId: string;
  readonly position: DebatePosition;
}

export interface ModelCallArgs {
  readonly kind: "agent" | "judge";
  readonly providerId: string;
  readonly modelId: string;
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  readonly abortSignal?: AbortSignal;
  /**
   * Stable per-conversation session key for providers that require one
   * (OpenCode gateway). The engine always sets this: `<matchId>:agent-a`,
   * `<matchId>:agent-b`, or `<matchId>:judge`. Retries and re-judges of the
   * same stored match reuse the same key; different matches/slots differ.
   */
  readonly sessionKey?: string;
}

/**
 * Model-construction slot identities for one debate match. These suffixes
 * form the OpenCode per-conversation session keys (`<matchId>:<slot>`).
 */
export type DebateSlot = "agent-a" | "agent-b" | "judge";

/**
 * Pure derivation of the stable per-conversation session key for a match
 * slot. Same match+slot always yields the same key; different matches or
 * slots always differ. No network, no globals.
 */
export function sessionKeyForMatchSlot(matchId: string, slot: DebateSlot): string {
  return `${matchId}:${slot}`;
}

/** Token usage for one model call, normalized to plain counters. */
export interface ModelUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface ModelCallResult {
  readonly text: string;
  readonly chunks: readonly string[];
  readonly usage?: ModelUsage;
}

const ZERO_USAGE: ModelUsage = { promptTokens: 0, completionTokens: 0 };

function toNonNegativeInt(value: unknown): number {
  const nested = typeof value === "object" && value !== null
    ? (value as Record<string, unknown>).total
    : value;
  return typeof nested === "number" && Number.isFinite(nested) && nested > 0 ? Math.floor(nested) : 0;
}

/**
 * Normalize provider/SDK usage shapes (`{promptTokens,…}`, `{inputTokens,…}`,
 * possibly nested under `total`). Missing or malformed usage counts as 0 and
 * never throws.
 */
export function toModelUsage(raw: unknown): ModelUsage {
  try {
    if (typeof raw !== "object" || raw === null) return ZERO_USAGE;
    const record = raw as Record<string, unknown>;
    return {
      promptTokens: toNonNegativeInt(record.promptTokens ?? record.inputTokens),
      completionTokens: toNonNegativeInt(record.completionTokens ?? record.outputTokens),
    };
  } catch {
    return ZERO_USAGE;
  }
}

function addUsage(into: { promptTokens: number; completionTokens: number }, usage: ModelUsage | undefined): void {
  if (!usage) return;
  into.promptTokens += usage.promptTokens;
  into.completionTokens += usage.completionTokens;
}

export interface RunDebateDeps {
  readonly callModel?: (args: ModelCallArgs) => Promise<ModelCallResult>;
  readonly abortSignal?: AbortSignal;
  readonly matchId?: string;
  readonly profile?: MatchProfile;
  readonly sides?: { readonly A: RunnerSideInput; readonly B: RunnerSideInput };
  readonly saveMatch?: (record: MatchRecord) => Promise<void> | void;
}

const AGENT_PHASES: ReadonlyArray<{ readonly phase: DebateTurn["phase"]; readonly side: DebateSide }> = [
  { phase: DebatePhase.OPENING_A, side: "A" },
  { phase: DebatePhase.OPENING_B, side: "B" },
  { phase: DebatePhase.REBUTTAL_A, side: "A" },
  { phase: DebatePhase.REBUTTAL_B, side: "B" },
];

export interface RunJudgeInput {
  readonly topic: string;
  readonly turns: readonly DebateTurn[];
  readonly providerId: string;
  readonly model: string;
  readonly maxOutputTokens?: number;
  /** Rubric generation for the judge prompt. Defaults to `"1"` (legacy prompt). */
  readonly rubricVersion?: RubricVersion;
}

export interface RunJudgeDeps {
  readonly callModel?: (args: ModelCallArgs) => Promise<ModelCallResult>;
  readonly abortSignal?: AbortSignal;
  /**
   * Stable session key for the judge conversation
   * (`sessionKeyForMatchSlot(matchId, "judge")`). Re-judges of the same
   * stored match must pass the same key as the original run.
   */
  readonly sessionKey?: string;
}

export interface RunJudgeResult {
  readonly verdict: DebateVerdict;
  readonly judgeMs: number;
  readonly usage: ModelUsage;
}

/**
 * Runs only the judge pipeline for a finished transcript: builds the judge
 * prompt, calls the model, and applies the parse/normalize/single-retry
 * pipeline shared with {@link runDebate}. Throws an `Error` whose message is
 * the final user-facing failure (safe provider message or the fixed
 * invalid-verdict message).
 */
export async function runJudge(input: RunJudgeInput, deps: RunJudgeDeps = {}): Promise<RunJudgeResult> {
  const callModel = deps.callModel;
  if (!callModel) throw new Error("callModel is required");
  const maxOutputTokens = input.maxOutputTokens ?? MATCH_PROFILES.quick.judgeMaxOutputTokens;
  const startMs = Date.now();
  const judgePrompt = buildJudgePrompt(input.topic, input.turns, { rubricVersion: input.rubricVersion });
  const hasTurns = input.turns.length > 0;
  const total: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
  const callJudge = async (prompt: string): Promise<string> => {
    const result = await callModel({
      kind: "judge",
      providerId: input.providerId,
      modelId: input.model,
      system: JUDGE_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens,
      abortSignal: deps.abortSignal,
      sessionKey: deps.sessionKey,
    });
    addUsage(total, result.usage);
    return result.text;
  };

  let judgeText: string;
  try {
    judgeText = await callJudge(judgePrompt);
  } catch (error) {
    throw new Error(toSafeErrorMessage(error));
  }

  const parsed = parseDebateVerdict(judgeText);
  let verdict = parsed.success ? normalizeVerdictWinner(parsed.data) : null;
  if (parsed.success && verdict !== null && !isDegenerateVerdict(verdict, hasTurns)) {
    return { verdict, judgeMs: Date.now() - startMs, usage: { ...total } };
  }
  // Single retry: previous output was unparsable or degenerate zeros.
  const retryPrompt =
    `${judgePrompt}\n\nPrevious output was invalid (unparsable, or a degenerate DRAW with scores of 0 ` +
    `despite a non-empty transcript). Respond with ONLY the corrected JSON object matching the required schema.`;
  let retryText: string;
  try {
    retryText = await callJudge(retryPrompt);
  } catch (error) {
    throw new Error(toSafeErrorMessage(error));
  }
  const retryParsed = parseDebateVerdict(retryText);
  if (!retryParsed.success) {
    throw new Error("Judge returned invalid verdict");
  }
  verdict = normalizeVerdictWinner(retryParsed.data);
  if (verdict === null || isDegenerateVerdict(verdict, hasTurns)) {
    throw new Error("Judge returned invalid verdict");
  }
  return { verdict, judgeMs: Date.now() - startMs, usage: { ...total } };
}

function toStreamTurn(turn: DebateTurn): DebateStreamTurn {
  return {
    id: turn.id,
    side: turn.side,
    phase: turn.phase,
    content: turn.content,
    model: turn.model,
    createdAt: turn.createdAt,
  };
}

export async function* runDebate(input: RunDebateInput, deps: RunDebateDeps = {}): AsyncGenerator<DebateStreamEvent> {
  const callModel = deps.callModel;
  if (!callModel) throw new Error("callModel is required");
  const matchId = deps.matchId ?? randomUUID();
  const profile = deps.profile ?? MATCH_PROFILES[input.mode];
  const saveMatch = deps.saveMatch;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const turnsMs: number[] = [];
  const transcript: DebateTurn[] = [];
  const usageTotal: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
  let verdict: DebateVerdict | null = null;
  let terminal: MatchTerminal = "completed";
  let terminalReason: string | null = null;
  let saved = false;
  let seq = 0;

  const envelope = <T extends DebateStreamEventBody>(event: T): DebateStreamEvent => ({
    ...event,
    v: 1 as const,
    matchId,
    seq: (seq += 1),
  });

  const isCancelled = (): boolean => deps.abortSignal?.aborted ?? false;

  async function persist(): Promise<void> {
    if (saved) return;
    saved = true;
    const record: MatchRecord = {
      version: CONTRACT_VERSION,
      matchId,
      startedAt,
      finishedAt: new Date().toISOString(),
      topic: input.topic,
      mode: input.mode,
      sides: deps.sides ?? {
        A: { providerName: input.agentA.providerId, modelId: input.agentA.model, position: input.agentA.position },
        B: { providerName: input.agentB.providerId, modelId: input.agentB.model, position: input.agentB.position },
      },
      judge: input.judge ?? { providerId: input.agentA.providerId, model: input.agentA.model },
      policy: { ...profile },
      promptVersions: { agent: AGENT_PROMPT_VERSION, judge: JUDGE_PROMPT_VERSION },
      rubricVersion: RUBRIC_VERSION,
      transcript: transcript.map((turn) => ({ ...turn })),
      verdict,
      terminal,
      terminalReason,
      metrics: {
        turnsMs: [...turnsMs],
        totalMs: Date.now() - startMs,
        usage: { ...usageTotal },
      },
    };
    if (!saveMatch) return;
    try {
      await saveMatch(record);
    } catch (error) {
      console.error(`Failed to save match record ${matchId}:`, error instanceof Error ? error.message : String(error));
    }
  }

  async function* failWith(message: string): AsyncGenerator<DebateStreamEvent> {
    terminal = isCancelled() ? "cancelled" : "error";
    terminalReason = message;
    yield envelope({ type: "error", message });
    await persist();
    yield envelope({ type: "done", terminal });
  }

  const policy = { maxHistoryTurns: profile.historyTurns };
  const config: DebateConfig = {
    topic: input.topic,
    agents: {
      A: { id: "A", name: "Agent A" },
      B: { id: "B", name: "Agent B" },
    },
    maxHistoryTurns: policy.maxHistoryTurns,
    maxContextCharsPerSide: profile.maxContextCharsPerSide,
  };

  let state: DebateState = createDebateState();

  try {
    for (const { phase, side } of AGENT_PHASES) {
      state = { ...state, phase };
      yield envelope({ type: "phase", phase, side });

      const agent = side === "A" ? input.agentA : input.agentB;
      const system = buildAgentSystemPrompt(side, agent.position, input.topic);
      const context = buildPromptContext(config, state, side);
      const prompt = buildDebatePrompt(context);

      let result: ModelCallResult;
      const turnStartMs = Date.now();
      try {
        result = await callModel({
          kind: "agent",
          providerId: agent.providerId,
          modelId: agent.model,
          system,
          prompt,
          maxOutputTokens: profile.agentMaxOutputTokens,
          abortSignal: deps.abortSignal,
          sessionKey: sessionKeyForMatchSlot(matchId, side === "A" ? "agent-a" : "agent-b"),
        });
      } catch (error) {
        turnsMs.push(Date.now() - turnStartMs);
        return yield* failWith(toSafeErrorMessage(error));
      }
      turnsMs.push(Date.now() - turnStartMs);
      addUsage(usageTotal, result.usage);

      for (const text of result.chunks) {
        if (text) yield envelope({ type: "token", side, text });
      }

      const turn: DebateTurn = {
        id: randomUUID(),
        agentId: side,
        side,
        phase,
        content: result.text,
        model: agent.model,
        createdAt: new Date().toISOString(),
      };
      state = appendTurn(state, turn);
      transcript.push(turn);
      yield envelope({ type: "turn", turn: toStreamTurn(turn) });
    }

    state = { ...state, phase: DebatePhase.JUDGING };
    yield envelope({ type: "judge-start" });

    const judge = input.judge ?? { providerId: input.agentA.providerId, model: input.agentA.model };

    let parsedVerdict: DebateVerdict | null;
    try {
      const judged = await runJudge(
        {
          topic: input.topic,
          turns: state.turns,
          providerId: judge.providerId,
          model: judge.model,
          maxOutputTokens: profile.judgeMaxOutputTokens,
        },
        {
          callModel,
          abortSignal: deps.abortSignal,
          sessionKey: sessionKeyForMatchSlot(matchId, "judge"),
        },
      );
      parsedVerdict = judged.verdict;
      addUsage(usageTotal, judged.usage);
    } catch (error) {
      return yield* failWith(error instanceof Error ? error.message : toSafeErrorMessage(error));
    }
    if (parsedVerdict === null) {
      return yield* failWith("Judge returned invalid verdict");
    }
    verdict = parsedVerdict;
    terminal = "completed";
    terminalReason = null;
    state = attachVerdict(state, verdict);
    void state;
    yield envelope({ type: "verdict", verdict });
    await persist();
    yield envelope({ type: "done", terminal });
  } catch (error) {
    return yield* failWith(toSafeErrorMessage(error));
  } finally {
    // Consumer went away before any terminal path (e.g. client disconnect):
    // persist the partial match as cancelled exactly once.
    if (!saved) {
      terminal = "cancelled";
      terminalReason = terminalReason ?? "Match cancelled";
      await persist();
    }
  }
}
