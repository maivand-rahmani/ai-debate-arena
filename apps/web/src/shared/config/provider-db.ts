import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { providerStoreSchema, type ProviderConfig, type ProviderStore, redactProviderConfig, validateProviderConfig, type RedactedProviderConfig } from "./provider";

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
