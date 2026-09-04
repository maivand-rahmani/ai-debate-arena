import type { DebateConfig, DebateState, DebateTurn, DebatePhase } from "./types";

export { JUDGE_PROMPT_VERSION } from "./prompts";

/** Bump on any agent wording change. */
export const AGENT_PROMPT_VERSION = "1";

export interface DebatePromptContext {
  readonly topic: string;
  readonly phase: DebatePhase;
  readonly agent: DebateConfig["agents"]["A"];
  readonly history: readonly DebateTurn[];
}

export interface AgentContextLimits {
  readonly historyTurns: number;
  readonly maxContextCharsPerSide: number;
}

function formatHistoryTurn(turn: DebateTurn): string {
  return `${turn.side}: ${turn.content}`;
}

/**
 * Trim agent history to the newest turns within count + char caps, dropping
 * the OLDEST whole turns first (never mid-turn). The char cap measures the
 * rendered `"<side>: <content>"` lines that actually enter the prompt.
 */
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
): DebatePromptContext {
  const agent = config.agents.A.id === agentId ? config.agents.A : config.agents.B;
  const max = Math.max(0, config.maxHistoryTurns ?? 6);
  const windowed = state.turns.slice(-max);
  const cap = config.maxContextCharsPerSide;
  const history = cap === undefined
    ? windowed
    : limitAgentHistory(windowed, { historyTurns: windowed.length, maxContextCharsPerSide: cap });
  return {
    topic: config.topic,
    phase: state.phase,
    agent,
    history,
  };
}

export function buildDebatePrompt(context: DebatePromptContext): string {
  const history = context.history.length
    ? context.history.map(formatHistoryTurn).join("\n\n")
    : "(no previous turns)";
  return [
    `Topic: ${context.topic}`,
    `Phase: ${context.phase}`,
    "Previous turns:",
    history,
    "Respond with a concise, rigorous argument.",
  ].join("\n\n");
}

export const buildPrompt = buildDebatePrompt;
