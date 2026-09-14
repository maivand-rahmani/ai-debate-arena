export { AGENT_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "./versions";
export {
  buildAgentPrompt,
  buildAgentSystemPrompt,
  buildStandardAgentActionPrompt,
  buildStandardAgentSystemPrompt,
  buildDebatePrompt,
  PHASE_INSTRUCTIONS,
} from "./agent-prompt";
export type { DebatePromptContext, AgentContextLimits } from "./context";
export { buildPromptContext, formatHistoryTurn, limitAgentHistory } from "./context";
export { buildJudgePrompt, JUDGE_SYSTEM_PROMPT } from "./judge-prompt";
export type { BuildJudgePromptOptions } from "./judge-prompt";
