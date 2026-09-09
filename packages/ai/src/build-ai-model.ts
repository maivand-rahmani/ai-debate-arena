import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { opencodeGatewayHeaders } from "./opencode-gateway";

export interface ResolvedProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly api: "chat" | "responses";
  readonly apiKey: string;
}

export interface BuildAiModelOptions {
  /**
   * Stable per-conversation session key (e.g. `<matchId>:agent-a` from the
   * debate engine). Only materializes as `x-opencode-session`/`User-Agent`
   * headers on the OpenCode gateway (`opencode.ai`); ignored otherwise.
   * Omit it and no extra headers are sent (legacy behavior).
   */
  readonly sessionKey?: string;
}

/** Pure factory: builds a server-side model from an already-resolved provider config. */
export async function buildAiModel(
  config: ResolvedProviderConfig,
  modelId?: string,
  options: BuildAiModelOptions = {},
): Promise<LanguageModelV4> {
  const headers =
    options.sessionKey === undefined ? {} : opencodeGatewayHeaders(config.baseUrl, options.sessionKey);
  const headerOption = Object.keys(headers).length > 0 ? { headers } : {};
  if (config.api === "responses") {
    return createOpenAI({
      baseURL: config.baseUrl,
      name: config.name,
      apiKey: config.apiKey,
      ...headerOption,
    }).responses(modelId ?? config.model);
  }
  return createOpenAICompatible({
    baseURL: config.baseUrl,
    name: config.name,
    apiKey: config.apiKey,
    ...headerOption,
  }).languageModel(modelId ?? config.model);
}
