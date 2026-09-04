import { z } from "zod";

export const providerConfigSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "baseUrl must use http or https"),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().min(1).max(4096),
});

export const providerStoreSchema = z.object({ providers: z.array(providerConfigSchema) });
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ProviderStore = z.infer<typeof providerStoreSchema>;
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
