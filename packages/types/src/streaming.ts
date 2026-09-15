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
  /**
   * Present and true when the call was refused before execution (for example,
   * the move's affordable tool budget was already spent). Rejected attempts are
   * public failures but are not priced tool executions.
   */
  readonly rejected?: boolean;
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
  /** Executed tool calls this side has paid for across the match. */
  readonly toolsUsed: number;
  /** Executed tool calls folded into this side's most recent move. */
  readonly toolsUsedThisMove: number;
  /**
   * Refused (over-budget) attempts this side made across the match. These are
   * public failures that were never executed and never charged.
   */
  readonly toolsRejected?: number;
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
  /**
   * Cumulative `ready` intent signalled by each side in a non-closing open
   * round. Opening-move readiness is ignored by the protocol; the snapshot only
   * reports intents that actually influenced the lifecycle. Optional because
   * v1 snapshot events written before this field existed must stay readable;
   * consumers normalize a missing value to "not ready".
   */
  readonly ready?: {
    readonly A: boolean;
    readonly B: boolean;
  };
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

/**
 * Bounded, public judge-review checkpoints. These describe observable progress
 * through the judge pipeline only: no prompt, chain-of-thought, partial tokens,
 * draft scores, likely winner, or hidden ranking is ever part of this payload.
 */
export type DebateStreamJudgeActivityStage =
  | "record-loaded"
  | "evidence-check"
  | "rubric-check"
  | "comparing";

export interface DebateStreamJudgeActivity {
  readonly stage: DebateStreamJudgeActivityStage;
  /** Sealed public turns the judge has loaded into the record. */
  readonly turnCount: number;
  /** Public evidence attempts (executed and refused) the record carries. */
  readonly evidenceCount: number;
  /** Public evidence attempts that succeeded (`ok` and not refused). */
  readonly successfulEvidenceCount: number;
  /** Fixed rubric criterion names; never judge-authored. */
  readonly criteria: readonly string[];
}

export type DebateStreamEventBody =
  | { readonly type: "phase"; readonly phase: DebateStreamPhase; readonly side: DebateSide | null }
  | { readonly type: "token"; readonly side: DebateSide; readonly text: string }
  | { readonly type: "turn"; readonly turn: DebateStreamTurn }
  | { readonly type: "tool-start"; readonly tool: DebateStreamToolCall }
  | { readonly type: "tool-result"; readonly result: DebateStreamToolResult }
  | { readonly type: "standard-state"; readonly state: DebateStreamStandardState }
  | { readonly type: "judge-start" }
  | { readonly type: "judge-activity"; readonly activity: DebateStreamJudgeActivity }
  | { readonly type: "verdict"; readonly verdict: DebateStreamVerdict }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done"; readonly terminal: DebateStreamTerminal };

/** Stream contract v1: every event carries `{ v: 1, matchId, seq }`. */
export type DebateStreamEvent = DebateStreamEventBody & {
  readonly v: 1;
  readonly matchId: string;
  readonly seq: number;
};
