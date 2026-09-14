import { describe, expect, it } from "vitest";
import {
  ACTIVE_TOKEN_POLICY,
  AGENT_MAX_OUTPUT_TOKENS,
  JUDGE_MAX_CONTEXT_CHARS,
  JUDGE_MAX_OUTPUT_TOKENS,
  MATCH_PROFILES,
  MATCH_TIMEOUT_MS,
  STANDARD_DEFAULT_LIMITS,
  STANDARD_DEFAULT_TOOL_TIMEOUT_SECONDS,
  STANDARD_LIMIT_BOUNDS,
  STANDARD_MAX_MOVES,
  STANDARD_MAX_TOOL_CALLS_PER_MOVE,
  STANDARD_SPEECH_COST,
  STANDARD_STARTING_CREDITS,
  STANDARD_TOOL_COST,
  STANDARD_TOOL_TIMEOUT_MS,
  TOKEN_POLICIES,
  getMatchProfile,
  getTokenPolicy,
  resolveStandardLimits,
} from "../src/token-policy";

describe("token policy", () => {
  it("keeps Quick active with the P0 limits", () => {
    expect(ACTIVE_TOKEN_POLICY.name).toBe("Quick");
    expect(ACTIVE_TOKEN_POLICY.agentMaxOutputTokens).toBe(AGENT_MAX_OUTPUT_TOKENS);
    expect(ACTIVE_TOKEN_POLICY.judgeMaxOutputTokens).toBe(JUDGE_MAX_OUTPUT_TOKENS);
    expect(AGENT_MAX_OUTPUT_TOKENS).toBe(3000);
    expect(JUDGE_MAX_OUTPUT_TOKENS).toBe(4000);
    expect(JUDGE_MAX_CONTEXT_CHARS).toBe(24_000);
  });

  it("leaves both the Quick judge and agents room for complete visible answers", () => {
    expect(TOKEN_POLICIES.Quick.judgeMaxOutputTokens).toBe(4000);
    expect(TOKEN_POLICIES.Quick.agentMaxOutputTokens).toBe(3000);
    expect(getTokenPolicy("Quick").judgeMaxOutputTokens).toBe(4000);
  });

  it("defines rounds, context, and history budgets per policy", () => {
    expect(TOKEN_POLICIES.Quick).toMatchObject({ rounds: 6, maxContextChars: 18000, maxHistoryTurns: 8 });
    expect(TOKEN_POLICIES.Standard).toMatchObject({ rounds: 12, maxContextChars: 24000, maxHistoryTurns: 10 });
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
    expect(MATCH_TIMEOUT_MS).toBe(420_000);
  });
});

describe("match profiles", () => {
  it("defines Quick as a six-turn exchange with enough context for the full transcript", () => {
    expect(MATCH_PROFILES.quick).toEqual({
      mode: "quick",
      enabled: true,
      rounds: 6,
      agentMaxOutputTokens: 3000,
      judgeMaxOutputTokens: 4000,
      historyTurns: 8,
      maxContextCharsPerSide: 18000,
    });
    expect(getMatchProfile("quick")).toBe(MATCH_PROFILES.quick);
  });

  it("keeps standard/hardcore disabled with sensible budgets", () => {
    expect(MATCH_PROFILES.standard.enabled).toBe(true);
    expect(MATCH_PROFILES.hardcore.enabled).toBe(false);
    expect(MATCH_PROFILES.standard).toMatchObject({ rounds: STANDARD_MAX_MOVES, historyTurns: 10 });
    expect(MATCH_PROFILES.hardcore).toMatchObject({ rounds: 4, agentMaxOutputTokens: 5000 });
  });
});

describe("Standard resource policy", () => {
  it("starts each side with the same credits and prices speeches below tools", () => {
    expect(STANDARD_STARTING_CREDITS).toBe(12);
    expect(STANDARD_SPEECH_COST).toBe(1);
    expect(STANDARD_TOOL_COST).toBe(2);
    expect(STANDARD_SPEECH_COST).toBeLessThan(STANDARD_TOOL_COST);
  });

  it("allows at most two tools per move and uses the emergency ceiling as the Standard rounds value", () => {
    expect(STANDARD_MAX_TOOL_CALLS_PER_MOVE).toBe(2);
    expect(STANDARD_MAX_MOVES).toBe(12);
    expect(MATCH_PROFILES.standard.rounds).toBe(STANDARD_MAX_MOVES);
  });
});

describe("Standard tunable limits", () => {
  it("keeps the default 12 credits, 2 tools per move, and 8s timeout", () => {
    expect(STANDARD_TOOL_TIMEOUT_MS).toBe(8_000);
    expect(STANDARD_DEFAULT_TOOL_TIMEOUT_SECONDS).toBe(8);
    expect(STANDARD_DEFAULT_LIMITS).toEqual({ startingCredits: 12, maxToolsPerMove: 2, toolTimeoutMs: 8_000 });
    expect(resolveStandardLimits()).toEqual(STANDARD_DEFAULT_LIMITS);
    expect(resolveStandardLimits({})).toEqual(STANDARD_DEFAULT_LIMITS);
  });

  it("publishes the selected inclusive bounds", () => {
    expect(STANDARD_LIMIT_BOUNDS).toEqual({
      startingCredits: { min: 1, max: 64 },
      maxToolsPerMove: { min: 0, max: 4 },
      toolTimeoutSeconds: { min: 1, max: 60 },
    });
  });

  it("resolves partial custom values and converts seconds to milliseconds", () => {
    expect(resolveStandardLimits({ startingCredits: 40 })).toEqual({
      startingCredits: 40,
      maxToolsPerMove: 2,
      toolTimeoutMs: 8_000,
    });
    expect(resolveStandardLimits({ maxToolsPerMove: 4, toolTimeoutSeconds: 60 })).toEqual({
      startingCredits: 12,
      maxToolsPerMove: 4,
      toolTimeoutMs: 60_000,
    });
  });

  it("accepts every boundary value", () => {
    expect(resolveStandardLimits({ startingCredits: 1, maxToolsPerMove: 0, toolTimeoutSeconds: 1 })).toEqual({
      startingCredits: 1,
      maxToolsPerMove: 0,
      toolTimeoutMs: 1_000,
    });
    expect(resolveStandardLimits({ startingCredits: 64, maxToolsPerMove: 4, toolTimeoutSeconds: 60 })).toEqual({
      startingCredits: 64,
      maxToolsPerMove: 4,
      toolTimeoutMs: 60_000,
    });
  });

  it("rejects out-of-bounds and non-integer values with a descriptive error", () => {
    expect(() => resolveStandardLimits({ startingCredits: 0 })).toThrow(/startingCredits/);
    expect(() => resolveStandardLimits({ startingCredits: 65 })).toThrow(/startingCredits/);
    expect(() => resolveStandardLimits({ startingCredits: 1.5 })).toThrow(/startingCredits/);
    expect(() => resolveStandardLimits({ maxToolsPerMove: -1 })).toThrow(/maxToolsPerMove/);
    expect(() => resolveStandardLimits({ maxToolsPerMove: 5 })).toThrow(/maxToolsPerMove/);
    expect(() => resolveStandardLimits({ toolTimeoutSeconds: 0 })).toThrow(/toolTimeoutSeconds/);
    expect(() => resolveStandardLimits({ toolTimeoutSeconds: 61 })).toThrow(/toolTimeoutSeconds/);
  });
});

