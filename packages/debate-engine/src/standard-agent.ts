import type { DebatePosition, DebateSide, DebateTurn } from "./types";
import type {
  StandardToolCall,
  StandardToolExecutor,
  StandardToolName,
} from "./standard";

/** Token usage for one Standard move, normalized to plain counters. */
export interface StandardAgentUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * One public tool result the session produced during a move, in call order.
 * The runner owns call ids, timestamps, credit charging, and the public
 * `tool-start` / `tool-result` envelopes; the session only reports what it did.
 */
export interface StandardAgentToolEvent {
  readonly tool: StandardToolName;
  readonly query: string;
  readonly output: string;
  readonly ok: boolean;
  readonly error?: string;
  /**
   * True when the session refused the call before executing it (for example,
   * an over-budget attempt). Rejected calls are still public failure events,
   * but the runner does not charge match credits for a tool that never ran.
   */
  readonly rejected?: boolean;
}

/**
 * SDK-neutral public progress emitted while a Standard move is running.
 * `invocationId` only correlates a tool start with its result; the runner owns
 * the public call id and timestamp.
 */
export type StandardAgentProgressEvent =
  | { readonly type: "speech"; readonly text: string }
  | {
      readonly type: "tool-start";
      readonly invocationId: string;
      readonly tool: StandardToolName;
      readonly query: string;
    }
  | {
      readonly type: "tool-result";
      readonly invocationId: string;
      readonly tool: StandardToolName;
      readonly query: string;
      readonly output: string;
      readonly ok: boolean;
      readonly error?: string;
      /** Mirrors {@link StandardAgentToolEvent.rejected} onto the public event. */
      readonly rejected?: boolean;
    };

export type StandardAgentProgressCallback = (event: StandardAgentProgressEvent) => void;

/**
 * The engine's per-move observation handed to a Standard agent session.
 *
 * Everything is either public match state (`observation`, `publicToolEvents`)
 * or the match-local resources the runner owns. The session decides how to
 * observe, choose actions, run tools, consume results, adapt, and finally
 * speak; the runner does not script that order.
 */
export interface StandardAgentMoveInput {
  readonly topic: string;
  /** Public transcript observed before this move. */
  readonly observation: readonly DebateTurn[];
  /** Format-owned turn id for this move. */
  readonly phase: string;
  readonly side: DebateSide;
  readonly position: DebatePosition;
  /** Credits the side holds before the move. */
  readonly credits: number;
  /** Cost of the public speech in credits. */
  readonly speechCost: number;
  /** Cost of one tool call in credits. */
  readonly toolCost: number;
  /** Configured cap on tool calls folded into this move. */
  readonly maxToolsPerMove: number;
  /** Tool calls affordable after reserving one speech (`≤ maxToolsPerMove`). */
  readonly maxAffordableTools: number;
  /** Hard per-tool timeout forwarded to the executor. */
  readonly toolTimeoutMs: number;
  /** True when this is the final paired round before the match closes. */
  readonly closingRound: boolean;
  /**
   * Every public tool event produced earlier in the match, from both sides, in
   * order. Tool calls and results are public match state, so a session may
   * observe the opponent's research; it still keeps its own private model
   * conversation and working context.
   */
  readonly publicToolEvents: readonly StandardToolCall[];
  /** Executes one registered tool behind the local server boundary. */
  readonly runTool: StandardToolExecutor;
  /** Receives public semantic progress before this move resolves. */
  readonly onProgress?: StandardAgentProgressCallback;
  readonly abortSignal?: AbortSignal;
}

export interface StandardAgentMoveResult {
  /** Public speech delivered by this move. */
  readonly speech: string;
  /** Side's ready intent, expressed when it chose to finish the match. */
  readonly ready: boolean;
  /** Normalized tool events in call order. */
  readonly toolEvents: readonly StandardAgentToolEvent[];
  readonly usage?: StandardAgentUsage;
  /** Optional streamed speech chunks; empty means one whole-speech token. */
  readonly chunks?: readonly string[];
}

/**
 * One match-long, private agent session for a single Standard side. Managed by
 * the runner across every move; the same instance keeps the side's model
 * conversation and working context for the whole match.
 */
export interface StandardAgentSession {
  /** Observe, run the tool loop, and deliver one public move. */
  move(input: StandardAgentMoveInput): Promise<StandardAgentMoveResult>;
}

export interface StandardAgentSessionFactoryInput {
  readonly matchId: string;
  readonly topic: string;
  readonly side: DebateSide;
  readonly position: DebatePosition;
  readonly providerId: string;
  readonly model: string;
  /** Hard per-move output-token budget for this side's model calls. */
  readonly maxOutputTokens: number;
  /**
   * Optional bound on the private match-long conversation a session may retain
   * across moves. The runner supplies the mode profile's per-side context
   * budget so a long Standard match cannot grow memory without limit. Sessions
   * may fall back to their own default when omitted.
   */
  readonly maxContextChars?: number;
  /** Stable per-conversation key: `<matchId>:agent-a` or `<matchId>:agent-b`. */
  readonly sessionKey: string;
}

/**
 * Creates one match-long session per side. Injected by the host (the local web
 * server binds the AI SDK adapter here); the engine never imports a model SDK.
 * The runner calls this exactly once per side and reuses the session.
 */
export type StandardAgentSessionFactory = (
  input: StandardAgentSessionFactoryInput,
) => StandardAgentSession;
