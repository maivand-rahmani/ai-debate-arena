import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type MatchRecord } from "../../entities/debate/contract";
import {
  listMatchRecords,
  loadMatchRecord,
  matchRecordPath,
  saveMatchRecord,
} from "./match-store";

vi.mock("server-only", () => ({}));

const ORIGINAL_DIR = process.env.AI_DEBATE_ARENA_MATCH_DIR;
let dir = "";

function record(matchId: string, startedAt: string): MatchRecord {
  return {
    version: CONTRACT_VERSION,
    matchId,
    startedAt,
    finishedAt: startedAt,
    topic: "Should AI be regulated?",
    mode: "quick" as const,
    sides: {
      A: { providerName: "Provider One", modelId: "m1", position: "FOR" as const },
      B: { providerName: "Provider Two", modelId: "m2", position: "AGAINST" as const },
    },
    policy: {
      mode: "quick" as const,
      enabled: true,
      rounds: 4,
      agentMaxOutputTokens: 2000,
      judgeMaxOutputTokens: 2000,
      historyTurns: 6,
      maxContextCharsPerSide: 12000,
    },
    promptVersions: { agent: "1", judge: "1" },
    rubricVersion: "1",
    transcript: [],
    verdict: null,
    terminal: "cancelled" as const,
    terminalReason: "Match cancelled",
    metrics: { turnsMs: [], totalMs: 5 },
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-debate-arena-matches-"));
  process.env.AI_DEBATE_ARENA_MATCH_DIR = dir;
});

afterEach(async () => {
  if (ORIGINAL_DIR === undefined) delete process.env.AI_DEBATE_ARENA_MATCH_DIR;
  else process.env.AI_DEBATE_ARENA_MATCH_DIR = ORIGINAL_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("match-store", () => {
  it("round-trips a record through save/load/list", async () => {
    await saveMatchRecord(record("m-1", "2026-01-01T00:00:00.000Z"));
    await saveMatchRecord(record("m-2", "2026-01-02T00:00:00.000Z"));

    const loaded = await loadMatchRecord("m-1");
    expect(loaded?.matchId).toBe("m-1");
    expect(loaded?.terminal).toBe("cancelled");

    const listed = await listMatchRecords();
    expect(listed.map((entry) => entry.matchId)).toEqual(["m-1", "m-2"]);
  });

  it("returns null/empty for a missing record or directory", async () => {
    expect(await loadMatchRecord("does-not-exist")).toBeNull();
    delete process.env.AI_DEBATE_ARENA_MATCH_DIR;
    process.env.AI_DEBATE_ARENA_MATCH_DIR = join(dir, "no-such-dir");
    expect(await listMatchRecords()).toEqual([]);
  });

  it("rejects path-traversal match ids", async () => {
    await expect(loadMatchRecord("../evil")).rejects.toThrow(/Invalid match id/);
    expect(() => matchRecordPath("a/b")).toThrow(/Invalid match id/);
  });

  it("persists records with no key material on disk", async () => {
    const saved = record("m-keys", "2026-01-01T00:00:00.000Z");
    await saveMatchRecord(saved);
    const raw = await readFile(matchRecordPath("m-keys"), "utf8");
    expect(raw).not.toMatch(/apiKey/i);
    expect(raw).not.toMatch(/baseUrl/i);
    expect(raw).not.toMatch(/sk-test/);
    expect(raw).not.toMatch(/secret/i);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(JSON.stringify(parsed)).not.toContain("sk-");
  });
});
