import type { MatchTurnSpec } from "@arena/types";
import type { DebateConfig, DebatePosition, DebateState, DebateTurn } from "../types";

export interface DebatePromptContext {
  readonly topic: string;
  readonly phase: string;
  /** Format-owned metadata for the turn currently being generated. */
  readonly turn?: MatchTurnSpec;
  readonly agent: DebateConfig["agents"]["A"];
  readonly side?: "A" | "B";
  readonly opponentSide?: "A" | "B";
  readonly position?: DebatePosition;
  readonly history: readonly DebateTurn[];
}

export interface AgentContextLimits {
  readonly historyTurns: number;
  readonly maxContextCharsPerSide: number;
}

/** Compact representation used for the history cap calculation. */
export function formatHistoryTurn(turn: DebateTurn): string {
  return `${turn.side}: ${turn.content}`;
}

export function limitAgentHistory(
  turns: readonly DebateTurn[],
  limits: AgentContextLimits,
): readonly DebateTurn[] {
  const count = Math.max(0, Math.floor(limits.historyTurns));
  const windowed = count === 0 ? [] : turns.slice(-count);
  const cap = Math.max(0, Math.floor(limits.maxContextCharsPerSide));
  let total = windowed.reduce((sum, turn) => sum + formatHistoryTurn(turn).length, 0);
  let drop = 0;
  while (drop < windowed.length && total > cap) {
    const oldest = windowed[drop];
    if (oldest === undefined) break;
    total -= formatHistoryTurn(oldest).length;
    drop += 1;
  }
  return windowed.slice(drop);
}

export function buildPromptContext(
  config: DebateConfig,
  state: DebateState,
  agentId: string,
  turn?: MatchTurnSpec,
): DebatePromptContext {
  const agent = config.agents.A.id === agentId ? config.agents.A : config.agents.B;
  const side = turn?.side ?? (agent.id === config.agents.A.id ? "A" : "B");
  const max = Math.max(0, config.maxHistoryTurns ?? 6);
  const windowed = state.turns.slice(-max);
  const cap = config.maxContextCharsPerSide;
  const history = cap === undefined
    ? windowed
    : limitAgentHistory(windowed, { historyTurns: windowed.length, maxContextCharsPerSide: cap });
  return {
    topic: config.topic,
    phase: state.phase,
    turn,
    agent,
    side,
    opponentSide: side === "A" ? "B" : "A",
    position: agent.position ?? (side === "A" ? "FOR" : "AGAINST"),
    history,
  };
}
