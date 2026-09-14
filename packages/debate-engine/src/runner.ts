import { randomUUID } from "node:crypto";
import {
  AGENT_PROMPT_VERSION,
  buildDebatePrompt,
  buildPromptContext,
  JUDGE_PROMPT_VERSION,
  buildAgentSystemPrompt,
  buildJudgePrompt,
  JUDGE_SYSTEM_PROMPT,
} from "./prompts";
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
import {
  JUDGE_MAX_CONTEXT_CHARS,
  MATCH_PROFILES,
  STANDARD_MAX_MOVES,
  STANDARD_SPEECH_COST,
  STANDARD_TOOL_COST,
  resolveStandardLimits,
  type MatchProfile,
  type StandardLimitsInput,
} from "./token-policy";
import { RUBRIC_VERSION, type RubricVersion } from "./rubric";
import {
  CONTRACT_VERSION,
  type MatchMode,
  type MatchRecord,
  type MatchTerminal,
  type StandardToolEventRecord,
} from "./contract";
import type { StandardToolExecutor } from "./standard";
import type {
  StandardAgentSession,
  StandardAgentProgressEvent,
  StandardAgentSessionFactory,
  StandardAgentToolEvent,
} from "./standard-agent";
import type {
  DebateStreamEvent,
  DebateStreamEventBody,
  DebateStreamSideResources,
  DebateStreamStandardState,
  DebateStreamTerminal,
  DebateStreamTurn,
  DebateStreamVerdict,
} from "@arena/types";
import { getMatchFormat, standardOpeningTurn, standardRoundTurn, type MatchTurnSpec } from "@arena/types";

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
  DebateStreamSideResources,
  DebateStreamStandardState,
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
  /**
   * Optional Standard resource/tool bounds. Omitted fields fall back to the
   * engine defaults; bounds are validated by {@link resolveStandardLimits}.
   * Ignored for Quick.
   */
  readonly standardLimits?: StandardLimitsInput;
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
  readonly runTool?: StandardToolExecutor;
  /**
   * SDK-neutral Standard agent sessions. Required by Standard mode: the host
   * binds its model SDK (and native tool-calling loop) here, one match-long
   * session per side. Ignored by Quick.
   */
  readonly createStandardAgentSession?: StandardAgentSessionFactory;
}

export interface RunJudgeInput {
  readonly topic: string;
  readonly turns: readonly DebateTurn[];
  readonly providerId: string;
  readonly model: string;
  readonly maxOutputTokens?: number;
  /** Maximum transcript characters included in the judge prompt. */
  readonly maxContextChars?: number;
  /** Rubric generation for the judge prompt. Defaults to `"1"` (legacy prompt). */
  readonly rubricVersion?: RubricVersion;
  readonly toolEvents?: readonly StandardToolEventRecord[];
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
  const judgePrompt = buildJudgePrompt(input.topic, input.turns, {
    rubricVersion: input.rubricVersion,
    maxTranscriptChars: input.maxContextChars,
    toolEvents: input.toolEvents,
  });
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
  reportInvalidJudgeOutput("initial", judgeText, parsed.success ? "degenerate zero-score verdict" : parsed.error.issues);
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
    reportInvalidJudgeOutput("retry", retryText, retryParsed.error.issues);
    throw new Error("Judge returned invalid verdict");
  }
  verdict = normalizeVerdictWinner(retryParsed.data);
  if (verdict === null || isDegenerateVerdict(verdict, hasTurns)) {
    reportInvalidJudgeOutput("retry", retryText, "degenerate zero-score verdict");
    throw new Error("Judge returned invalid verdict");
  }
  return { verdict, judgeMs: Date.now() - startMs, usage: { ...total } };
}

/**
 * Gives the server enough evidence to diagnose non-conforming judge models
 * without logging a whole debate transcript or any provider credentials.
 */
function reportInvalidJudgeOutput(
  attempt: "initial" | "retry",
  text: string,
  reason: string | readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): void {
  const summary = Array.isArray(reason)
    ? reason.slice(0, 4).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ")
    : reason;
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 240);
  console.warn("[arena:judge] invalid verdict output", {
    attempt,
    chars: text.length,
    reason: summary,
    preview,
  });
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

/**
 * Turns one normalized session tool event into the persisted/public record the
 * runner owns: fresh call id, timestamp, and bounded output/error text.
 */
function toStandardToolRecord(
  side: DebateSide,
  event: StandardAgentToolEvent,
  identity?: { readonly callId: string; readonly createdAt: string },
): StandardToolEventRecord {
  return {
    callId: identity?.callId ?? randomUUID(),
    side,
    tool: event.tool,
    query: event.query,
    output: event.output.slice(0, 6000),
    ok: event.ok,
    ...(event.error ? { error: event.error.slice(0, 240) } : {}),
    createdAt: identity?.createdAt ?? new Date().toISOString(),
  };
}

const STANDARD_PROGRESS_QUEUE_LIMIT = 32;

/** Small hand-off queue so session callbacks are observed before move settles. */
class StandardProgressQueue {
  private readonly items: StandardAgentProgressEvent[] = [];
  private readonly waiters: Array<(event: StandardAgentProgressEvent | undefined) => void> = [];
  private closed = false;

  push(event: StandardAgentProgressEvent): void {
    if (this.closed) throw new Error("Standard move progress arrived after the move completed");
    if (this.items.length >= STANDARD_PROGRESS_QUEUE_LIMIT) {
      throw new Error("Standard move progress queue exceeded its bound");
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.items.push(event);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()!(undefined);
  }

  next(): Promise<StandardAgentProgressEvent | undefined> {
    const event = this.items.shift();
    if (event) return Promise.resolve(event);
    if (this.closed) return Promise.resolve(undefined);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
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
  const toolEvents: StandardToolEventRecord[] = [];

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
      toolEvents: toolEvents.length ? toolEvents.map((event) => ({ ...event })) : undefined,
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
      A: { id: "A", name: "Agent A", position: input.agentA.position },
      B: { id: "B", name: "Agent B", position: input.agentB.position },
    },
    maxHistoryTurns: policy.maxHistoryTurns,
    maxContextCharsPerSide: profile.maxContextCharsPerSide,
  };

  let state: DebateState = createDebateState();
  const format = getMatchFormat(input.mode);
  const standardLimits = resolveStandardLimits(input.standardLimits);
  const standardCredits: Record<DebateSide, number> = {
    A: standardLimits.startingCredits,
    B: standardLimits.startingCredits,
  };
  // Public per-side accounting the runner owns. Credits are charged below;
  // `standardToolsUsed` accumulates across the match and
  // `standardLastMoveTools` records the most recent move for the snapshot.
  const standardToolsUsed: Record<DebateSide, number> = { A: 0, B: 0 };
  const standardLastMoveTools: Record<DebateSide, number> = { A: 0, B: 0 };
  let standardMoveCount = 0;
  const sideOrder: readonly DebateSide[] = ["A", "B"];

  function standardSideResources(side: DebateSide): DebateStreamSideResources {
    return {
      side,
      creditsRemaining: standardCredits[side],
      toolsUsed: standardToolsUsed[side],
      toolsUsedThisMove: standardLastMoveTools[side],
      maxToolsPerMove: standardLimits.maxToolsPerMove,
      toolTimeoutMs: standardLimits.toolTimeoutMs,
      depleted: standardCredits[side] < STANDARD_SPEECH_COST,
    };
  }

  /** Public snapshot of authoritative Standard resources after a move. */
  function standardStateSnapshot(closingRound: boolean): DebateStreamStandardState {
    return {
      startingCredits: standardLimits.startingCredits,
      speechCost: STANDARD_SPEECH_COST,
      toolCost: STANDARD_TOOL_COST,
      maxMoves: STANDARD_MAX_MOVES,
      movesUsed: standardMoveCount,
      moveLimitReached: standardMoveCount >= STANDARD_MAX_MOVES,
      closingRound,
      sides: { A: standardSideResources("A"), B: standardSideResources("B") },
    };
  }
  // One match-long session per side, created lazily on that side's first move
  // and reused for the rest of the match.
  const standardSessions: Partial<Record<DebateSide, StandardAgentSession>> = {};

  function standardSessionFor(side: DebateSide): StandardAgentSession {
    const existing = standardSessions[side];
    if (existing) return existing;
    const factory = deps.createStandardAgentSession;
    if (!factory) throw new Error("Standard mode requires a createStandardAgentSession dependency");
    const agent = side === "A" ? input.agentA : input.agentB;
    const session = factory({
      matchId,
      topic: input.topic,
      side,
      position: agent.position,
      providerId: agent.providerId,
      model: agent.model,
      maxOutputTokens: profile.agentMaxOutputTokens,
      sessionKey: sessionKeyForMatchSlot(matchId, side === "A" ? "agent-a" : "agent-b"),
    });
    standardSessions[side] = session;
    return session;
  }

  /**
   * Plays one Standard move through the side's private match-long session. The
   * runner owns the observation handed in, the credit charge, the public
   * event envelopes, persistence, and the resulting turn; the session owns the
   * observe → tool loop → speak decision.
   */
  async function* playStandardMove(
    side: DebateSide,
    spec: MatchTurnSpec,
    closingRound: boolean,
  ): AsyncGenerator<DebateStreamEvent, { readonly ready: boolean }> {
    const phase = spec.id;
    state = { ...state, phase };
    yield envelope({ type: "phase", phase, side });

    const agent = side === "A" ? input.agentA : input.agentB;
    const turnStartMs = Date.now();
    const credits = standardCredits[side];
    // Reserve one credit for the public speech, then buy tools two credits at a
    // time up to the per-move cap. A side that cannot afford a speech never
    // reaches this function; the lifecycle forces it to close.
    const maxAffordableTools = Math.max(
      0,
      Math.min(standardLimits.maxToolsPerMove, Math.floor((credits - STANDARD_SPEECH_COST) / STANDARD_TOOL_COST)),
    );

    const progressQueue = new StandardProgressQueue();
    const pendingTools = new Map<
      string,
      { readonly callId: string; readonly createdAt: string; readonly tool: StandardAgentToolEvent["tool"]; readonly query: string }
    >();
    let progressToolResults = 0;
    let progressSpeech = false;

    function* translateProgress(event: StandardAgentProgressEvent): Generator<DebateStreamEvent> {
      if (event.type === "speech") {
        progressSpeech = true;
        yield envelope({ type: "token", side, text: event.text });
        return;
      }

      if (event.type === "tool-start") {
        const identity = { callId: randomUUID(), createdAt: new Date().toISOString() };
        pendingTools.set(event.invocationId, { ...identity, tool: event.tool, query: event.query });
        yield envelope({
          type: "tool-start",
          tool: { callId: identity.callId, side, tool: event.tool, query: event.query, createdAt: identity.createdAt },
        });
        return;
      }

      const pending = pendingTools.get(event.invocationId);
      if (!pending) throw new Error("Standard agent returned a tool result without a start");
      pendingTools.delete(event.invocationId);
      progressToolResults += 1;
      const record = toStandardToolRecord(
        side,
        {
          tool: event.tool,
          query: event.query,
          output: event.output,
          ok: event.ok,
          ...(event.error ? { error: event.error } : {}),
        },
        pending,
      );
      toolEvents.push(record);
      yield envelope({
        type: "tool-result",
        result: {
          callId: record.callId,
          side,
          tool: record.tool,
          query: record.query,
          ok: record.ok,
          output: record.output,
          ...(record.error ? { error: record.error } : {}),
          createdAt: record.createdAt,
        },
      });
    }

    let move: Awaited<ReturnType<StandardAgentSession["move"]>> | undefined;
    let moveError: unknown;
    let movePromise: Promise<Awaited<ReturnType<StandardAgentSession["move"]>>>;
    try {
      if (!deps.runTool) throw new Error("Standard tool executor is not configured");
      movePromise = standardSessionFor(side).move({
        topic: input.topic,
        observation: state.turns,
        phase,
        side,
        position: agent.position,
        credits,
        speechCost: STANDARD_SPEECH_COST,
        toolCost: STANDARD_TOOL_COST,
        maxToolsPerMove: standardLimits.maxToolsPerMove,
        maxAffordableTools,
        toolTimeoutMs: standardLimits.toolTimeoutMs,
        closingRound,
        publicToolEvents: [...toolEvents],
        runTool: deps.runTool,
        onProgress: (event) => progressQueue.push(event),
        abortSignal: deps.abortSignal,
      });
    } catch (error) {
      turnsMs.push(Date.now() - turnStartMs);
      throw error;
    }

    void movePromise.then(
      (result) => {
        move = result;
        progressQueue.close();
      },
      (error: unknown) => {
        moveError = error;
        progressQueue.close();
      },
    );
    while (true) {
      const progress = await progressQueue.next();
      if (!progress) break;
      yield* translateProgress(progress);
    }
    if (moveError) throw moveError;
    if (!move) throw new Error("Standard agent move did not resolve");
    turnsMs.push(Date.now() - turnStartMs);

    if (move.toolEvents.length > maxAffordableTools) {
      throw new Error("Standard session used more tool calls than the move allowed");
    }

    // Charge actual usage: every reported tool event plus the one speech.
    standardCredits[side] = credits - move.toolEvents.length * STANDARD_TOOL_COST - STANDARD_SPEECH_COST;
    standardToolsUsed[side] += move.toolEvents.length;
    standardLastMoveTools[side] = move.toolEvents.length;
    addUsage(usageTotal, move.usage);

    // Older/injected sessions may only return final tool events. Reconcile
    // those as a compatibility path, while never duplicating live progress.
    for (const [index, event] of move.toolEvents.slice(progressToolResults).entries()) {
      const invocationId = `returned:${index}`;
      yield* translateProgress({ type: "tool-start", invocationId, tool: event.tool, query: event.query });
      yield* translateProgress({
        type: "tool-result",
        invocationId,
        tool: event.tool,
        query: event.query,
        output: event.output,
        ok: event.ok,
        ...(event.error ? { error: event.error } : {}),
      });
    }

    const chunks = (move.chunks ?? []).filter((chunk) => chunk.length > 0);
    if (chunks.length > 0) {
      for (const text of chunks) yield envelope({ type: "token", side, text });
    } else if (!progressSpeech && move.speech) {
      yield envelope({ type: "token", side, text: move.speech });
    }

    const turn: DebateTurn = {
      id: randomUUID(),
      agentId: side,
      side,
      phase,
      content: move.speech,
      model: agent.model,
      createdAt: new Date().toISOString(),
    };
    state = appendTurn(state, turn);
    transcript.push(turn);
    yield envelope({ type: "turn", turn: toStreamTurn(turn) });
    standardMoveCount += 1;
    // Publish authoritative post-move accounting. Emitted after the turn so
    // the existing tool → token → turn order is unchanged.
    yield envelope({ type: "standard-state", state: standardStateSnapshot(closingRound) });
    return { ready: move.ready === true };
  }

  /**
   * Standard lifecycle. Both sides always open, then paired open rounds
   * continue while neither is ready. When both are ready the match ends; when
   * only one is ready, one paired answer round follows so neither side loses
   * the right to reply. A side that cannot afford a speech is forced to close
   * after the opponent's move. The move ceiling is only an emergency brake.
   */
  async function* runStandardLifecycle(): AsyncGenerator<DebateStreamEvent> {
    for (const side of sideOrder) {
      if (standardMoveCount >= STANDARD_MAX_MOVES) break;
      yield* playStandardMove(side, standardOpeningTurn(side), false);
    }

    const ready: Record<DebateSide, boolean> = { A: false, B: false };
    let closingRound = false;
    let round = 0;
    while (standardMoveCount < STANDARD_MAX_MOVES) {
      round += 1;
      let forcedClose = false;
      for (const side of sideOrder) {
        if (standardMoveCount >= STANDARD_MAX_MOVES) {
          forcedClose = true;
          break;
        }
        if (standardCredits[side] < STANDARD_SPEECH_COST) {
          // Depleted: forced to close, but the opponent still gets its move in
          // this round before the match stops.
          forcedClose = true;
          continue;
        }
        const outcome = yield* playStandardMove(side, standardRoundTurn(side, round), closingRound);
        if (!closingRound) ready[side] = outcome.ready;
      }
      if (closingRound) break;
      if (forcedClose) break;
      if (ready.A && ready.B) break;
      if (ready.A || ready.B) closingRound = true;
    }
  }

  try {
    if (input.mode === "standard") {
      yield* runStandardLifecycle();
    } else {
      for (const turnSpec of format.turns) {
        const { side } = turnSpec;
        const phase = turnSpec.id;
        state = { ...state, phase };
        yield envelope({ type: "phase", phase, side });

        const agent = side === "A" ? input.agentA : input.agentB;
        const system = buildAgentSystemPrompt(side, agent.position, input.topic);
        const context = buildPromptContext(config, state, side, turnSpec);
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
          maxContextChars: JUDGE_MAX_CONTEXT_CHARS,
          toolEvents,
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
