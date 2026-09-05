export * from "./types";
export * from "./state";
export * from "./prompt";
// NOTE: JUDGE_PROMPT_VERSION is re-exported through "./prompt", so the
// "./prompts" exports are listed explicitly to avoid a duplicate export.
export {
  buildAgentPrompt,
  buildAgentSystemPrompt,
  buildJudgePrompt,
  JUDGE_SYSTEM_PROMPT,
  PHASE_INSTRUCTIONS,
} from "./prompts";
export * from "./verdict";
export * from "./rubric";
export * from "./contract";
export * from "./token-policy";
// Canonical wire + streaming primitives (zero-dep `@arena/types`). The
// explicit `MatchMode` pin takes precedence over the star-exported
// `MatchMode` from both `./contract` and `./token-policy` (identical
// `"quick" | "standard" | "hardcore"` unions); without it the name would be
// ambiguous and dropped from the barrel.
export type { MatchMode } from "@arena/types";
export type {
  DebateStreamEvent,
  DebateStreamEventBody,
  DebateStreamPhase,
  DebateStreamTerminal,
  DebateStreamTurn,
  DebateStreamVerdict,
  DebateStreamVerdictCriteria,
} from "@arena/types";
