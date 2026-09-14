import { ToolLoopAgent, hasToolCall, isStepCount, tool } from "ai";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { toModelUsage } from "@arena/debate-engine";
import type {
  StandardAgentMoveInput,
  StandardAgentMoveResult,
  StandardAgentSession,
  StandardAgentSessionFactoryInput,
  StandardAgentToolEvent,
  StandardToolName,
  StandardToolResult,
} from "@arena/debate-engine";
import { createWebModel, webRunStandardTool } from "./web-adapter";

/**
 * Hard ceiling on SDK tool-loop steps for one Standard move. The default SDK
 * cap is 20; Standard bounds it explicitly so a misbehaving model cannot burn
 * unbounded steps. Four tool calls (`maxToolsPerMove` max) plus the single
 * `speak` step fit comfortably below this.
 */
export const STANDARD_AGENT_STEP_CEILING = 6;

/** Maximum characters kept from a single public transcript turn. */
const MAX_TURN_CHARS = 1_200;
/** Maximum characters kept from a single public tool event. */
const MAX_TOOL_EVENT_CHARS = 800;
/** Maximum characters in the whole private observation message. */
const MAX_OBSERVATION_CHARS = 20_000;
/** Maximum characters returned to the model from a native tool. */
const MAX_TOOL_OUTPUT_CHARS = 6_000;
/** Maximum characters of a normalized tool error (no provider internals). */
const MAX_TOOL_ERROR_CHARS = 240;

/** `speak` is our internal move-delivery tool; it replaces the old JSON action. */
const speakSchema = z.object({
  content: z.string().min(1).max(12_000),
  ready: z.boolean(),
});

const webSearchSchema = z.object({
  query: z.string().trim().min(2).max(240),
});

const fetchUrlSchema = z.object({
  query: z.string().trim().min(1).max(2_048),
});

const runCodeSchema = z.object({
  language: z.enum(["javascript", "python"]),
  query: z.string().trim().min(1).max(20_000),
});

/** The per-move bookkeeping the tool wrappers and speak capture share. */
interface MoveState {
  readonly maxAffordableTools: number;
  readonly toolTimeoutMs: number;
  readonly abortSignal?: AbortSignal;
  /** Every native-tool invocation this move, including over-cap attempts. */
  reserved: number;
  /** Executed (not over-cap) tool calls, in call order. */
  toolEvents: StandardAgentToolEvent[];
  speak: { readonly content: string; readonly ready: boolean } | null;
}

function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (a && b) return AbortSignal.any([a, b]);
  return a ?? b;
}

function bound(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/**
 * Renders the one private user message handed to the session per move. It only
 * carries public match state (topic, transcript, tool events) plus the
 * runner-owned resources the side must plan around.
 */
function renderObservation(input: StandardAgentMoveInput): string {
  const header = [
    `TOPIC: ${input.topic}`,
    `YOU: Side ${input.side}, position ${input.position}.`,
    `PHASE: ${input.phase}. Closing round: ${input.closingRound ? "yes" : "no"}.`,
    `CREDITS: ${input.credits} (a public speech costs ${input.speechCost}; each tool call costs ${input.toolCost}).`,
    `TOOL ALLOWANCE: up to ${input.maxAffordableTools} tool call(s) this move (per-move cap ${input.maxToolsPerMove}).`,
  ].join("\n");

  const body: string[] = ["PUBLIC TRANSCRIPT:"];
  if (input.observation.length === 0) {
    body.push("(no public moves yet)");
  } else {
    for (const turn of input.observation) {
      body.push(`- [${turn.phase}] ${turn.side}: ${bound(turn.content, MAX_TURN_CHARS)}`);
    }
  }

  body.push("PUBLIC TOOL EVENTS:");
  if (input.publicToolEvents.length === 0) {
    body.push("(none yet)");
  } else {
    for (const event of input.publicToolEvents) {
      const status = event.ok ? "ok" : "failed";
      const error = event.error ? ` (${bound(event.error, MAX_TOOL_ERROR_CHARS)})` : "";
      body.push(
        `- ${event.side} ${event.tool}(${bound(event.query, 240)}) -> ${status}${error}: ` +
          bound(event.output, MAX_TOOL_EVENT_CHARS),
      );
    }
  }

  const footer =
    "Use the native tools to research or verify anything that helps your case, then call the `speak` tool " +
    "exactly once with your public speech and ready flag to deliver this move.";

  const budget = Math.max(0, MAX_OBSERVATION_CHARS - header.length - footer.length - 16);
  let renderedBody = body.join("\n");
  if (renderedBody.length > budget) renderedBody = `${renderedBody.slice(0, budget)}\n...[truncated]`;
  return `${header}\n${renderedBody}\n${footer}`;
}

function buildInstructions(input: StandardAgentSessionFactoryInput): string {
  return [
    `You are Agent ${input.side} in a live, multi-move AI Debate Arena match on the topic: "${input.topic}".`,
    `Your fixed position is ${input.position}.`,
    "You keep one private conversation for the whole match and may research with the available tools at any point.",
    "Your public arguments, tool calls, and tool results are visible to the opponent and the judge; your private reasoning is not.",
    "When you are ready to make your move, call the `speak` tool exactly once with your public speech and a ready flag.",
    "Set ready to true only when you are willing to end the match after the opponent's reply.",
  ].join(" ");
}

function toToolEvent(toolName: StandardToolName, query: string, result: StandardToolResult): StandardAgentToolEvent {
  return {
    tool: toolName,
    query,
    output: result.output.slice(0, MAX_TOOL_OUTPUT_CHARS),
    ok: result.ok,
    ...(result.error ? { error: result.error.slice(0, MAX_TOOL_ERROR_CHARS) } : {}),
  };
}

/**
 * Server-owned Standard agent session backed by the AI SDK v7 `ToolLoopAgent`.
 *
 * One session is created per side per match. The model is built lazily (once)
 * through {@link createWebModel} with the stable `<matchId>:agent-a|b` session
 * key, and the match-long `privateMessages` conversation is kept here. Native
 * tools execute through the local server registry ({@link webRunStandardTool});
 * the internal `speak` tool captures the public move and stops the loop. No
 * private model content is ever surfaced publicly.
 */
export function createWebStandardAgentSession(input: StandardAgentSessionFactoryInput): StandardAgentSession {
  const privateMessages: ModelMessage[] = [];
  let move: MoveState | null = null;

  async function runNativeTool(
    toolName: StandardToolName,
    query: string,
    language: "javascript" | "python" | undefined,
    signal: AbortSignal | undefined,
  ): Promise<StandardToolResult> {
    const state = move;
    if (!state) return { ok: false, output: "No active Standard move.", error: "No active move" };
    // Reserve synchronously so parallel tool calls cannot exceed the budget.
    const reserved = (state.reserved += 1);
    if (reserved > state.maxAffordableTools) {
      return {
        ok: false,
        output:
          `The tool budget for this move is exhausted (${state.maxAffordableTools} call(s) allowed). ` +
          "Use the results you already have and call speak.",
        error: "Tool budget exhausted",
      };
    }
    let result: StandardToolResult;
    try {
      result = await webRunStandardTool(
        toolName,
        { query, ...(language ? { language } : {}), timeoutMs: state.toolTimeoutMs },
        signal,
      );
    } catch {
      result = { ok: false, output: "The tool could not be executed.", error: "Tool execution failed" };
    }
    state.toolEvents.push(toToolEvent(toolName, query, result));
    return result;
  }

  const tools = {
    web_search: tool({
      description: "Search the public web for sources, facts, or counter-evidence. Returns bounded text results.",
      inputSchema: webSearchSchema,
      execute: (args, options) =>
        runNativeTool("web_search", args.query, undefined, combineSignals(move?.abortSignal, options.abortSignal)),
    }),
    fetch_url: tool({
      description: "Fetch one http(s) URL and return its readable plain text for evidence.",
      inputSchema: fetchUrlSchema,
      execute: (args, options) =>
        runNativeTool("fetch_url", args.query, undefined, combineSignals(move?.abortSignal, options.abortSignal)),
    }),
    run_code: tool({
      description: "Run a short JavaScript or Python program to compute, test, or demonstrate something.",
      inputSchema: runCodeSchema,
      execute: (args, options) =>
        runNativeTool("run_code", args.query, args.language, combineSignals(move?.abortSignal, options.abortSignal)),
    }),
    speak: tool({
      description:
        "Deliver your public speech for this move. Call exactly once with the full speech and your ready flag.",
      inputSchema: speakSchema,
      execute: (args) => {
        const state = move;
        if (state && !state.speak) state.speak = { content: args.content, ready: args.ready === true };
        return { ok: true };
      },
    }),
  };

  function buildAgent() {
    return createWebModel(input.providerId, input.model, input.sessionKey).then(
      (model) =>
        new ToolLoopAgent({
          id: input.sessionKey,
          model,
          instructions: buildInstructions(input),
          tools,
          maxOutputTokens: input.maxOutputTokens,
          stopWhen: [hasToolCall("speak"), isStepCount(STANDARD_AGENT_STEP_CEILING)],
        }),
    );
  }

  let agentPromise: ReturnType<typeof buildAgent> | undefined;
  function getAgent(): ReturnType<typeof buildAgent> {
    agentPromise ??= buildAgent();
    return agentPromise;
  }

  return {
    async move(moveInput: StandardAgentMoveInput): Promise<StandardAgentMoveResult> {
      const state: MoveState = {
        maxAffordableTools: moveInput.maxAffordableTools,
        toolTimeoutMs: moveInput.toolTimeoutMs,
        abortSignal: moveInput.abortSignal,
        reserved: 0,
        toolEvents: [],
        speak: null,
      };
      move = state;

      const observation: ModelMessage = { role: "user", content: renderObservation(moveInput) };
      const agent = await getAgent();
      const result = await agent.stream({
        messages: [...privateMessages, observation],
        abortSignal: moveInput.abortSignal,
      });

      // Text and reasoning are private: the public speech must arrive through
      // the speak tool, and a missing speak is a protocol error.
      for await (const _part of result.stream) {
        void _part;
      }

      privateMessages.push(observation);
      const responseMessages = await result.responseMessages;
      privateMessages.push(...responseMessages);

      if (!state.speak) throw new Error("Standard agent did not call the speak tool");

      let usage: StandardAgentMoveResult["usage"];
      try {
        usage = toModelUsage(await result.usage);
      } catch {
        usage = undefined;
      }

      return {
        speech: state.speak.content,
        ready: state.speak.ready,
        toolEvents: state.toolEvents,
        ...(usage ? { usage } : {}),
      };
    },
  };
}
