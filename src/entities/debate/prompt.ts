import type { DebateConfig, DebateState, DebateTurn, DebatePhase } from "./types";

export interface DebatePromptContext {
  readonly topic: string;
  readonly phase: DebatePhase;
  readonly agent: DebateConfig["agents"]["A"];
  readonly history: readonly DebateTurn[];
}

export function buildPromptContext(
  config: DebateConfig,
  state: DebateState,
  agentId: string,
): DebatePromptContext {
  const agent = config.agents.A.id === agentId ? config.agents.A : config.agents.B;
  const max = Math.max(0, config.maxHistoryTurns ?? 6);
  return {
    topic: config.topic,
    phase: state.phase,
    agent,
    history: state.turns.slice(-max),
  };
}

export function buildDebatePrompt(context: DebatePromptContext): string {
  const history = context.history.length
    ? context.history.map((turn) => `${turn.side}: ${turn.content}`).join("\n\n")
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
