import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { buildAiModel, toSafeProviderError, type SafeProviderErrorCode } from "@arena/ai";
import { providerStoreSchema, providerUpdateSchema, type ProviderConfig, type ProviderStore, redactProviderConfig, validateProviderConfig, type RedactedProviderConfig } from "./provider";

export function providerStorePath(): string {
  return process.env.AI_DEBATE_ARENA_PROVIDER_FILE ?? join(homedir(), ".ai-debate-arena", "providers.json");
}

async function readStore(): Promise<ProviderStore> {
  try {
    return providerStoreSchema.parse(JSON.parse(await readFile(providerStorePath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { providers: [] };
    throw new Error(`Unable to read provider configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeStore(store: ProviderStore): Promise<void> {
  const path = providerStorePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

export async function addProvider(input: unknown): Promise<ProviderConfig> {
  const provider = validateProviderConfig(input);
  const store = await readStore();
  await writeStore({ providers: [...store.providers.filter(({ id }) => id !== provider.id), provider] });
  return provider;
}

export async function getProvider(id: string): Promise<ProviderConfig | undefined> {
  return (await readStore()).providers.find((provider) => provider.id === id);
}

export async function listProviders(): Promise<RedactedProviderConfig[]> {
  return (await readStore()).providers.map(redactProviderConfig);
}

/**
 * Updates a stored provider. `apiKey` omitted or `""` preserves the stored
 * key; any other value replaces it. The merged record is re-validated with
 * the full provider schema. Returns the redacted record, or `undefined`
 * when no provider with `id` exists (nothing is written then).
 */
export async function updateProvider(id: string, partial: unknown): Promise<RedactedProviderConfig | undefined> {
  const patch = providerUpdateSchema.parse(partial);
  const store = await readStore();
  const existing = store.providers.find((provider) => provider.id === id);
  if (!existing) return undefined;
  const { apiKey: patchKey, ...rest } = patch;
  const definedPatch = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
  const next = validateProviderConfig({
    ...existing,
    ...definedPatch,
    apiKey: patchKey === undefined || patchKey === "" ? existing.apiKey : patchKey,
    id,
  });
  await writeStore({ providers: store.providers.map((provider) => (provider.id === id ? next : provider)) });
  return redactProviderConfig(next);
}

/** Deletes a stored provider. Returns whether a provider with `id` existed. */
export async function deleteProvider(id: string): Promise<boolean> {
  const store = await readStore();
  if (!store.providers.some((provider) => provider.id === id)) return false;
  await writeStore({ providers: store.providers.filter((provider) => provider.id !== id) });
  return true;
}

export type ProviderTestResult =
  | { readonly ok: true; readonly latencyMs: number }
  | { readonly ok: false; readonly error: { readonly code: SafeProviderErrorCode; readonly message: string } };

/** Hard timeout for a single probe call (`POST /api/providers/[id]/test`). */
export const PROVIDER_TEST_TIMEOUT_MS = 15_000;
/** Enough room for reasoning models to produce the visible probe reply. */
export const PROVIDER_TEST_MAX_OUTPUT_TOKENS = 256;

/**
 * Performs ONE minimal non-streaming model call against the stored provider
 * to verify its configuration. Each probe uses a fresh `probe-<uuid>`
 * session key (per-click, never reused) and a small token cap. Success
 * returns `{ ok: true, latencyMs }`; failure returns `{ ok: false, error }`
 * with the safe typed provider error (code + sanitized message). Returns
 * `undefined` for unknown ids. API keys and raw provider payloads never
 * appear in the result.
 */
export async function testProvider(id: string): Promise<ProviderTestResult | undefined> {
  const config = await getProvider(id);
  if (!config) return undefined;
  const startedAt = Date.now();
  try {
    const model = await buildAiModel(config, undefined, { sessionKey: `probe-${randomUUID()}` });
    const result = await generateText({
      model,
      prompt: "Reply with exactly: ok",
      maxOutputTokens: PROVIDER_TEST_MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(PROVIDER_TEST_TIMEOUT_MS),
    });
    if (!result.text.trim()) {
      throw new Error(`Provider returned an empty response (finish reason: ${result.finishReason})`);
    }
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const safe = toSafeProviderError(error);
    return { ok: false, error: { code: safe.code, message: safe.message } };
  }
}
