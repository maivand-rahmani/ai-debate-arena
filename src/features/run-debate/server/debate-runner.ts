import { randomUUID } from "node:crypto";
import {
  DebatePhase,
  type DebateConfig,
  type DebatePosition,
  type DebateSide,
  type DebateState,
  type DebateTurn,
  type DebateVerdict,
} from "../../../entities/debate/types";
import { appendTurn, attachVerdict, createDebateState } from "../../../entities/debate/state";
import { buildDebatePrompt, buildPromptContext } from "../../../entities/debate/prompt";
import { buildAgentSystemPrompt, buildJudgePrompt, JUDGE_SYSTEM_PROMPT } from "../../../entities/debate/prompts";
import {
  debateVerdictSchema,
  isDegenerateVerdict,
  normalizeVerdictWinner,
  parseDebateVerdict,
} from "../../../entities/debate/verdict";
import { getTokenPolicy } from "../../../shared/token-policy";
import { toSafeErrorMessage } from "../../../shared/api/llm/errors";

export interface RunnerAgentInput {
  readonly providerId: string;
  readonly model: string;
  readonly position: DebatePosition;
}

export interface RunDebateInput {
  readonly topic: string;
  readonly mode: "quick";
  readonly agentA: RunnerAgentInput;
  readonly agentB: RunnerAgentInput;
  readonly judge?: { readonly providerId: string; readonly model: string };
}

export type DebateStreamEvent =
  | { readonly type: "phase"; readonly phase: DebatePhase; readonly side: DebateSide | null }
  | { readonly type: "token"; readonly side: DebateSide; readonly text: string }
  | { readonly type: "turn"; readonly turn: DebateStreamTurn }
  | { readonly type: "judge-start" }
  | { readonly type: "verdict"; readonly verdict: DebateVerdict }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done" };

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

export interface RunDebateDeps {
  readonly callModel?: (args: ModelCallArgs) => Promise<{ readonly text: string; readonly chunks: readonly string[] }>;
  readonly abortSignal?: AbortSignal;
}

const AGENT_PHASES: ReadonlyArray<{ readonly phase: DebateTurn["phase"]; readonly side: DebateSide }> = [
  { phase: DebatePhase.OPENING_A, side: "A" },
  { phase: DebatePhase.OPENING_B, side: "B" },
  { phase: DebatePhase.REBUTTAL_A, side: "A" },
  { phase: DebatePhase.REBUTTAL_B, side: "B" },
];

async function defaultCallModel(args: ModelCallArgs): Promise<{ text: string; chunks: string[] }> {
  const [{ createConfiguredModel }, ai] = await Promise.all([
    import("../../../shared/api/llm/model"),
    import("ai"),
  ]);
  const model = await createConfiguredModel(args.providerId, args.modelId);
  // Quick mode is cost-first: cap reasoning effort on providers that honor it
  // (@ai-sdk/openai responses models). Unknown keys are ignored elsewhere.
  const providerOptions = { openai: { reasoningEffort: "low" } };
  if (args.kind === "judge") {
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
      // Some providers (notably Responses API) can resolve without throwing
      // yet leave `output` undefined/null. Never serialize that into
      // "undefined"/"null" text — fall through to the plain-text fallback.
      const structuredOutput: unknown = (structured as { readonly output?: unknown }).output;
      if (!structuredOutput || typeof structuredOutput !== "object" || Array.isArray(structuredOutput)) {
        throw new Error("Judge structured output was empty");
      }
      return { text: JSON.stringify(structuredOutput), chunks: [] };
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
      return { text: fallback.text, chunks: [] };
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
  return { text: await result.text, chunks };
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
  const policy = getTokenPolicy("Quick");
  const config: DebateConfig = {
    topic: input.topic,
    agents: {
      A: { id: "A", name: "Agent A" },
      B: { id: "B", name: "Agent B" },
    },
    maxHistoryTurns: policy.maxHistoryTurns,
  };

  let state: DebateState = createDebateState();

  try {
    for (const { phase, side } of AGENT_PHASES) {
      state = { ...state, phase };
      yield { type: "phase", phase, side };

      const agent = side === "A" ? input.agentA : input.agentB;
      const system = buildAgentSystemPrompt(side, agent.position, input.topic);
      const context = buildPromptContext(config, state, side);
      const prompt = buildDebatePrompt(context);

      let result: { readonly text: string; readonly chunks: readonly string[] };
      try {
        result = await callModel({
          kind: "agent",
          providerId: agent.providerId,
          modelId: agent.model,
          system,
          prompt,
          maxOutputTokens: policy.agentMaxOutputTokens,
          abortSignal: deps.abortSignal,
        });
      } catch (error) {
        yield { type: "error", message: toSafeErrorMessage(error) };
        yield { type: "done" };
        return;
      }

      for (const text of result.chunks) {
        if (text) yield { type: "token", side, text };
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
      yield { type: "turn", turn: toStreamTurn(turn) };
    }

    state = { ...state, phase: DebatePhase.JUDGING };
    yield { type: "judge-start" };

    const judge = input.judge ?? { providerId: input.agentA.providerId, model: input.agentA.model };
    const judgePrompt = buildJudgePrompt(input.topic, state.turns);
    const hasTurns = state.turns.length > 0;

    let judgeText: string;
    try {
      const result = await callModel({
        kind: "judge",
        providerId: judge.providerId,
        modelId: judge.model,
        system: JUDGE_SYSTEM_PROMPT,
        prompt: judgePrompt,
        maxOutputTokens: policy.judgeMaxOutputTokens,
        abortSignal: deps.abortSignal,
      });
      judgeText = result.text;
    } catch (error) {
      yield { type: "error", message: toSafeErrorMessage(error) };
      yield { type: "done" };
      return;
    }

    let parsed = parseDebateVerdict(judgeText);
    let verdict = parsed.success ? normalizeVerdictWinner(parsed.data) : null;
    if (!parsed.success || verdict === null || isDegenerateVerdict(verdict, hasTurns)) {
      // Single retry: previous output was unparsable or degenerate zeros.
      const retryPrompt =
        `${judgePrompt}\n\nPrevious output was invalid (unparsable, or a degenerate DRAW with scores of 0 ` +
        `despite a non-empty transcript). Respond with ONLY the corrected JSON object matching the required schema.`;
      let retryText: string;
      try {
        const retry = await callModel({
          kind: "judge",
          providerId: judge.providerId,
          modelId: judge.model,
          system: JUDGE_SYSTEM_PROMPT,
          prompt: retryPrompt,
          maxOutputTokens: policy.judgeMaxOutputTokens,
          abortSignal: deps.abortSignal,
        });
        retryText = retry.text;
      } catch (error) {
        yield { type: "error", message: toSafeErrorMessage(error) };
        yield { type: "done" };
        return;
      }
      parsed = parseDebateVerdict(retryText);
      if (!parsed.success) {
        yield { type: "error", message: "Judge returned invalid verdict" };
        yield { type: "done" };
        return;
      }
      verdict = normalizeVerdictWinner(parsed.data);
      if (isDegenerateVerdict(verdict, hasTurns)) {
        yield { type: "error", message: "Judge returned invalid verdict" };
        yield { type: "done" };
        return;
      }
    }
    if (verdict === null) {
      yield { type: "error", message: "Judge returned invalid verdict" };
      yield { type: "done" };
      return;
    }
    state = attachVerdict(state, verdict);
    void state;
    yield { type: "verdict", verdict };
    yield { type: "done" };
  } catch (error) {
    yield { type: "error", message: toSafeErrorMessage(error) };
    yield { type: "done" };
  }
}
