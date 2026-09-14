/**
 * Canonical streaming wire types (v0.3 P3 seed).
 *
 * Exact-shape, type-only copies of the SERVER-side event types in
 * `apps/web/src/features/run-debate/server/debate-runner.ts`
 * (`DebateEventBody` + `DebateStreamEvent` + `DebateStreamTurn`). Structural
 * copies (no imports from `@arena/debate-engine`) so this package keeps zero
 * dependencies. Client aliases in `shared/api/debate-stream.ts` are NOT
 * rewired in this phase (P5 does that).
 */

import type { DebateSide } from "./wire";

/**
 * Lifecycle markers plus format-owned turn ids. A turn id is intentionally a
 * string: formats define their own speaking order instead of extending this
 * wire contract whenever a match gains a round.
 */
export type DebateStreamPhase = string;

export type DebateStreamTerminal = "completed" | "error" | "cancelled";

export interface DebateStreamTurn {
  readonly id: string;
  readonly side: DebateSide;
  readonly phase: DebateStreamPhase;
  readonly content: string;
  readonly model: string;
  readonly createdAt: string;
}

export type DebateStreamToolName = "web_search" | "fetch_url" | "run_code";

export interface DebateStreamToolCall {
  readonly callId: string;
  readonly side: DebateSide;
  readonly tool: DebateStreamToolName;
  readonly query: string;
  readonly createdAt: string;
}

export interface DebateStreamToolResult {
  readonly callId: string;
  readonly side: DebateSide;
  readonly tool: DebateStreamToolName;
  readonly query: string;
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
  readonly createdAt: string;
}

/**
 * Public per-side Standard resource accounting at one point in a match. The
 * runner is the sole author; clients render it instead of re-deriving credits
 * from transcript and tool counts.
 */
export interface DebateStreamSideResources {
  readonly side: DebateSide;
  readonly creditsRemaining: number;
  /** Total public tool calls this side has used across the match. */
  readonly toolsUsed: number;
  /** Tool calls folded into this side's most recent move. */
  readonly toolsUsedThisMove: number;
  readonly maxToolsPerMove: number;
  /** Hard per-tool timeout in milliseconds. */
  readonly toolTimeoutMs: number;
  /** True when the side can no longer afford a public speech. */
  readonly depleted: boolean;
}

/**
 * Public Standard match snapshot: both sides' remaining resources plus the
 * shared limits/status that bound the match. Emitted after each Standard move
 * so viewers see authoritative accounting instead of a local estimate.
 */
export interface DebateStreamStandardState {
  readonly startingCredits: number;
  /** Credits charged for one public speech. */
  readonly speechCost: number;
  /** Credits charged for one tool call. */
  readonly toolCost: number;
  /** Emergency ceiling on total public moves, not the normal game clock. */
  readonly maxMoves: number;
  readonly movesUsed: number;
  readonly moveLimitReached: boolean;
  readonly closingRound: boolean;
  readonly sides: {
    readonly A: DebateStreamSideResources;
    readonly B: DebateStreamSideResources;
  };
}

export interface DebateStreamVerdictCriteria {
  readonly argumentQualityA: number;
  readonly argumentQualityB: number;
  readonly rebuttalA: number;
  readonly rebuttalB: number;
  readonly consistencyA: number;
  readonly consistencyB: number;
  readonly relevanceA: number;
  readonly relevanceB: number;
}

export interface DebateStreamVerdict {
  readonly winner: DebateSide | "DRAW";
  readonly scoreA: number;
  readonly scoreB: number;
  readonly criteria: DebateStreamVerdictCriteria;
  readonly reasoning: string;
}

export type DebateStreamEventBody =
  | { readonly type: "phase"; readonly phase: DebateStreamPhase; readonly side: DebateSide | null }
  | { readonly type: "token"; readonly side: DebateSide; readonly text: string }
  | { readonly type: "turn"; readonly turn: DebateStreamTurn }
  | { readonly type: "tool-start"; readonly tool: DebateStreamToolCall }
  | { readonly type: "tool-result"; readonly result: DebateStreamToolResult }
  | { readonly type: "standard-state"; readonly state: DebateStreamStandardState }
  | { readonly type: "judge-start" }
  | { readonly type: "verdict"; readonly verdict: DebateStreamVerdict }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done"; readonly terminal: DebateStreamTerminal };

/** Stream contract v1: every event carries `{ v: 1, matchId, seq }`. */
export type DebateStreamEvent = DebateStreamEventBody & {
  readonly v: 1;
  readonly matchId: string;
  readonly seq: number;
};
