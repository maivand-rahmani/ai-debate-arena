export { AGENT_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "./versions";
export {
  buildAgentPrompt,
  buildAgentSystemPrompt,
  buildDebatePrompt,
  PHASE_INSTRUCTIONS,
} from "./agent-prompt";
export type { DebatePromptContext, AgentContextLimits } from "./context";
export { buildPromptContext, formatHistoryTurn, limitAgentHistory } from "./context";
export { buildJudgePrompt, JUDGE_SYSTEM_PROMPT } from "./judge-prompt";
export type { BuildJudgePromptOptions } from "./judge-prompt";
export {
  UNTRUSTED_EVIDENCE_BEGIN,
  UNTRUSTED_EVIDENCE_END,
  UNTRUSTED_EVIDENCE_PREAMBLE,
  EVIDENCE_MAX_RENDER_CHARS,
  evidenceBlockLines,
} from "./evidence-block";
export {
  CHALLENGE_AGENT_SYSTEM_PROMPT,
  CHALLENGE_JUDGE_SYSTEM_PROMPT,
  buildChallengeAgentPrompt,
  buildChallengeJudgePrompt,
} from "./challenge-prompt";
