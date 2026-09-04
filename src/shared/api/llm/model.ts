import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { getProvider } from "../../config/provider-store";
import { toSafeErrorMessage } from "./errors";

export { toSafeErrorMessage };

/** Creates a server-side model; credentials never leave this module. */
export async function createConfiguredModel(providerId: string, modelId?: string): Promise<LanguageModelV4> {
  try {
    const config = await getProvider(providerId);
    if (!config) throw new Error(`Provider not found: ${providerId}`);
    return createOpenAICompatible({ baseURL: config.baseUrl, name: config.name, apiKey: config.apiKey }).languageModel(modelId ?? config.model);
  } catch (err) {
    throw new Error(toSafeErrorMessage(err));
  }
}
