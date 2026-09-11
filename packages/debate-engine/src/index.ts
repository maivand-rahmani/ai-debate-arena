export * from "./types";
export * from "./state";
export * from "./prompts";
export * from "./verdict";
export * from "./rubric";
export * from "./contract";
export * from "./token-policy";
// v0.4 evidence/capability contracts (runtime Zod schemas + validators).
export * from "./evidence-contract";
// v0.4 bounded post-match challenge contracts + runner.
export * from "./challenge-contract";
export * from "./challenge-runner";
// v0.4 F10-09/F10-10 safe source-adapter foundation (contracts + pure ingest).
export * from "./source-adapter-contract";
export * from "./source-adapter-ingest";
// v0.4 F10-16/F10-17/F10-18 sandbox adapter contracts + pure proof adapters.
export * from "./sandbox-adapter-contract";
export * from "./proof-adapters/content-hash-proof";
// Runner (pure orchestration: runDebate/runJudge + stream envelope + usage
// math). `callModel` is a required injected dep; `saveMatch` is optional.
// NOTE: "./runner" re-exports the canonical `DebateStream*` wire types from
// `@arena/types` under the same names the explicit list below pins. Explicit
// named exports take precedence over the star export, and both resolve to
// the identical canonical types, so no name is silently dropped.
export * from "./runner";
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
// v0.4 canonical evidence/capability/event shapes (zero-dep `@arena/types`;
// runtime schemas live in `./evidence-contract`).
export type {
  CapabilityRequest,
  ChallengeAdjudication,
  ChallengeAgentResponse,
  ChallengeEvidenceAssessment,
  ChallengeState,
  Claim,
  Challenge,
  ChallengeResponse,
  EvidenceBundle,
  EvidenceEvent,
  EvidenceEventBody,
  EvidenceItem,
  EvidenceStatus,
  MatchChallenge,
  Provenance,
  ProofResult,
  SandboxAdapterManifest,
  SandboxAdapterRequest,
  SandboxAdapterResult,
  SandboxAdapterStatus,
  SandboxCleanupReceipt,
  SandboxResourceLimits,
  SandboxResourceUsage,
  SandboxCapabilities,
  SandboxPermission,
  SourceAccessAudit,
  SourceAdapterKind,
  SourceAdapterManifest,
  SourceAdapterRequest,
  SourceConsent,
  SourceFreshnessPolicy,
  SourceSnapshot,
} from "@arena/types";
