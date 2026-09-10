import { z } from "zod";

export const providerConfigSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().url().refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  }, "baseUrl must use http or https"),
  model: z.string().trim().min(1).max(200),
  api: z.enum(["chat", "responses"]).default("chat"),
  apiKey: z.string().min(1).max(4096),
});

export const providerStoreSchema = z.object({ providers: z.array(providerConfigSchema) });
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ProviderStore = z.infer<typeof providerStoreSchema>;

/**
 * Partial update body for `PUT /api/providers/[id]`. Every field except the
 * id is optional; `apiKey` may be omitted or sent as `""` to preserve the
 * stored key (a non-empty value replaces it). Unknown keys are stripped.
 */
// Do not derive this from a `.partial()` of the create schema: Zod materializes
// defaults even for omitted fields, so updating a model used to overwrite
// `api: "responses"` with the create default of `"chat"`.
export const providerUpdateSchema = z.object({
  name: providerConfigSchema.shape.name.optional(),
  baseUrl: providerConfigSchema.shape.baseUrl.optional(),
  model: providerConfigSchema.shape.model.optional(),
  api: z.enum(["chat", "responses"]).optional(),
  apiKey: z.string().max(4096).optional(),
});
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>;
export type RedactedProviderConfig = Omit<ProviderConfig, "apiKey"> & { apiKeyHint: string };

export function validateProviderConfig(value: unknown): ProviderConfig {
  return providerConfigSchema.parse(value);
}

export function redactApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "•".repeat(Math.max(4, apiKey.length));
  return `${apiKey.slice(0, 4)}${"•".repeat(8)}${apiKey.slice(-4)}`;
}

export function redactProviderConfig(config: ProviderConfig): RedactedProviderConfig {
  const { apiKey, ...safeConfig } = config;
  return { ...safeConfig, apiKeyHint: redactApiKey(apiKey) };
}
