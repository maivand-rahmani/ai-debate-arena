import "server-only";

import { chmod, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { matchRecordSchema, type MatchRecord } from "@arena/debate-engine";

export type { MatchRecord };

const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function matchStoreDir(): string {
  return process.env.AI_DEBATE_ARENA_MATCH_DIR ?? join(homedir(), ".ai-debate-arena", "matches");
}

export function matchRecordPath(matchId: string): string {
  if (!MATCH_ID_PATTERN.test(matchId)) throw new Error(`Invalid match id: ${matchId}`);
  return join(matchStoreDir(), `${matchId}.json`);
}

/** Persists one match record as `<dir>/<matchId>.json` (0600, atomic rename). */
export async function saveMatchRecord(record: MatchRecord): Promise<void> {
  const parsed = matchRecordSchema.parse(record);
  const path = matchRecordPath(parsed.matchId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

export async function loadMatchRecord(matchId: string): Promise<MatchRecord | null> {
  try {
    return matchRecordSchema.parse(JSON.parse(await readFile(matchRecordPath(matchId), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Unable to read match record: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function listMatchRecords(): Promise<MatchRecord[]> {
  let files: string[];
  try {
    files = await readdir(matchStoreDir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Unable to list match records: ${error instanceof Error ? error.message : String(error)}`);
  }
  const records: MatchRecord[] = [];
  const stems = files
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((stem) => MATCH_ID_PATTERN.test(stem))
    .sort();
  for (const stem of stems) {
    const record = await loadMatchRecord(stem);
    if (record) records.push(record);
  }
  records.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  return records;
}
