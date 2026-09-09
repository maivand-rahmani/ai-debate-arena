import type { TokenPolicyName } from "./token-policy";
import type { DebateSide } from "@arena/types";

export enum DebatePhase {
  CREATED = "CREATED",
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
  readonly phase: Exclude<DebatePhase, DebatePhase.CREATED | DebatePhase.FINISHED>;
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
}

export interface DebateConfig {
  readonly topic: string;
  readonly agents: { readonly A: Agent; readonly B: Agent };
  readonly tokenPolicy?: TokenPolicyName;
  readonly maxHistoryTurns?: number;
  readonly maxContextCharsPerSide?: number;
}

export interface DebateState {
  readonly phase: DebatePhase;
  readonly turns: readonly DebateTurn[];
  readonly verdict?: DebateVerdict;
}

export const DEBATE_PHASES = Object.values(DebatePhase);
