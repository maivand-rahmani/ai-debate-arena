import { describe, expect, it } from "vitest";
import {
  ACTIVE_TOKEN_POLICY,
  AGENT_MAX_OUTPUT_TOKENS,
  JUDGE_MAX_OUTPUT_TOKENS,
  MATCH_TIMEOUT_MS,
  TOKEN_POLICIES,
  getTokenPolicy,
} from "./token-policy";

describe("token policy", () => {
  it("keeps Quick active with the P0 limits", () => {
    expect(ACTIVE_TOKEN_POLICY.name).toBe("Quick");
    expect(ACTIVE_TOKEN_POLICY.agentMaxOutputTokens).toBe(AGENT_MAX_OUTPUT_TOKENS);
    expect(ACTIVE_TOKEN_POLICY.judgeMaxOutputTokens).toBe(JUDGE_MAX_OUTPUT_TOKENS);
    expect(AGENT_MAX_OUTPUT_TOKENS).toBe(2000);
    expect(JUDGE_MAX_OUTPUT_TOKENS).toBe(2000);
  });

  it("gives the Quick judge a 2000-token budget while keeping the agent budget at 2000", () => {
    expect(TOKEN_POLICIES.Quick.judgeMaxOutputTokens).toBe(2000);
    expect(TOKEN_POLICIES.Quick.agentMaxOutputTokens).toBe(2000);
    expect(getTokenPolicy("Quick").judgeMaxOutputTokens).toBe(2000);
  });

  it("defines rounds, context, and history budgets per policy", () => {
    expect(TOKEN_POLICIES.Quick).toMatchObject({ rounds: 4, maxContextChars: 12000, maxHistoryTurns: 6 });
    expect(TOKEN_POLICIES.Standard).toMatchObject({ rounds: 4, maxContextChars: 24000, maxHistoryTurns: 10 });
    expect(TOKEN_POLICIES.Hardcore).toMatchObject({ rounds: 4, maxContextChars: 48000, maxHistoryTurns: 16 });
  });

  it("scales budgets up across tiers", () => {
    const tiers = [TOKEN_POLICIES.Quick, TOKEN_POLICIES.Standard, TOKEN_POLICIES.Hardcore];
    for (const key of ["agentMaxOutputTokens", "judgeMaxOutputTokens", "maxContextChars", "maxHistoryTurns"] as const) {
      expect(tiers[0][key]).toBeLessThanOrEqual(tiers[1][key]);
      expect(tiers[1][key]).toBeLessThanOrEqual(tiers[2][key]);
    }
  });

  it("bounds streamed matches with a lifecycle timeout", () => {
    expect(MATCH_TIMEOUT_MS).toBe(180_000);
  });
});
