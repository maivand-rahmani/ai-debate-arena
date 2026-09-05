/**
 * Tests for `GET /api/matches`, `GET /api/matches/[id]` (+ markdown export),
 * and `POST /api/matches/[id]/rejudge`.
 *
 * Records are seeded through the real `runDebate` (injected model calls, no
 * HTTP) into a temp match dir; only the re-judge path touches the mock
 * OpenAI-compatible server — and only with judge (non-streaming) calls.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { MatchRecord } from "../../../entities/debate/contract";
import { runDebate } from "../../../features/run-debate/server/debate-runner";
import { exportMatchJson } from "../../../features/run-debate/server/export";
import { getProvider } from "../../../shared/config/provider-store";
import { loadMatchRecord, saveMatchRecord } from "../../../shared/config/match-store";
import { GET as listMatches } from "./route";
import { GET as getMatch } from "./[id]/route";
import { POST as rejudgeMatch } from "./[id]/rejudge/route";
import { POST as importMatch, findCredentialLikeFields } from "./import/route";
import {
  startMockOpenAIProvider,
  type MockOpenAIProvider,
} from "../../../test/mock-openai-provider";

vi.mock("../../../shared/config/provider-store", () => ({ getProvider: vi.fn() }));
vi.mock("server-only", () => ({}));

const getProviderMock = vi.mocked(getProvider);

const VERDICT_A_JSON = JSON.stringify({
  winner: "A",
  scoreA: 82,
  scoreB: 74,
  criteria: {
    argumentQualityA: 85,
    argumentQualityB: 75,
    rebuttalA: 80,
    rebuttalB: 72,
    consistencyA: 83,
    consistencyB: 74,
    relevanceA: 84,
    relevanceB: 73,
  },
  reasoning: "A had stronger arguments",
});

const VERDICT_B_JSON = JSON.stringify({
  winner: "B",
  scoreA: 70,
  scoreB: 81,
  criteria: {
    argumentQualityA: 70,
    argumentQualityB: 82,
    rebuttalA: 70,
    rebuttalB: 81,
    consistencyA: 70,
    consistencyB: 82,
    relevanceA: 70,
    relevanceB: 81,
  },
  reasoning: "B had stronger rebuttals",
});

const AGENT_TEXTS = ["A opening.", "B opening.", "A rebuttal.", "B rebuttal."];

let mock: MockOpenAIProvider;
let dir = "";
const ORIGINAL_DIR = process.env.AI_DEBATE_ARENA_MATCH_DIR;

beforeAll(async () => {
  mock = await startMockOpenAIProvider();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-debate-arena-rejudge-"));
  process.env.AI_DEBATE_ARENA_MATCH_DIR = dir;
  mock.reset();
  getProviderMock.mockReset();
  getProviderMock.mockImplementation(async (id: string) => {
    if (id === "missing-provider") return undefined;
    return { id, name: "Mock Provider", baseUrl: mock.baseUrl, model: "mock-model", api: "chat", apiKey: "sk-test" };
  });
});

afterEach(async () => {
  if (ORIGINAL_DIR === undefined) delete process.env.AI_DEBATE_ARENA_MATCH_DIR;
  else process.env.AI_DEBATE_ARENA_MATCH_DIR = ORIGINAL_DIR;
  await rm(dir, { recursive: true, force: true });
});

/** Runs a full quick match with injected model calls; returns the saved record. */
async function seedCompletedMatch(matchId: string): Promise<MatchRecord> {
  const saved: MatchRecord[] = [];
  let agentCalls = 0;
  const events = runDebate(
    {
      topic: "Should AI be regulated?",
      mode: "quick",
      agentA: { providerId: "test-provider", model: "mock-model", position: "FOR" },
      agentB: { providerId: "test-provider", model: "mock-model", position: "AGAINST" },
    },
    {
      matchId,
      callModel: async (args) => {
        if (args.kind === "judge") return { text: VERDICT_A_JSON, chunks: [] };
        const text = AGENT_TEXTS[agentCalls % AGENT_TEXTS.length]!;
        agentCalls += 1;
        return { text, chunks: [] };
      },
      saveMatch: async (record) => {
        saved.push(record);
      },
    },
  );
  for await (const event of events) {
    expect(event.seq).toBeGreaterThan(0);
  }
  expect(saved).toHaveLength(1);
  await saveMatchRecord(saved[0]!);
  return saved[0]!;
}

async function seedErrorMatch(matchId: string): Promise<MatchRecord> {
  const base = await seedCompletedMatch(matchId);
  const record: MatchRecord = {
    ...base,
    transcript: [],
    verdict: null,
    terminal: "error",
    terminalReason: "boom",
  };
  await saveMatchRecord(record);
  return record;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/matches", () => {
  it("lists stored match summaries with winner or pending", async () => {
    await seedCompletedMatch("m-1");
    await seedErrorMatch("m-2");

    const res = await listMatches();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matches: Array<{ id: string; topic: string; date: string; mode: string; winner: string | null; terminal: string }>;
    };
    expect(body.matches.map((entry) => entry.id).sort()).toEqual(["m-1", "m-2"]);
    const completed = body.matches.find((entry) => entry.id === "m-1")!;
    expect(completed).toMatchObject({ topic: "Should AI be regulated?", mode: "quick", winner: "A", terminal: "completed" });
    expect(typeof completed.date).toBe("string");
    const pending = body.matches.find((entry) => entry.id === "m-2")!;
    expect(pending.winner).toBeNull();
    expect(pending.terminal).toBe("error");
  });

  it("returns an empty list when no matches are stored", async () => {
    const res = await listMatches();
    expect((await res.json()) as { matches: unknown[] }).toEqual({ matches: [] });
  });
});

describe("GET /api/matches/[id]", () => {
  it("returns the full record JSON", async () => {
    await seedCompletedMatch("m-1");
    const res = await getMatch(new Request("http://localhost/api/matches/m-1"), params("m-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as MatchRecord;
    expect(body.matchId).toBe("m-1");
    expect(body.transcript).toHaveLength(4);
    expect(body.verdict?.winner).toBe("A");
  });

  it("returns the Markdown export with ?format=markdown", async () => {
    await seedCompletedMatch("m-1");
    const res = await getMatch(new Request("http://localhost/api/matches/m-1?format=markdown"), params("m-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-disposition")).toContain('filename="match-m-1.md"');
    const body = await res.text();
    expect(body).toContain("# Debate: Should AI be regulated?");
    expect(body).toContain("Winner: A (82–74)");
    expect(body).toContain("### OPENING_A — Side A");
    expect(body).toContain("Reasoning: A had stronger arguments");
  });

  it("returns 404 for unknown ids and traversal attempts", async () => {
    const missing = await getMatch(new Request("http://localhost/api/matches/nope"), params("nope"));
    expect(missing.status).toBe(404);
    const evil = await getMatch(new Request("http://localhost/api/matches/evil"), params("../evil"));
    expect(evil.status).toBe(404);
    const evilMd = await getMatch(new Request("http://localhost/api/matches/evil?format=markdown"), params("a/b"));
    expect(evilMd.status).toBe(404);
  });
});

describe("POST /api/matches/[id]/rejudge", () => {
  it("re-judges with exactly one judge HTTP call and updates the stored record", async () => {
    await seedCompletedMatch("m-1");
    mock.enqueue({ kind: "text", text: VERDICT_B_JSON });

    const res = await rejudgeMatch(new Request("http://localhost/api/matches/m-1/rejudge", { method: "POST" }), params("m-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; winner: string; terminal: string; judgedAt: string };
    expect(body.id).toBe("m-1");
    expect(body.winner).toBe("B");
    expect(body.terminal).toBe("completed");
    expect(typeof body.judgedAt).toBe("string");

    // Proof of the controlled path: exactly one HTTP call, judge-only
    // (non-streaming), no debater turns re-run.
    expect(mock.requestCount).toBe(1);
    expect(mock.requests.every((request) => request.stream !== true)).toBe(true);

    const stored = await loadMatchRecord("m-1");
    expect(stored?.verdict?.winner).toBe("B");
    expect(stored?.verdict?.reasoning).toBe("B had stronger rebuttals");
    expect(stored?.judgedAt).toBe(body.judgedAt);
    expect(stored?.transcript).toHaveLength(4);
    expect(stored?.transcript.map((turn) => turn.content)).toEqual(AGENT_TEXTS);
    expect(stored?.metrics.turnsMs).toHaveLength(4);
    expect(typeof stored?.metrics.judgeMs).toBe("number");
    expect(stored?.promptVersions).toEqual({ agent: "1", judge: "1" });
    expect(JSON.stringify(stored)).not.toMatch(/apiKey|baseUrl|sk-test/i);
  });

  it("returns 409 for an unfinished match without touching the provider", async () => {
    await seedErrorMatch("m-2");
    const before = await loadMatchRecord("m-2");

    const res = await rejudgeMatch(new Request("http://localhost/api/matches/m-2/rejudge", { method: "POST" }), params("m-2"));
    expect(res.status).toBe(409);
    expect(mock.requestCount).toBe(0);
    expect(await loadMatchRecord("m-2")).toEqual(before);
  });

  it("returns 409 for an unknown judge provider without touching the provider", async () => {
    const record = await seedCompletedMatch("m-3");
    await saveMatchRecord({ ...record, judge: { providerId: "missing-provider", model: "mock-model" } });

    const res = await rejudgeMatch(new Request("http://localhost/api/matches/m-3/rejudge", { method: "POST" }), params("m-3"));
    expect(res.status).toBe(409);
    expect(mock.requestCount).toBe(0);
  });

  it("returns 404 for an unknown match", async () => {
    const res = await rejudgeMatch(new Request("http://localhost/api/matches/nope/rejudge", { method: "POST" }), params("nope"));
    expect(res.status).toBe(404);
    expect(mock.requestCount).toBe(0);
  });

  it("leaves the stored record unchanged when the judge output stays malformed", async () => {
    await seedCompletedMatch("m-4");
    mock.enqueue(
      ...Array.from({ length: 6 }, () => ({ kind: "text", text: "not json {{{" }) as const),
    );

    const res = await rejudgeMatch(new Request("http://localhost/api/matches/m-4/rejudge", { method: "POST" }), params("m-4"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: unknown };
    expect(typeof body.error).toBe("string");

    const stored = await loadMatchRecord("m-4");
    expect(stored?.verdict?.winner).toBe("A");
    expect(stored?.judgedAt).toBeUndefined();
    expect(stored?.metrics.judgeMs).toBeUndefined();
  });
});

function postImport(body: unknown): Promise<Response> {
  return importMatch(
    new Request("http://localhost/api/matches/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/matches/import", () => {
  it("round-trips export → import → load with an identical verdict", async () => {
    const seeded = await seedCompletedMatch("m-1");
    const exported = JSON.parse(exportMatchJson(seeded)) as Record<string, unknown>;

    const res = await postImport(exported);
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { id: string; winner: string };
    expect(summary.id).toBe("m-1");
    expect(summary.winner).toBe("A");

    const loaded = await loadMatchRecord("m-1");
    expect(loaded?.verdict).toEqual(seeded.verdict);
    expect(loaded?.transcript).toHaveLength(4);
  });

  it("imports under a foreign id, serves it via GET, and rejudge answers 409 without a provider", async () => {
    const seeded = await seedCompletedMatch("m-1");
    const exported = JSON.parse(exportMatchJson(seeded)) as Record<string, unknown>;
    const res = await postImport({ ...exported, matchId: "foreign-1" });
    expect(res.status).toBe(200);

    const fetched = await getMatch(new Request("http://localhost/api/matches/foreign-1"), params("foreign-1"));
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as MatchRecord).matchId).toBe("foreign-1");

    const stored = await loadMatchRecord("foreign-1");
    await saveMatchRecord({ ...stored!, judge: { providerId: "missing-provider", model: "mock-model" } });
    const rejudged = await rejudgeMatch(
      new Request("http://localhost/api/matches/foreign-1/rejudge", { method: "POST" }),
      params("foreign-1"),
    );
    expect(rejudged.status).toBe(409);
    expect(mock.requestCount).toBe(0);
  });

  it("rejects a tampered contract version with 400", async () => {
    const seeded = await seedCompletedMatch("m-1");
    const exported = JSON.parse(exportMatchJson(seeded)) as Record<string, unknown>;
    const res = await postImport({ ...exported, version: 2 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: unknown };
    expect(typeof body.error).toBe("string");
    expect(body.error as string).toMatch(/version/i);
  });

  it("rejects injected key material with 400 naming the fields", async () => {
    const seeded = await seedCompletedMatch("m-1");
    const exported = JSON.parse(exportMatchJson(seeded)) as Record<string, unknown>;
    const tampered = {
      ...exported,
      sides: { ...(exported.sides as Record<string, unknown>), providerApiKey: "sk-live-123" },
    };
    const res = await postImport(tampered);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: unknown };
    expect(body.error).toBe("record contains credential-like fields: providerApiKey");
    expect(JSON.stringify(await loadMatchRecord("m-1"))).not.toContain("sk-live-123");
  });

  it("rejects an invalid shape with 400", async () => {
    const res = await postImport({ version: 1, matchId: "x" });
    expect(res.status).toBe(400);
  });

  it("refuses to overwrite a non-completed record with 409", async () => {
    await seedErrorMatch("m-2");
    const completed = await seedCompletedMatch("m-1");
    const exported = JSON.parse(exportMatchJson(completed)) as Record<string, unknown>;
    const res = await postImport({ ...exported, matchId: "m-2" });
    expect(res.status).toBe(409);
    expect((await loadMatchRecord("m-2"))?.terminal).toBe("error");
  });

  it("allows overwriting a completed record", async () => {
    await seedCompletedMatch("m-1");
    const other = await seedCompletedMatch("m-9");
    const exported = JSON.parse(exportMatchJson(other)) as Record<string, unknown>;
    const res = await postImport({ ...exported, matchId: "m-1" });
    expect(res.status).toBe(200);
    expect((await loadMatchRecord("m-1"))?.transcript).toHaveLength(4);
  });

  it("scans nested structures for credential-like string fields", () => {
    expect(findCredentialLikeFields({ a: [{ apiToken: "x" }, { ok: 1 }] })).toEqual(["apiToken"]);
    expect(findCredentialLikeFields({ usage: { promptTokens: 5, completionTokens: 6 } })).toEqual([]);
    expect(findCredentialLikeFields({ secret: "", token: 0 })).toEqual([]);
    expect(findCredentialLikeFields("plain")).toEqual([]);
  });
});
