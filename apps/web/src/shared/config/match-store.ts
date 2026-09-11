import "server-only";

import { chmod, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { matchRecordSchema, type MatchRecord } from "@arena/debate-engine";

export type { MatchRecord };

const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MATCH_STORE_ENV = "AI_DEBATE_ARENA_MATCH_DIR";
const DEFAULT_MATCH_STORE_DIR = join(homedir(), ".ai-debate-arena", "matches");

export function matchStoreDir(): string {
  return process.env[MATCH_STORE_ENV] ?? DEFAULT_MATCH_STORE_DIR;
}

/**
 * A local fallback for restricted environments (for example a sandboxed
 * Windows dev process that cannot write to the user's home directory). The
 * directory is gitignored and is only considered when the default home store
 * is unavailable; an explicit `AI_DEBATE_ARENA_MATCH_DIR` remains authoritative.
 */
function workspaceFallbackDir(): string {
  return join(process.cwd(), ".data", "matches");
}

function storeDirectories(): readonly string[] {
  const primary = matchStoreDir();
  if (process.env[MATCH_STORE_ENV] !== undefined) return [primary];
  const fallback = workspaceFallbackDir();
  return fallback === primary ? [primary] : [primary, fallback];
}

export function matchRecordPath(matchId: string): string {
  return join(matchStoreDir(), `${validateMatchId(matchId)}.json`);
}

/** Persists one match record as `<dir>/<matchId>.json` (0600, atomic rename). */
export async function saveMatchRecord(record: MatchRecord): Promise<void> {
  const parsed = matchRecordSchema.parse(record);
  const [primary, fallback] = storeDirectories();
  try {
    await writeMatchRecord(primary, parsed);
  } catch (error) {
    if (fallback === undefined || !isRecoverableStoreError(error)) throw error;
    console.warn("[arena:matches] primary match store unavailable; using workspace fallback", {
      primary,
      fallback,
      reason: error instanceof Error ? error.message : String(error),
    });
    await writeMatchRecord(fallback, parsed);
  }
}

export async function loadMatchRecord(matchId: string): Promise<MatchRecord | null> {
  const parsedId = validateMatchId(matchId);
  for (const directory of storeDirectories()) {
    try {
      const record = await loadMatchRecordFromDirectory(parsedId, directory);
      if (record) return record;
    } catch (error) {
      if (!process.env[MATCH_STORE_ENV] && isRecoverableStoreError(error)) continue;
      throw error;
    }
  }
  return null;
}

export async function listMatchRecords(): Promise<MatchRecord[]> {
  const recordsById = new Map<string, MatchRecord>();
  for (const directory of storeDirectories()) {
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || (!process.env[MATCH_STORE_ENV] && isRecoverableStoreError(error))) continue;
      throw new Error(`Unable to list match records: ${error instanceof Error ? error.message : String(error)}`);
    }
    const stems = files
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter((stem) => MATCH_ID_PATTERN.test(stem))
      .sort();
    for (const stem of stems) {
      try {
        const record = await loadMatchRecordFromDirectory(stem, directory);
        if (record && !recordsById.has(stem)) recordsById.set(stem, record);
      } catch (error) {
        if (!process.env[MATCH_STORE_ENV] && isRecoverableStoreError(error)) continue;
        throw error;
      }
    }
  }
  const records = [...recordsById.values()];
  records.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  return records;
}

function validateMatchId(matchId: string): string {
  if (!MATCH_ID_PATTERN.test(matchId)) throw new Error(`Invalid match id: ${matchId}`);
  return matchId;
}

async function writeMatchRecord(directory: string, record: MatchRecord): Promise<void> {
  const path = join(directory, `${record.matchId}.json`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

async function loadMatchRecordFromDirectory(matchId: string, directory: string): Promise<MatchRecord | null> {
  try {
    return matchRecordSchema.parse(JSON.parse(await readFile(join(directory, `${matchId}.json`), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (isRecoverableStoreError(error)) throw error;
    throw new Error(`Unable to read match record: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isRecoverableStoreError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM" || code === "EROFS";
}
