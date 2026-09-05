import "server-only";
import { buildAiModel, toSafeErrorMessage } from "@arena/ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { getProvider } from "../../config/provider-store";

export { toSafeErrorMessage };

/** Creates a server-side model; credentials never leave this module. */
export async function createConfiguredModel(providerId: string, modelId?: string): Promise<LanguageModelV4> {
  try {
    const config = await getProvider(providerId);
    if (!config) throw new Error(`Provider not found: ${providerId}`);
    return buildAiModel(config, modelId);
  } catch (err) {
    throw new Error(toSafeErrorMessage(err));
  }
}
