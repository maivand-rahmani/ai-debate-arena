import { describe, expect, it } from "vitest";
import {
  ACTIVE_TOKEN_POLICY,
  AGENT_MAX_OUTPUT_TOKENS,
  JUDGE_MAX_CONTEXT_CHARS,
  JUDGE_MAX_OUTPUT_TOKENS,
  MATCH_PROFILES,
  MATCH_TIMEOUT_MS,
  TOKEN_POLICIES,
  getMatchProfile,
  getTokenPolicy,
} from "../src/token-policy";

describe("token policy", () => {
  it("keeps Quick active with the P0 limits", () => {
    expect(ACTIVE_TOKEN_POLICY.name).toBe("Quick");
    expect(ACTIVE_TOKEN_POLICY.agentMaxOutputTokens).toBe(AGENT_MAX_OUTPUT_TOKENS);
    expect(ACTIVE_TOKEN_POLICY.judgeMaxOutputTokens).toBe(JUDGE_MAX_OUTPUT_TOKENS);
    expect(AGENT_MAX_OUTPUT_TOKENS).toBe(1200);
    expect(JUDGE_MAX_OUTPUT_TOKENS).toBe(1000);
    expect(JUDGE_MAX_CONTEXT_CHARS).toBe(24_000);
  });

  it("keeps the Quick judge compact while leaving agents room for a complete speech", () => {
    expect(TOKEN_POLICIES.Quick.judgeMaxOutputTokens).toBe(1000);
    expect(TOKEN_POLICIES.Quick.agentMaxOutputTokens).toBe(1200);
    expect(getTokenPolicy("Quick").judgeMaxOutputTokens).toBe(1000);
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

describe("match profiles", () => {
  it("keeps quick byte-identical to the v0.1 Quick policy with 2 turns per side", () => {
    expect(MATCH_PROFILES.quick).toEqual({
      mode: "quick",
      enabled: true,
      rounds: 4,
      agentMaxOutputTokens: 1200,
      judgeMaxOutputTokens: 1000,
      historyTurns: 6,
      maxContextCharsPerSide: 12000,
    });
    expect(getMatchProfile("quick")).toBe(MATCH_PROFILES.quick);
  });

  it("keeps standard/hardcore disabled with sensible budgets", () => {
    expect(MATCH_PROFILES.standard.enabled).toBe(false);
    expect(MATCH_PROFILES.hardcore.enabled).toBe(false);
    expect(MATCH_PROFILES.standard).toMatchObject({ rounds: 4, historyTurns: 10 });
    expect(MATCH_PROFILES.hardcore).toMatchObject({ rounds: 4, agentMaxOutputTokens: 3000 });
  });
});

