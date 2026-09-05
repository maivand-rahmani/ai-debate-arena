import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";

export interface ResolvedProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly api: "chat" | "responses";
  readonly apiKey: string;
}

/** Pure factory: builds a server-side model from an already-resolved provider config. */
export async function buildAiModel(
  config: ResolvedProviderConfig,
  modelId?: string,
): Promise<LanguageModelV4> {
  if (config.api === "responses") {
    return createOpenAI({ baseURL: config.baseUrl, name: config.name, apiKey: config.apiKey }).responses(
      modelId ?? config.model,
    );
  }
  return createOpenAICompatible({
    baseURL: config.baseUrl,
    name: config.name,
    apiKey: config.apiKey,
  }).languageModel(modelId ?? config.model);
}
