import type { MatchMode } from "@arena/types";

export type { MatchMode };

// Reasoning-capable models need room for both internal work and a visible
// answer. These are the pre-refactor Quick budgets that supported complete
// replies and structured verdicts reliably.
export const AGENT_MAX_OUTPUT_TOKENS = 3000;
export const JUDGE_MAX_OUTPUT_TOKENS = 4000;
/** Maximum rendered transcript size sent to the judge in the active policy. */
export const JUDGE_MAX_CONTEXT_CHARS = 24_000;

export type TokenPolicyName = "Quick" | "Standard" | "Hardcore";

/**
 * Standard match-local resource rules. Each side starts with the same pool;
 * a public speech costs one credit and every tool call costs two. A side that
 * cannot afford a speech is forced to close the match.
 */
export const STANDARD_STARTING_CREDITS = 12;
export const STANDARD_SPEECH_COST = 1;
export const STANDARD_TOOL_COST = 2;
/** Default cap on tool calls folded into a single public move (0–4 allowed). */
export const STANDARD_MAX_TOOL_CALLS_PER_MOVE = 2;
/** Default hard per-tool timeout, shared by the web and code tools. */
export const STANDARD_TOOL_TIMEOUT_MS = 8_000;
/** Default tool timeout expressed in whole seconds (the config-facing form). */
export const STANDARD_DEFAULT_TOOL_TIMEOUT_SECONDS = STANDARD_TOOL_TIMEOUT_MS / 1000;
/**
 * Emergency ceiling on total public moves (both sides combined) so a broken
 * match cannot run forever. It is not the normal game clock; credits and the
 * ready/close lifecycle decide most endings.
 */
export const STANDARD_MAX_MOVES = 12;

/**
 * Operator-tunable Standard resource limits supplied per match. Every field is
 * optional; omitted fields fall back to the defaults in
 * {@link STANDARD_DEFAULT_LIMITS}. Callers use {@link resolveStandardLimits}
 * to validate and expand the partial input.
 */
export interface StandardLimitsInput {
  /** Credits each side starts the match with. */
  readonly startingCredits?: number;
  /** Tool calls allowed within a single public move. `0` forbids tools. */
  readonly maxToolsPerMove?: number;
  /** Hard per-tool timeout in whole seconds. */
  readonly toolTimeoutSeconds?: number;
}

/** Fully resolved Standard limits the match lifecycle consumes. */
export interface StandardLimits {
  readonly startingCredits: number;
  readonly maxToolsPerMove: number;
  readonly toolTimeoutMs: number;
}

/** Inclusive integer bounds for every tunable Standard limit. */
export const STANDARD_LIMIT_BOUNDS = {
  startingCredits: { min: 1, max: 64 },
  maxToolsPerMove: { min: 0, max: 4 },
  toolTimeoutSeconds: { min: 1, max: 60 },
} as const;

/** The limits applied when a match config omits `standardLimits`. */
export const STANDARD_DEFAULT_LIMITS: StandardLimits = {
  startingCredits: STANDARD_STARTING_CREDITS,
  maxToolsPerMove: STANDARD_MAX_TOOL_CALLS_PER_MOVE,
  toolTimeoutMs: STANDARD_TOOL_TIMEOUT_MS,
};

function assertStandardLimit(
  field: keyof typeof STANDARD_LIMIT_BOUNDS,
  value: number,
  bounds: { readonly min: number; readonly max: number },
): void {
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new Error(
      `Standard ${field} must be an integer between ${bounds.min} and ${bounds.max} (received ${value})`,
    );
  }
}

/**
 * Validates a partial Standard limits input and fills omitted fields with the
 * defaults. Throws a descriptive `Error` when a supplied value is outside its
 * inclusive bound, so direct engine callers get the same enforcement as the
 * API schema.
 */
export function resolveStandardLimits(input: StandardLimitsInput = {}): StandardLimits {
  const startingCredits = input.startingCredits ?? STANDARD_STARTING_CREDITS;
  const maxToolsPerMove = input.maxToolsPerMove ?? STANDARD_MAX_TOOL_CALLS_PER_MOVE;
  const toolTimeoutSeconds = input.toolTimeoutSeconds ?? STANDARD_DEFAULT_TOOL_TIMEOUT_SECONDS;
  assertStandardLimit("startingCredits", startingCredits, STANDARD_LIMIT_BOUNDS.startingCredits);
  assertStandardLimit("maxToolsPerMove", maxToolsPerMove, STANDARD_LIMIT_BOUNDS.maxToolsPerMove);
  assertStandardLimit("toolTimeoutSeconds", toolTimeoutSeconds, STANDARD_LIMIT_BOUNDS.toolTimeoutSeconds);
  return { startingCredits, maxToolsPerMove, toolTimeoutMs: toolTimeoutSeconds * 1000 };
}

export interface MatchProfile {
  readonly mode: MatchMode;
  /** Quick and the local Standard slice are enabled; Hardcore stays disabled. */
  readonly enabled: boolean;
  /**
   * Total agent turns for a fixed format (Quick). For variable-length
   * Standard this is the emergency move ceiling, not a target.
   */
  readonly rounds: number;
  readonly agentMaxOutputTokens: number;
  readonly judgeMaxOutputTokens: number;
  readonly historyTurns: number;
  readonly maxContextCharsPerSide: number;
}

export const MATCH_PROFILES: Readonly<Record<MatchMode, MatchProfile>> = {
  quick: {
    mode: "quick",
    enabled: true,
    rounds: 6,
    agentMaxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
    judgeMaxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    historyTurns: 8,
    maxContextCharsPerSide: 18000,
  },
  standard: {
    mode: "standard",
    enabled: true,
    rounds: STANDARD_MAX_MOVES,
    agentMaxOutputTokens: 3500,
    judgeMaxOutputTokens: 4500,
    historyTurns: 10,
    maxContextCharsPerSide: 24000,
  },
  hardcore: {
    mode: "hardcore",
    enabled: false,
    rounds: 4,
    agentMaxOutputTokens: 5000,
    judgeMaxOutputTokens: 6000,
    historyTurns: 16,
    maxContextCharsPerSide: 48000,
  },
};

export function getMatchProfile(mode: MatchMode): MatchProfile {
  return MATCH_PROFILES[mode];
}

export interface TokenPolicy {
  readonly name: TokenPolicyName;
  readonly agentMaxOutputTokens: number;
  readonly judgeMaxOutputTokens: number;
  readonly rounds: number;
  readonly maxContextChars: number;
  readonly maxHistoryTurns: number;
}

const PROFILE_NAMES: Readonly<Record<MatchMode, TokenPolicyName>> = {
  quick: "Quick",
  standard: "Standard",
  hardcore: "Hardcore",
};

function toTokenPolicy(mode: MatchMode): TokenPolicy {
  const profile = MATCH_PROFILES[mode];
  return {
    name: PROFILE_NAMES[mode],
    agentMaxOutputTokens: profile.agentMaxOutputTokens,
    judgeMaxOutputTokens: profile.judgeMaxOutputTokens,
    rounds: profile.rounds,
    maxContextChars: profile.maxContextCharsPerSide,
    maxHistoryTurns: profile.historyTurns,
  };
}

export const TOKEN_POLICIES: Readonly<Record<TokenPolicyName, TokenPolicy>> = {
  Quick: toTokenPolicy("quick"),
  Standard: toTokenPolicy("standard"),
  Hardcore: toTokenPolicy("hardcore"),
};

/** The only policy enabled by the initial product slice. */
export const ACTIVE_TOKEN_POLICY = TOKEN_POLICIES.Quick;
export const QUICK_TOKEN_POLICY = ACTIVE_TOKEN_POLICY;

export function getTokenPolicy(name: TokenPolicyName = "Quick"): TokenPolicy {
  return TOKEN_POLICIES[name];
}

/* Match lifecycle: bounded wall-clock for a streamed match (client abort or timeout). */
export const MATCH_TIMEOUT_MS = 420_000;
