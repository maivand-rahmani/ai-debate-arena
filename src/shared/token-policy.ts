export const AGENT_MAX_OUTPUT_TOKENS = 2000;
export const JUDGE_MAX_OUTPUT_TOKENS = 2000;

export type TokenPolicyName = "Quick" | "Standard" | "Hardcore";

export interface TokenPolicy {
  readonly name: TokenPolicyName;
  readonly agentMaxOutputTokens: number;
  readonly judgeMaxOutputTokens: number;
  readonly rounds: number;
  readonly maxContextChars: number;
  readonly maxHistoryTurns: number;
}

export const TOKEN_POLICIES: Readonly<Record<TokenPolicyName, TokenPolicy>> = {
  Quick: {
    name: "Quick",
    agentMaxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
    judgeMaxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    rounds: 4,
    maxContextChars: 12000,
    maxHistoryTurns: 6,
  },
  Standard: {
    name: "Standard",
    agentMaxOutputTokens: 2000,
    judgeMaxOutputTokens: 2000,
    rounds: 4,
    maxContextChars: 24000,
    maxHistoryTurns: 10,
  },
  Hardcore: {
    name: "Hardcore",
    agentMaxOutputTokens: 3000,
    judgeMaxOutputTokens: 2000,
    rounds: 4,
    maxContextChars: 48000,
    maxHistoryTurns: 16,
  },
};

/** The only policy enabled by the initial product slice. */
export const ACTIVE_TOKEN_POLICY = TOKEN_POLICIES.Quick;
export const QUICK_TOKEN_POLICY = ACTIVE_TOKEN_POLICY;

export function getTokenPolicy(name: TokenPolicyName = "Quick"): TokenPolicy {
  return TOKEN_POLICIES[name];
}

/* Match lifecycle: bounded wall-clock for a streamed match (client abort or timeout). */
export const MATCH_TIMEOUT_MS = 180_000;
