import { z } from "zod";
import { debateVerdictSchema } from "./verdict";
import { standardToolCallSchema, type StandardToolCall } from "./standard";
import { STANDARD_LIMIT_BOUNDS } from "./token-policy";

/** Version of every contract in this module. Bump on any shape change. */
export const CONTRACT_VERSION = 1;

export const matchModeSchema = z.enum(["quick", "standard", "hardcore"]);
export type MatchMode = z.infer<typeof matchModeSchema>;

const matchAgentSchema = z.object({
  providerId: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(200),
  position: z.enum(["FOR", "AGAINST"]),
});

/**
 * Optional per-match Standard resource limits. Every field may be omitted, in
 * which case the engine default applies. Present fields are range-checked here
 * at the API boundary; the engine re-checks with the same bounds in
 * `resolveStandardLimits`.
 */
export const standardLimitsSchema = z.object({
  startingCredits: z
    .number()
    .int()
    .min(STANDARD_LIMIT_BOUNDS.startingCredits.min)
    .max(STANDARD_LIMIT_BOUNDS.startingCredits.max)
    .optional(),
  maxToolsPerMove: z
    .number()
    .int()
    .min(STANDARD_LIMIT_BOUNDS.maxToolsPerMove.min)
    .max(STANDARD_LIMIT_BOUNDS.maxToolsPerMove.max)
    .optional(),
  toolTimeoutSeconds: z
    .number()
    .int()
    .min(STANDARD_LIMIT_BOUNDS.toolTimeoutSeconds.min)
    .max(STANDARD_LIMIT_BOUNDS.toolTimeoutSeconds.max)
    .optional(),
});

/** API input contract for `POST /api/debate` (same body rules as v0.1). */
export const matchConfigSchema = z.object({
  topic: z.string().trim().min(1).max(2000),
  mode: matchModeSchema,
  agentA: matchAgentSchema,
  agentB: matchAgentSchema,
  /** Standard-only: optional resource/tool bounds; ignored by other modes. */
  standardLimits: standardLimitsSchema.optional(),
});
export type MatchConfig = z.infer<typeof matchConfigSchema>;

export const transcriptTurnSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  side: z.enum(["A", "B"]),
  // Format-owned turn ids are deliberately open-ended; historical phase ids
  // remain valid so local match history stays readable after new formats land.
  phase: z.string().min(1),
  content: z.string(),
  model: z.string(),
  createdAt: z.string(),
});
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

export const transcriptSchema = z.array(transcriptTurnSchema);
export type Transcript = z.infer<typeof transcriptSchema>;
export const standardToolEventsSchema = z.array(standardToolCallSchema);
export type StandardToolEventRecord = StandardToolCall;

/** Reference to the canonical verdict schema (see `verdict.ts`). */
export const verdictSchemaRef = debateVerdictSchema;
export type ContractVerdict = z.infer<typeof verdictSchemaRef>;

export const matchProfileSchema = z.object({
  mode: matchModeSchema,
  enabled: z.boolean(),
  rounds: z.number().int().min(1),
  agentMaxOutputTokens: z.number().int().min(1),
  judgeMaxOutputTokens: z.number().int().min(1),
  historyTurns: z.number().int().min(0),
  maxContextCharsPerSide: z.number().int().min(1),
});
export type MatchProfileRecord = z.infer<typeof matchProfileSchema>;

export const matchSideSchema = z.object({
  providerName: z.string().min(1),
  modelId: z.string().min(1),
  position: z.enum(["FOR", "AGAINST"]),
});
export type MatchSideRecord = z.infer<typeof matchSideSchema>;

export const matchTerminalSchema = z.enum(["completed", "error", "cancelled"]);
export type MatchTerminal = z.infer<typeof matchTerminalSchema>;

/** Judge identity used for controlled re-judge (ids only — never secrets). */
export const matchJudgeSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
});
export type MatchJudgeRef = z.infer<typeof matchJudgeSchema>;

export const tokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/** Persisted match record (one JSON file per match, no secrets). */
export const matchRecordSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  matchId: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  topic: z.string().min(1),
  mode: matchModeSchema,
  sides: z.object({ A: matchSideSchema, B: matchSideSchema }),
  judge: matchJudgeSchema.optional(),
  judgedAt: z.string().min(1).optional(),
  policy: matchProfileSchema,
  promptVersions: z.object({ agent: z.string().min(1), judge: z.string().min(1) }),
  rubricVersion: z.string().min(1),
  transcript: transcriptSchema,
  toolEvents: standardToolEventsSchema.optional(),
  verdict: verdictSchemaRef.nullable(),
  terminal: matchTerminalSchema,
  terminalReason: z.string().nullable(),
  metrics: z.object({
    turnsMs: z.array(z.number()),
    totalMs: z.number(),
    judgeMs: z.number().optional(),
    usage: tokenUsageSchema.optional(),
  }),
});
export type MatchRecord = z.infer<typeof matchRecordSchema>;
