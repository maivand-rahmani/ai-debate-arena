import type { MatchMode } from "@arena/types";

export type { MatchMode };

// Reasoning-capable models need room for both internal work and a visible
// answer. These are the pre-refactor Quick budgets that supported complete
// replies and structured verdicts reliably.
export const AGENT_MAX_OUTPUT_TOKENS = 2000;
export const JUDGE_MAX_OUTPUT_TOKENS = 2000;
/** Maximum rendered transcript size sent to the judge in the active policy. */
export const JUDGE_MAX_CONTEXT_CHARS = 24_000;

export type TokenPolicyName = "Quick" | "Standard" | "Hardcore";

export interface MatchProfile {
  readonly mode: MatchMode;
  /** Only `quick` is enabled in the UI; other tiers stay server-rejected. */
  readonly enabled: boolean;
  /** Total agent turns per match (2 per side in quick). */
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
    rounds: 4,
    agentMaxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
    judgeMaxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    historyTurns: 6,
    maxContextCharsPerSide: 12000,
  },
  standard: {
    mode: "standard",
    enabled: false,
    rounds: 4,
    agentMaxOutputTokens: 2000,
    judgeMaxOutputTokens: 2000,
    historyTurns: 10,
    maxContextCharsPerSide: 24000,
  },
  hardcore: {
    mode: "hardcore",
    enabled: false,
    rounds: 4,
    agentMaxOutputTokens: 3000,
    judgeMaxOutputTokens: 2000,
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
export const MATCH_TIMEOUT_MS = 180_000;
