import { z } from "zod";
import { debateVerdictSchema } from "./verdict";
import {
  evidenceExtensionsSchema,
  turnEvidenceRefsSchema,
  userEvidencePacketInputSchema,
  sourceAccessAuditSchema,
  SOURCE_AUDITS_MAX,
} from "./evidence-contract";
import {
  CHALLENGE_LIMITS,
  matchChallengeSchema,
} from "./challenge-contract";
import { evidenceEventSchema } from "./evidence-contract";

/** Version of every contract in this module. Bump on any shape change. */
export const CONTRACT_VERSION = 1;

export const matchModeSchema = z.enum(["quick", "standard", "hardcore"]);
export type MatchMode = z.infer<typeof matchModeSchema>;

const matchAgentSchema = z.object({
  providerId: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(200),
  position: z.enum(["FOR", "AGAINST"]),
});

/** API input contract for `POST /api/debate` (same body rules as v0.1). */
export const matchConfigSchema = z.object({
  topic: z.string().trim().min(1).max(2000),
  mode: matchModeSchema,
  agentA: matchAgentSchema,
  agentB: matchAgentSchema,
  // v0.4 additive (F10-06): optional user-supplied evidence packet. Strict
  // subtree: unknown/forbidden client fields are rejected, never stripped.
  evidence: userEvidencePacketInputSchema.optional(),
});
export type MatchConfig = z.infer<typeof matchConfigSchema>;

export const transcriptTurnSchema = z
  .object({
    id: z.string().min(1),
    agentId: z.string().min(1),
    side: z.enum(["A", "B"]),
    // Format-owned turn ids are deliberately open-ended; historical phase ids
    // remain valid so local match history stays readable after new formats land.
    phase: z.string().min(1),
    content: z.string(),
    model: z.string(),
    createdAt: z.string(),
  })
  // v0.4 additive: optional claim/evidence references (absent on legacy turns).
  .extend(turnEvidenceRefsSchema.shape);
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

export const transcriptSchema = z.array(transcriptTurnSchema);
export type Transcript = z.infer<typeof transcriptSchema>;

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
  // v0.4 additive: secret-free provider id so post-match challenges can call
  // the challenged side. Optional — legacy records lack it and stay valid
  // (challenges against them are rejected with 409, never guessed).
  providerId: z.string().trim().min(1).max(64).optional(),
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
  verdict: verdictSchemaRef.nullable(),
  terminal: matchTerminalSchema,
  terminalReason: z.string().nullable(),
  metrics: z.object({
    turnsMs: z.array(z.number()),
    totalMs: z.number(),
    judgeMs: z.number().optional(),
    usage: tokenUsageSchema.optional(),
  }),
  // v0.4 additive evidence/capability snapshots: absent (or null) on legacy
  // records, which normalize to empty evidence + all capabilities disabled.
  evidence: evidenceExtensionsSchema.shape.evidence,
  capabilities: evidenceExtensionsSchema.shape.capabilities,
  // v0.4 additive bounded post-match challenges + their lifecycle evidence
  // events. Absent on legacy records; new records start with empty arrays.
  challenges: z.array(matchChallengeSchema).max(CHALLENGE_LIMITS.maxPerMatch).optional(),
  evidenceEvents: z.array(evidenceEventSchema).max(CHALLENGE_LIMITS.maxEvidenceEvents).optional(),
  // v0.4 additive F10-09/F10-10 source access audits. Absent on legacy
  // records; new records may initialize an empty array.
  sourceAudits: z.array(sourceAccessAuditSchema).max(SOURCE_AUDITS_MAX).optional(),
});
export type MatchRecord = z.infer<typeof matchRecordSchema>;
