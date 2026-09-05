import { randomUUID } from "node:crypto";
import {
  AGENT_PROMPT_VERSION,
  appendTurn,
  attachVerdict,
  buildAgentSystemPrompt,
  buildDebatePrompt,
  buildJudgePrompt,
  buildPromptContext,
  CONTRACT_VERSION,
  createDebateState,
  debateVerdictSchema,
  DebatePhase,
  isDegenerateVerdict,
  JUDGE_PROMPT_VERSION,
  JUDGE_SYSTEM_PROMPT,
  MATCH_PROFILES,
  normalizeVerdictWinner,
  parseDebateVerdict,
  RUBRIC_VERSION,
  type DebateConfig,
  type DebatePosition,
  type DebateSide,
  type DebateState,
  type DebateTurn,
  type DebateVerdict,
  type MatchMode,
  type MatchProfile,
  type MatchRecord,
  type MatchTerminal,
  type RubricVersion,
} from "@arena/debate-engine";
import { toSafeErrorMessage } from "../../../shared/api/llm/errors";

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

type DebateEventBody =
  | { readonly type: "phase"; readonly phase: DebatePhase; readonly side: DebateSide | null }
  | { readonly type: "token"; readonly side: DebateSide; readonly text: string }
  | { readonly type: "turn"; readonly turn: DebateStreamTurn }
  | { readonly type: "judge-start" }
  | { readonly type: "verdict"; readonly verdict: DebateVerdict }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done"; readonly terminal: MatchTerminal };

/** Stream contract v1: every event carries `{ v: 1, matchId, seq }`. */
export type DebateStreamEvent = DebateEventBody & {
  readonly v: 1;
  readonly matchId: string;
  readonly seq: number;
};

export interface DebateStreamTurn {
  readonly id: string;
  readonly side: DebateSide;
  readonly phase: DebatePhase;
  readonly content: string;
  readonly model: string;
  readonly createdAt: string;
}

export interface ModelCallArgs {
  readonly kind: "agent" | "judge";
  readonly providerId: string;
  readonly modelId: string;
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  readonly abortSignal?: AbortSignal;
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

async function defaultCallModel(args: ModelCallArgs): Promise<ModelCallResult> {
  const [{ createConfiguredModel }, ai] = await Promise.all([
    import("../../../shared/api/llm/model"),
    import("ai"),
  ]);
  const model = await createConfiguredModel(args.providerId, args.modelId);
  // Quick mode is cost-first: cap reasoning effort on providers that honor it
  // (@ai-sdk/openai responses models). Unknown keys are ignored elsewhere.
  const providerOptions = { openai: { reasoningEffort: "low" } };
  if (args.kind === "judge") {
    const total: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
    try {
      const structured = await ai.generateText({
        model,
        system: args.system,
        prompt: args.prompt,
        maxOutputTokens: args.maxOutputTokens,
        abortSignal: args.abortSignal,
        providerOptions,
        output: ai.Output.object({ schema: debateVerdictSchema }),
      });
      addUsage(total, toModelUsage(structured.usage));
      // Some providers (notably Responses API) can resolve without throwing
      // yet leave `output` undefined/null. Never serialize that into
      // "undefined"/"null" text — fall through to the plain-text fallback.
      const structuredOutput: unknown = (structured as { readonly output?: unknown }).output;
      if (!structuredOutput || typeof structuredOutput !== "object" || Array.isArray(structuredOutput)) {
        throw new Error("Judge structured output was empty");
      }
      return { text: JSON.stringify(structuredOutput), chunks: [], usage: { ...total } };
    } catch {
      // Provider/model rejected structured output or returned nothing usable;
      // fall back to deterministic plain JSON so the existing parser applies.
      const fallback = await ai.generateText({
        model,
        system: args.system,
        prompt:
          `${args.prompt}\n\nRespond with ONLY valid JSON matching the required schema: ` +
          `concrete integer scores 0-100, no markdown fences, no prose.`,
        maxOutputTokens: args.maxOutputTokens,
        abortSignal: args.abortSignal,
        temperature: 0,
        providerOptions,
      });
      addUsage(total, toModelUsage(fallback.usage));
      return { text: fallback.text, chunks: [], usage: { ...total } };
    }
  }
  const result = ai.streamText({
    model,
    system: args.system,
    prompt: args.prompt,
    maxOutputTokens: args.maxOutputTokens,
    abortSignal: args.abortSignal,
    providerOptions,
  });
  const chunks: string[] = [];
  for await (const chunk of result.textStream) chunks.push(chunk);
  const text = await result.text;
  let usage: ModelUsage = ZERO_USAGE;
  try {
    usage = toModelUsage(await result.usage);
  } catch {
    usage = ZERO_USAGE;
  }
  return { text, chunks, usage };
}

async function defaultSaveMatch(record: MatchRecord): Promise<void> {
  const { saveMatchRecord } = await import("../../../shared/config/match-store");
  await saveMatchRecord(record);
}

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
  const callModel = deps.callModel ?? defaultCallModel;
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
  const callModel = deps.callModel ?? defaultCallModel;
  const matchId = deps.matchId ?? randomUUID();
  const profile = deps.profile ?? MATCH_PROFILES[input.mode];
  const saveMatch = deps.saveMatch ?? defaultSaveMatch;
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

  const envelope = <T extends DebateEventBody>(event: T): DebateStreamEvent => ({
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
        { callModel, abortSignal: deps.abortSignal },
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
