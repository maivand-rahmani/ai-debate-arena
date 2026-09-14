export * from "./types";
export * from "./state";
export * from "./prompts";
export * from "./verdict";
export * from "./rubric";
export * from "./contract";
export * from "./token-policy";
// Runner (pure orchestration: runDebate/runJudge + stream envelope + usage
// math). `callModel` is a required injected dep; `saveMatch` is optional.
// NOTE: "./runner" re-exports the canonical `DebateStream*` wire types from
// `@arena/types` under the same names the explicit list below pins. Explicit
// named exports take precedence over the star export, and both resolve to
// the identical canonical types, so no name is silently dropped.
export * from "./runner";
export * from "./standard";
// SDK-neutral Standard agent session port. The local server binds its model
// SDK adapter to this interface; the engine never imports a model SDK.
export * from "./standard-agent";
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
  DebateStreamSideResources,
  DebateStreamStandardState,
  DebateStreamTerminal,
  DebateStreamTurn,
  DebateStreamVerdict,
  DebateStreamVerdictCriteria,
} from "@arena/types";
