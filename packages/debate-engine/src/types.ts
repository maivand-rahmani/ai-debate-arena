import type { TokenPolicyName } from "./token-policy";
import type { DebateSide, EvidenceBundle } from "@arena/types";

export enum DebatePhase {
  CREATED = "CREATED",
  /** Legacy v0.3 ids kept for stored-record and test compatibility. */
  OPENING_A = "OPENING_A",
  OPENING_B = "OPENING_B",
  REBUTTAL_A = "REBUTTAL_A",
  REBUTTAL_B = "REBUTTAL_B",
  JUDGING = "JUDGING",
  FINISHED = "FINISHED",
}

export type { DebateSide };

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly position?: DebatePosition;
}

export interface DebateTurn {
  readonly id: string;
  readonly agentId: string;
  readonly side: DebateSide;
  /** Format-owned turn id, or the JUDGING lifecycle marker. */
  readonly phase: string;
  readonly content: string;
  readonly model: string;
  readonly createdAt: string;
}

export interface DebateCriteria {
  readonly argumentQualityA: number;
  readonly argumentQualityB: number;
  readonly rebuttalA: number;
  readonly rebuttalB: number;
  readonly consistencyA: number;
  readonly consistencyB: number;
  readonly relevanceA: number;
  readonly relevanceB: number;
}

export type DebatePosition = "FOR" | "AGAINST";

export interface DebateVerdict {
  readonly winner: DebateSide | "DRAW";
  readonly scoreA: number;
  readonly scoreB: number;
  readonly criteria: DebateCriteria;
  readonly reasoning: string;
  /**
   * v0.4 additive (F10-03): optional claim/evidence references the verdict
   * rests on. Absent on legacy verdicts; never required.
   */
  readonly claimIds?: readonly string[];
  readonly evidenceIds?: readonly string[];
}

export interface DebateConfig {
  readonly topic: string;
  readonly agents: { readonly A: Agent; readonly B: Agent };
  readonly tokenPolicy?: TokenPolicyName;
  readonly maxHistoryTurns?: number;
  readonly maxContextCharsPerSide?: number;
  /**
   * v0.4 additive (F10-06): canonical, server-normalized user evidence.
   * Rendered only into user prompts as untrusted data — never into system
   * prompts. Absent for evidence-free matches.
   */
  readonly evidence?: EvidenceBundle;
}

export interface DebateState {
  /** Lifecycle marker or a format-owned turn id. */
  readonly phase: string;
  readonly turns: readonly DebateTurn[];
  readonly verdict?: DebateVerdict;
}

export const DEBATE_PHASES = Object.values(DebatePhase);
