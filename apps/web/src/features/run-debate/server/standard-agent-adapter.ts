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
import { createWebModel } from "./web-adapter";

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
/** Upper clamp on the private observation size, independent of the match budget. */
const MAX_OBSERVATION_CHARS = 20_000;
/** Maximum characters returned to the model from a native tool. */
const MAX_TOOL_OUTPUT_CHARS = 6_000;
/** Maximum characters of a normalized tool error (no provider internals). */
const MAX_TOOL_ERROR_CHARS = 240;
/**
 * Fallback bound for the private match-long conversation when the runner does
 * not supply one. Mirrors the Standard profile's per-side context budget so
 * direct construction stays bounded too.
 */
const DEFAULT_MAX_PRIVATE_CONTEXT_CHARS = 24_000;

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
  readonly runTool: StandardAgentMoveInput["runTool"];
  readonly onProgress?: StandardAgentMoveInput["onProgress"];
  /** Every native-tool invocation this move, including over-cap attempts. */
  reserved: number;
  /**
   * Tool events indexed by invocation order (`reserved - 1`). Parallel SDK
   * calls finish in arbitrary order, so results are placed by slot instead of
   * appended; the runner publishes them in this stable order.
   */
  toolEvents: Array<StandardAgentToolEvent | undefined>;
  speak: { readonly content: string; readonly ready: boolean } | null;
  /** Set when the model calls `speak` more than once in a move. */
  duplicateSpeak: boolean;
  speakInputId: string | null;
  speakInputBuffer: string;
  streamedSpeakText: string;
  speakInputDecodeFailed: boolean;
}

function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (a && b) return AbortSignal.any([a, b]);
  return a ?? b;
}

function bound(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

const TRUNCATION_MARKER = "…[truncated]";

function clipText(value: string, budget: number): string {
  if (value.length <= budget) return value;
  if (budget <= TRUNCATION_MARKER.length) return TRUNCATION_MARKER.slice(0, Math.max(0, budget));
  return `${value.slice(0, budget - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function observationBlockLines(input: StandardAgentMoveInput): { transcript: string[]; tools: string[] } {
  const transcript = input.observation.length === 0
    ? ["(no public moves yet)"]
    : input.observation.map((turn) => `- [${turn.phase}] ${turn.side}: ${bound(turn.content, MAX_TURN_CHARS)}`);
  const tools = input.publicToolEvents.length === 0
    ? ["(none yet)"]
    : input.publicToolEvents.map((event) => {
        const status = event.ok ? "ok" : "failed";
        const error = event.error ? ` (${bound(event.error, MAX_TOOL_ERROR_CHARS)})` : "";
        return `- ${event.side} ${event.tool}(${bound(event.query, 240)}) -> ${status}${error}: ` +
          bound(event.output, MAX_TOOL_EVENT_CHARS);
      });
  return { transcript, tools };
}

/**
 * Renders the one private user message handed to the session per move. It only
 * carries public match state (topic, transcript, tool events) plus the
 * runner-owned resources the side must plan around.
 *
 * The result never exceeds `maxChars`. When the public state does not fit, the
 * oldest transcript/tool lines are dropped first so the topic header and the
 * newest public state survive; a budget smaller than the header itself still
 * yields a header-preserving truncated string.
 */
export function renderObservation(input: StandardAgentMoveInput, maxChars: number): string {
  const header = [
    `TOPIC: ${input.topic}`,
    `YOU: Side ${input.side}, position ${input.position}.`,
    `PHASE: ${input.phase}. Closing round: ${input.closingRound ? "yes" : "no"}.`,
    `CREDITS: ${input.credits} (a public speech costs ${input.speechCost}; each tool call costs ${input.toolCost}).`,
    `TOOL ALLOWANCE: up to ${input.maxAffordableTools} tool call(s) this move (per-move cap ${input.maxToolsPerMove}).`,
  ].join("\n");
  const footer =
    "Use the native tools to research or verify anything that helps your case, then call the `speak` tool " +
    "exactly once with your public speech and ready flag to deliver this move.";

  const { transcript, tools } = observationBlockLines(input);
  const blocks = [
    { label: "PUBLIC TRANSCRIPT:", lines: transcript },
    { label: "PUBLIC TOOL EVENTS:", lines: tools },
  ];
  const fixedChars = header.length + footer.length + 2;
  const available = Math.max(0, maxChars - fixedChars);
  const labelReserve = blocks.reduce((sum, block) => sum + block.label.length + 1, 0);
  const bodyBudget = Math.max(0, available - labelReserve);

  // Keep the newest lines that fit, walking the lists backwards (oldest → newest).
  const kept: Array<{ block: number; line: string }> = [];
  let used = 0;
  outer: for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
    const lines = blocks[blockIndex]!.lines;
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      const line = lines[lineIndex]!;
      if (used + line.length + 1 > bodyBudget) break outer;
      used += line.length + 1;
      kept.push({ block: blockIndex, line });
    }
  }

  let body: string;
  if (kept.length === 0) {
    // Nothing fit beside the header/footer: keep the newest public line only.
    const newestBlock = blocks[blocks.length - 1]!;
    body = clipText(newestBlock.lines[newestBlock.lines.length - 1]!, available);
  } else {
    kept.reverse();
    const parts: string[] = [];
    let currentBlock = -1;
    for (const entry of kept) {
      if (entry.block !== currentBlock) {
        parts.push(blocks[entry.block]!.label);
        currentBlock = entry.block;
      }
      parts.push(entry.line);
    }
    body = parts.join("\n");
  }

  const rendered = `${header}\n${body}\n${footer}`;
  return rendered.length <= maxChars ? rendered : clipText(rendered, maxChars);
}

/** Approximate rendered size of one private message, tolerant of any content shape. */
function privateMessageChars(message: ModelMessage): number {
  try {
    if (typeof message.content === "string") return message.content.length;
    return JSON.stringify(message.content).length;
  } catch {
    return 0;
  }
}

/** Shortens one message body to a budget; only text content can be shortened. */
function truncateMessageContent(content: ModelMessage["content"], budget: number): ModelMessage["content"] {
  if (typeof content === "string") return clipText(content, budget);
  return content;
}

/**
 * Bounds the private match-long conversation to the supplied character budget.
 *
 * Memory is a bounded rolling window, not a growing transcript:
 * - Every move re-supplies the full current public state through a freshly
 *   rendered user observation, so evicting older private turns never loses the
 *   current transcript, tool events, or resources.
 * - Older response groups (an observation plus its assistant/tool messages) are
 *   evicted first; the newest group is kept.
 * - The window is never summarized. No synthetic "memory" or chain-of-thought
 *   recap is invented; the model only ever sees real messages that were
 *   actually exchanged.
 * - Slicing happens only at `user` observation boundaries, so an assistant
 *   message that requested tools stays paired with its tool results.
 * - If even the newest group exceeds the budget, its newest user observation is
 *   truncated and the move's trailing response messages are dropped, which
 *   keeps a valid role sequence while enforcing a true character cap.
 *
 * Sizing uses prefix sums so the whole pass is O(n). Nothing private is ever
 * emitted publicly.
 */
export function boundPrivateMessages(messages: readonly ModelMessage[], maxChars: number): ModelMessage[] {
  if (messages.length === 0) return [];
  const sizes = new Array<number>(messages.length);
  const prefix = new Array<number>(messages.length + 1);
  prefix[0] = 0;
  for (let index = 0; index < messages.length; index += 1) {
    sizes[index] = privateMessageChars(messages[index]!);
    prefix[index + 1] = prefix[index]! + sizes[index]!;
  }
  const total = prefix[messages.length]!;
  if (total <= maxChars) return messages.slice();

  const userIndexes: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]!.role === "user") userIndexes.push(index);
  }

  let start = 0;
  if (userIndexes.length > 0) {
    start = userIndexes[userIndexes.length - 1]!;
    for (let index = userIndexes.length - 1; index >= 0; index -= 1) {
      const boundary = userIndexes[index]!;
      if (total - prefix[boundary]! > maxChars) break;
      start = boundary;
    }
  } else {
    while (start < messages.length - 1 && total - prefix[start]! > maxChars) start += 1;
  }

  if (total - prefix[start]! <= maxChars) return messages.slice(start);

  // One oversized group: keep the newest user observation, truncated to cap.
  const head = messages[start]!;
  return [{ ...head, content: truncateMessageContent(head.content, maxChars) } as ModelMessage];
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

interface ParsedJsonString {
  readonly value: string;
  readonly next: number;
  readonly complete: boolean;
  readonly invalid: boolean;
}

/** Parses just enough JSON string syntax to safely decode a streamed value. */
function parseJsonString(input: string, quoteIndex: number): ParsedJsonString {
  if (input[quoteIndex] !== '"') return { value: "", next: quoteIndex, complete: false, invalid: true };
  let value = "";
  let index = quoteIndex + 1;
  while (index < input.length) {
    const char = input[index]!;
    if (char === '"') return { value, next: index + 1, complete: true, invalid: false };
    if (char === "\\") {
      if (index + 1 >= input.length) return { value, next: input.length, complete: false, invalid: false };
      const escape = input[index + 1]!;
      const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[escape];
      if (simple !== undefined) {
        value += simple;
        index += 2;
        continue;
      }
      if (escape !== "u") return { value: "", next: index, complete: false, invalid: true };
      if (index + 6 > input.length) return { value, next: input.length, complete: false, invalid: false };
      const code = input.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(code)) return { value: "", next: index, complete: false, invalid: true };
      value += String.fromCharCode(Number.parseInt(code, 16));
      index += 6;
      continue;
    }
    if (char < " ") return { value: "", next: index, complete: false, invalid: true };
    value += char;
    index += 1;
  }
  return { value, next: input.length, complete: false, invalid: false };
}

function findSpeakContentQuote(input: string): number | undefined {
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== '"') continue;
    const parsed = parseJsonString(input, index);
    if (parsed.invalid || !parsed.complete) return undefined;
    let after = parsed.next;
    while (/\s/.test(input[after] ?? "")) after += 1;
    if (parsed.value === "content" && input[after] === ":") {
      after += 1;
      while (/\s/.test(input[after] ?? "")) after += 1;
      return input[after] === '"' ? after : undefined;
    }
    index = parsed.next - 1;
  }
  return undefined;
}

function safeDecodedPrefix(value: string): string {
  const last = value.charCodeAt(value.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? value.slice(0, -1) : value;
}

function decodeSpeakContent(input: string): { readonly text: string; readonly invalid: boolean } | undefined {
  const quote = findSpeakContentQuote(input);
  if (quote === undefined) return undefined;
  const parsed = parseJsonString(input, quote);
  if (parsed.invalid) return { text: "", invalid: true };
  return { text: safeDecodedPrefix(parsed.value), invalid: false };
}

/** Number of leading characters two strings share. */
function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

/**
 * Server-owned Standard agent session backed by the AI SDK v7 `ToolLoopAgent`.
 *
 * One session is created per side per match. The model is built lazily (once)
 * through {@link createWebModel} with the stable `<matchId>:agent-a|b` session
 * key, and the match-long `privateMessages` conversation is kept here as a
 * bounded rolling window (see {@link boundPrivateMessages}). Native tools
 * execute through the injected local server registry executor; the internal
 * `speak` tool captures the public move and stops the loop. No private model
 * content is ever surfaced publicly.
 */
export function createWebStandardAgentSession(input: StandardAgentSessionFactoryInput): StandardAgentSession {
  const maxContextChars = input.maxContextChars ?? DEFAULT_MAX_PRIVATE_CONTEXT_CHARS;
  let privateMessages: ModelMessage[] = [];
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
    const invocationId = `${toolName}:${reserved}`;
    if (reserved > state.maxAffordableTools) {
      const output =
        `The tool budget for this move is exhausted (${state.maxAffordableTools} call(s) allowed). ` +
        "Use the results you already have and call speak.";
      // Publish at most one over-budget rejection per move. The failure stays
      // visible once, and repeated zero-budget attempts cannot be used to flood
      // the public record for free.
      if (reserved > state.maxAffordableTools + 1) {
        return { ok: false, output, error: "Tool budget exhausted" };
      }
      // An over-budget attempt is not executed, but it still becomes a public
      // failure event so it is neither invisible nor silently re-tried.
      const event: StandardAgentToolEvent = {
        tool: toolName,
        query,
        output,
        ok: false,
        error: "Tool budget exhausted",
        rejected: true,
      };
      state.onProgress?.({ type: "tool-start", invocationId, tool: toolName, query });
      state.onProgress?.({
        type: "tool-result",
        invocationId,
        tool: toolName,
        query,
        output: event.output,
        ok: false,
        error: event.error,
        rejected: true,
      });
      state.toolEvents[reserved - 1] = event;
      return { ok: false, output, error: event.error };
    }
    state.onProgress?.({ type: "tool-start", invocationId, tool: toolName, query });
    let result: StandardToolResult;
    try {
      result = await state.runTool(
        toolName,
        { query, ...(language ? { language } : {}), timeoutMs: state.toolTimeoutMs },
        signal,
      );
    } catch {
      result = { ok: false, output: "The tool could not be executed.", error: "Tool execution failed" };
    }
    const event = toToolEvent(toolName, query, result);
    state.onProgress?.({
      type: "tool-result",
      invocationId,
      tool: toolName,
      query,
      output: event.output,
      ok: event.ok,
      ...(event.error ? { error: event.error } : {}),
    });
    state.toolEvents[reserved - 1] = event;
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
        if (!state) return { ok: false, error: "No active Standard move" };
        if (state.speak) {
          // A move must deliver exactly one public speech; a second call is a
          // protocol violation, not a silently ignored extra.
          state.duplicateSpeak = true;
          return { ok: false, error: "speak was already called for this move" };
        }
        state.speak = { content: args.content, ready: args.ready === true };
        // Emit the public content not streamed yet. Normally the deltas are an
        // exact prefix of the validated content; if the provider's parsed input
        // differs (repair, duplicate keys), resume after the shared prefix so
        // the caption is never left with stale partial words. Private
        // text/reasoning is never read here.
        const sharedPrefix = sharedPrefixLength(state.streamedSpeakText, args.content);
        const suffix = args.content.slice(sharedPrefix);
        if (suffix) state.onProgress?.({ type: "speech", text: suffix });
        state.streamedSpeakText = args.content;
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
        runTool: moveInput.runTool,
        onProgress: moveInput.onProgress,
        reserved: 0,
        toolEvents: [],
        speak: null,
        duplicateSpeak: false,
        speakInputId: null,
        speakInputBuffer: "",
        streamedSpeakText: "",
        speakInputDecodeFailed: false,
      };
      move = state;

      const observation: ModelMessage = {
        role: "user",
        content: renderObservation(moveInput, Math.min(maxContextChars, MAX_OBSERVATION_CHARS)),
      };
      const agent = await getAgent();
      const result = await agent.stream({
        // Bound the request as well as stored history so one large public
        // transcript cannot push the private conversation past the budget.
        messages: boundPrivateMessages([...privateMessages, observation], maxContextChars),
        abortSignal: moveInput.abortSignal,
      });

      // Text and reasoning are private: the public speech must arrive through
      // the speak tool, and a missing speak is a protocol error.
      for await (const part of result.stream) {
        // Latch onto the first streamed speak call only. A duplicate speak is a
        // protocol error handled after the stream; ignoring its deltas here
        // keeps the first speech's text from being mixed or re-emitted.
        if (part.type === "tool-input-start" && part.toolName === "speak" && state.speakInputId === null) {
          state.speakInputId = part.id;
          state.speakInputBuffer = "";
          state.streamedSpeakText = "";
          state.speakInputDecodeFailed = false;
        } else if (
          part.type === "tool-input-delta" &&
          part.id === state.speakInputId &&
          !state.speakInputDecodeFailed
        ) {
          state.speakInputBuffer += part.delta;
          const decoded = decodeSpeakContent(state.speakInputBuffer);
          if (decoded?.invalid) {
            state.speakInputDecodeFailed = true;
          } else if (decoded && decoded.text.startsWith(state.streamedSpeakText)) {
            const suffix = decoded.text.slice(state.streamedSpeakText.length);
            if (suffix) state.onProgress?.({ type: "speech", text: suffix });
            state.streamedSpeakText = decoded.text;
          }
        }
      }

      privateMessages.push(observation);
      const responseMessages = await result.responseMessages;
      privateMessages.push(...responseMessages);
      privateMessages = boundPrivateMessages(privateMessages, maxContextChars);

      if (state.duplicateSpeak) throw new Error("Standard agent called the speak tool more than once");
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
        toolEvents: state.toolEvents.filter(
          (event): event is StandardAgentToolEvent => event !== undefined,
        ),
        ...(usage ? { usage } : {}),
      };
    },
  };
}
