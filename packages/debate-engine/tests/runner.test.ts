import { describe, expect, it } from "vitest";
import { DebatePhase, MATCH_PROFILES, type MatchRecord } from "@arena/debate-engine";
import { runDebate, runJudge, type DebateStreamEvent, type ModelCallArgs } from "../src/runner";
import { UNTRUSTED_EVIDENCE_BEGIN, UNTRUSTED_EVIDENCE_END } from "../src/prompts";
import { normalizeUserEvidencePacket } from "../src/evidence-contract";
import type { EvidenceBundle } from "@arena/types";

const verdictJson = JSON.stringify({
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

// Unit tests inject persistence; the default writer (match-store on disk) must
// never run here.
const noopSave = async (): Promise<void> => {};

describe("runDebate", () => {
  it("emits six format-owned Quick turns, then judge-start, verdict, and done", async () => {
    const calls: string[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        saveMatch: noopSave,
        callModel: async (args) => {
          calls.push(args.kind);
          if (args.kind === "judge") return { text: verdictJson, chunks: [] };
          return { text: `text-${args.system.slice(0, 0)}${calls.length}`, chunks: ["c1", "c2"] };
        },
      },
    )) {
      events.push(event);
    }

    const types = events.map((event) => event.type);
    expect(types).toEqual([
      ...Array.from({ length: 6 }, () => ["phase", "token", "token", "turn"]).flat(),
      "judge-start", "verdict", "done",
    ]);

    const phases = events.filter((event) => event.type === "phase");
    expect(phases.map((event) => (event.type === "phase" ? event.phase : null))).toEqual([
      "quick-a-opening",
      "quick-b-opening",
      "quick-a-response-1",
      "quick-b-response-1",
      "quick-a-response-2",
      "quick-b-response-2",
    ]);

    const verdictEvent = events.find((event) => event.type === "verdict");
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
      expect(verdictEvent.verdict.criteria.argumentQualityA).toBe(85);
    }
  });

  it("emits error then done when the model fails", async () => {
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Topic",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        saveMatch: noopSave,
        callModel: async () => {
          throw new Error("boom");
        },
      },
    )) {
      events.push(event);
    }
    expect(events[0].type).toBe("phase");
    expect(events[events.length - 2].type).toBe("error");
    expect(events[events.length - 1].type).toBe("done");
  });

  it("retries once when the judge returns degenerate zero DRAW, then emits the corrected verdict", async () => {
    const degenerate = JSON.stringify({
      winner: "DRAW",
      scoreA: 0,
      scoreB: 0,
      reasoning: "placeholder zeros",
    });
    const judgeCalls: string[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        saveMatch: noopSave,
        callModel: async (args) => {
          if (args.kind === "judge") {
            judgeCalls.push(args.prompt);
            return { text: judgeCalls.length === 1 ? degenerate : verdictJson, chunks: [] };
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(judgeCalls).toHaveLength(2);
    expect(judgeCalls[1]).toMatch(/previous output was invalid/i);
    const types = events.map((event) => event.type);
    expect(types).toContain("judge-start");
    expect(types).toContain("verdict");
    expect(types[types.length - 1]).toBe("done");
    const verdictEvent = events.find((event) => event.type === "verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
      expect(verdictEvent.verdict.scoreA).toBe(82);
    } else {
      expect.unreachable("expected a verdict event");
    }
  });

  it("repairs a winner that conflicts with the scores without retrying", async () => {
    const conflicted = JSON.stringify({
      winner: "B",
      scoreA: 82,
      scoreB: 74,
      reasoning: "scores favor A",
    });
    let judgeCalls = 0;
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        saveMatch: noopSave,
        callModel: async (args) => {
          if (args.kind === "judge") {
            judgeCalls += 1;
            return { text: conflicted, chunks: [] };
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(judgeCalls).toBe(1);
    const verdictEvent = events.find((event) => event.type === "verdict");
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
    }
  });

  it("emits error when the retry is still degenerate", async () => {
    const degenerate = JSON.stringify({
      winner: "DRAW",
      scoreA: 0,
      scoreB: 0,
      reasoning: "placeholder zeros",
    });
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        saveMatch: noopSave,
        callModel: async (args) => {
          if (args.kind === "judge") return { text: degenerate, chunks: [] };
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(events[events.length - 2].type).toBe("error");
    expect(events[events.length - 1].type).toBe("done");
    expect(events.some((event) => event.type === "verdict")).toBe(false);
  });

  it("accepts markdown-fenced judge JSON without retrying (plain-fallback shape)", async () => {
    const fenced = `\`\`\`json\n${verdictJson}\n\`\`\``;
    let judgeCalls = 0;
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        saveMatch: noopSave,
        callModel: async (args) => {
          if (args.kind === "judge") {
            judgeCalls += 1;
            return { text: fenced, chunks: [] };
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(judgeCalls).toBe(1);
    const verdictEvent = events.find((event) => event.type === "verdict");
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
      expect(verdictEvent.verdict.scoreA).toBe(82);
      expect(verdictEvent.verdict.scoreB).toBe(74);
    }
  });

  it("accepts prose-wrapped judge JSON without retrying", async () => {
    const wrapped = `Here is my verdict:\n${verdictJson}\nThat concludes the judging.`;
    let judgeCalls = 0;
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        saveMatch: noopSave,
        callModel: async (args) => {
          if (args.kind === "judge") {
            judgeCalls += 1;
            return { text: wrapped, chunks: [] };
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(judgeCalls).toBe(1);
    const verdictEvent = events.find((event) => event.type === "verdict");
    expect(verdictEvent?.type).toBe("verdict");
    if (verdictEvent?.type === "verdict") {
      expect(verdictEvent.verdict.winner).toBe("A");
    }
  });

  it("passes the run abortSignal through to every model call", async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        abortSignal: controller.signal,
        saveMatch: noopSave,
        callModel: async (args: ModelCallArgs) => {
          seen.push(args.abortSignal);
          if (args.kind === "judge") return { text: verdictJson, chunks: [] };
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    expect(seen.length).toBeGreaterThan(0);
    for (const signal of seen) {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal).toBe(controller.signal);
    }
    expect(events[events.length - 1].type).toBe("done");
  });

  it("aborting mid-run yields exactly one error and one done", async () => {
    const controller = new AbortController();
    let agentCalls = 0;
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        abortSignal: controller.signal,
        saveMatch: noopSave,
        callModel: async (args: ModelCallArgs) => {
          if (args.kind === "judge") return { text: verdictJson, chunks: [] };
          agentCalls += 1;
          if (agentCalls === 2) {
            controller.abort();
          }
          if (args.abortSignal?.aborted) {
            throw new DOMException("This operation was aborted", "AbortError");
          }
          return { text: "agent text", chunks: [] };
        },
      },
    )) {
      events.push(event);
    }

    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === "error")).toHaveLength(1);
    expect(types.filter((type) => type === "done")).toHaveLength(1);
    expect(types[types.length - 2]).toBe("error");
    expect(types[types.length - 1]).toBe("done");
    expect(types).toContain("turn");
    expect(types).not.toContain("verdict");
  });
});

function quickInput() {
  return {
    topic: "Should AI be regulated?",
    mode: "quick" as const,
    agentA: { providerId: "p1", model: "m1", position: "FOR" as const },
    agentB: { providerId: "p2", model: "m2", position: "AGAINST" as const },
  };
}

async function agentSuccess(args: ModelCallArgs) {
  if (args.kind === "judge") return { text: verdictJson, chunks: [] as string[] };
  return { text: "agent text", chunks: [] as string[] };
}

describe("runDebate stream contract v1 + persistence", () => {
  it("envelopes every event with v/matchId/seq in order", async () => {
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: agentSuccess,
      matchId: "match-123",
      saveMatch: noopSave,
    })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.v).toBe(1);
      expect(event.matchId).toBe("match-123");
    }
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
  });

  it("generates a matchId when none is provided", async () => {
    const seen = new Set<string>();
    for (let run = 0; run < 2; run += 1) {
      const events: DebateStreamEvent[] = [];
      for await (const event of runDebate(quickInput(), { callModel: agentSuccess, saveMatch: noopSave })) {
        events.push(event);
      }
      for (const event of events) seen.add(event.matchId);
    }
    expect(seen.size).toBe(2);
  });

  it("calls saveMatch once on success with a complete, secret-free record", async () => {
    const saved: MatchRecord[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: agentSuccess,
      matchId: "match-ok",
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      events.push(event);
    }

    expect(saved).toHaveLength(1);
    const record = saved[0]!;
    expect(record.version).toBe(1);
    expect(record.matchId).toBe("match-ok");
    expect(record.mode).toBe("quick");
    expect(record.terminal).toBe("completed");
    expect(record.terminalReason).toBeNull();
    expect(record.transcript).toHaveLength(6);
    expect(record.verdict?.winner).toBe("A");
    expect(record.metrics.turnsMs).toHaveLength(6);
    expect(record.metrics.totalMs).toBeGreaterThanOrEqual(0);
    expect(record.policy).toMatchObject({ mode: "quick", agentMaxOutputTokens: 3000 });
    expect(record.promptVersions).toEqual({ agent: "2", judge: "2" });
    expect(record.rubricVersion).toBe("2");
    expect(JSON.stringify(record)).not.toMatch(/apiKey|baseUrl|sk-/i);

    const done = events[events.length - 1];
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.terminal).toBe("completed");
  });

  it("calls saveMatch once on error with a partial record and error terminal", async () => {
    const saved: MatchRecord[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: async () => {
        throw new Error("boom");
      },
      matchId: "match-err",
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      events.push(event);
    }

    expect(saved).toHaveLength(1);
    const record = saved[0]!;
    expect(record.matchId).toBe("match-err");
    expect(record.terminal).toBe("error");
    const errorEvent = events.find((event) => event.type === "error");
    expect(errorEvent?.type).toBe("error");
    if (errorEvent?.type === "error") expect(record.terminalReason).toBe(errorEvent.message);
    expect(record.verdict).toBeNull();
    expect(record.transcript).toHaveLength(0);
    expect(JSON.stringify(record)).not.toMatch(/apiKey|baseUrl|sk-/i);

    const done = events[events.length - 1];
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.terminal).toBe("error");
  });

  it("records cancelled when the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const saved: MatchRecord[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(quickInput(), {
      abortSignal: controller.signal,
      callModel: async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      },
      matchId: "match-cancel",
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      events.push(event);
    }

    expect(saved).toHaveLength(1);
    expect(saved[0]!.terminal).toBe("cancelled");
    expect(JSON.stringify(saved[0])).not.toMatch(/apiKey|baseUrl|sk-/i);
    const done = events[events.length - 1];
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.terminal).toBe("cancelled");
  });

  it("persists a cancelled record when the consumer abandons the stream early", async () => {
    const saved: MatchRecord[] = [];
    const generator = runDebate(quickInput(), {
      callModel: agentSuccess,
      matchId: "match-early",
      saveMatch: async (record) => {
        saved.push(record);
      },
    });
    await generator.next();
    await generator.return(undefined);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.terminal).toBe("cancelled");
    expect(saved[0]!.transcript).toHaveLength(0);
  });

  it("takes per-turn call limits from the injected profile", async () => {
    const limits: number[] = [];
    const judgeLimits: number[] = [];
    const profile = { ...MATCH_PROFILES.quick, agentMaxOutputTokens: 123, judgeMaxOutputTokens: 456 };
    const saved: MatchRecord[] = [];
    for await (const event of runDebate(quickInput(), {
      profile,
      callModel: async (args) => {
        if (args.kind === "judge") {
          judgeLimits.push(args.maxOutputTokens);
          return { text: verdictJson, chunks: [] };
        }
        limits.push(args.maxOutputTokens);
        return { text: "agent text", chunks: [] };
      },
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      expect(event.seq).toBeGreaterThan(0);
    }

    expect(limits).toEqual([123, 123, 123, 123, 123, 123]);
    expect(judgeLimits).toEqual([456]);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.policy.agentMaxOutputTokens).toBe(123);
  });
});

describe("runDebate token metrics (F7-13)", () => {
  it("sums per-call usage into metrics.usage", async () => {
    const saved: MatchRecord[] = [];
    const types: string[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: async (args) => {
        if (args.kind === "judge") {
          return { text: verdictJson, chunks: [], usage: { promptTokens: 5, completionTokens: 7 } };
        }
        return { text: "agent text", chunks: [], usage: { promptTokens: 10, completionTokens: 20 } };
      },
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      types.push(event.type);
    }

    expect(types[types.length - 1]).toBe("done");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.metrics.usage).toEqual({ promptTokens: 65, completionTokens: 127 });
  });

  it("records zeros when the provider reports no usage", async () => {
    const saved: MatchRecord[] = [];
    const types: string[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: agentSuccess,
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      types.push(event.type);
    }

    expect(types[types.length - 1]).toBe("done");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.metrics.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("sums judge usage across retry attempts in runJudge", async () => {
    const { runJudge } = await import("../src/runner");
    let calls = 0;
    const result = await runJudge(
      {
        topic: "Topic",
        turns: [],
        providerId: "p",
        model: "m",
      },
      {
        callModel: async () => {
          calls += 1;
          if (calls === 1) return { text: "garbage", chunks: [], usage: { promptTokens: 3, completionTokens: 4 } };
          return { text: verdictJson, chunks: [], usage: { promptTokens: 5, completionTokens: 6 } };
        },
      },
    );
    expect(calls).toBe(2);
    expect(result.verdict.winner).toBe("A");
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 10 });
  });

  it("treats malformed usage as zeros without throwing", async () => {
    const { runJudge, toModelUsage } = await import("../src/runner");
    expect(toModelUsage(undefined)).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(toModelUsage({ inputTokens: -5, outputTokens: Number.NaN })).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(toModelUsage({ inputTokens: { total: 9 }, outputTokens: 2 })).toEqual({ promptTokens: 9, completionTokens: 2 });
    const result = await runJudge(
      { topic: "Topic", turns: [], providerId: "p", model: "m" },
      { callModel: async () => ({ text: verdictJson, chunks: [] }) },
    );
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});

describe("runDebate with user evidence (F10-06..08)", () => {
  function evidenceBundle(): EvidenceBundle {
    const result = normalizeUserEvidencePacket({
      version: 1,
      items: [{ source: "local_file", label: "brief.md", content: "# Brief\nSupporting analysis." }],
    });
    if (!result.success) throw new Error(`fixture failed: ${result.error}`);
    return result.data;
  }

  it("passes evidence into all six agent prompts and the judge prompt, never into system prompts", async () => {
    const agentPrompts: string[] = [];
    const agentSystems: string[] = [];
    const judgePrompts: string[] = [];
    const events: DebateStreamEvent[] = [];
    for await (const event of runDebate(
      { ...quickInput(), evidence: evidenceBundle() },
      {
        callModel: async (args) => {
          if (args.kind === "judge") {
            judgePrompts.push(args.prompt);
            return { text: verdictJson, chunks: [] };
          }
          agentPrompts.push(args.prompt);
          agentSystems.push(args.system);
          return { text: "agent text", chunks: [] };
        },
        saveMatch: noopSave,
      },
    )) {
      events.push(event);
    }

    expect(agentPrompts).toHaveLength(6);
    for (const prompt of agentPrompts) {
      expect(prompt).toContain(UNTRUSTED_EVIDENCE_BEGIN);
      expect(prompt).toContain(UNTRUSTED_EVIDENCE_END);
      expect(prompt).toContain("Supporting analysis.");
    }
    for (const system of agentSystems) {
      expect(system).not.toContain("UNTRUSTED EVIDENCE");
      expect(system).not.toContain("Supporting analysis.");
    }
    expect(judgePrompts).toHaveLength(1);
    expect(judgePrompts[0]).toContain(UNTRUSTED_EVIDENCE_BEGIN);

    // Evidence-free behavior unchanged: same event sequence shape.
    const types = events.map((event) => event.type);
    expect(types[types.length - 1]).toBe("done");
    expect(types.filter((type) => type === "turn")).toHaveLength(6);
  });

  it("persists the canonical evidence snapshot on the match record", async () => {
    const saved: MatchRecord[] = [];
    for await (const event of runDebate(
      { ...quickInput(), evidence: evidenceBundle() },
      {
        callModel: agentSuccess,
        matchId: "match-ev",
        saveMatch: async (record) => {
          saved.push(record);
        },
      },
    )) {
      expect(event.type).not.toBe("error");
    }

    expect(saved).toHaveLength(1);
    const record = saved[0]!;
    expect(record.terminal).toBe("completed");
    expect(record.evidence?.schemaVersion).toBe(1);
    expect(record.evidence?.items).toHaveLength(1);
    expect(record.evidence?.items[0]?.provenance.origin).toBe("user");
    expect(record.evidence?.items[0]?.status).toBe("unverified");
    expect(record.evidence?.claims).toEqual([]);
  });

  it("keeps evidence-free runs legacy-shaped: no evidence field, no evidence in prompts", async () => {
    const saved: MatchRecord[] = [];
    const prompts: string[] = [];
    for await (const event of runDebate(quickInput(), {
      callModel: async (args) => {
        prompts.push(args.prompt);
        return agentSuccess(args);
      },
      matchId: "match-plain",
      saveMatch: async (record) => {
        saved.push(record);
      },
    })) {
      expect(event.type).not.toBe("error");
    }

    expect(prompts.every((prompt) => !prompt.includes("UNTRUSTED EVIDENCE"))).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.evidence).toBeUndefined();
    expect(JSON.stringify(saved[0])).not.toContain("UNTRUSTED EVIDENCE");
  });

  it("treats an empty evidence bundle as no evidence", async () => {
    const saved: MatchRecord[] = [];
    const prompts: string[] = [];
    for await (const event of runDebate(
      { ...quickInput(), evidence: { schemaVersion: 1, claims: [], items: [], challenges: [], responses: [], proofs: [], sourceSnapshots: [] } },
      {
        callModel: async (args) => {
          prompts.push(args.prompt);
          return agentSuccess(args);
        },
        saveMatch: async (record) => {
          saved.push(record);
        },
      },
    )) {
      expect(event.type).not.toBe("error");
    }
    expect(prompts.every((prompt) => !prompt.includes("UNTRUSTED EVIDENCE"))).toBe(true);
    expect(saved[0]!.evidence).toBeUndefined();
  });

  it("runJudge renders stored evidence for re-judges", async () => {
    const prompts: string[] = [];
    await runJudge(
      {
        topic: "Topic",
        turns: [],
        providerId: "p",
        model: "m",
        evidence: evidenceBundle(),
      },
      {
        callModel: async (args) => {
          prompts.push(args.prompt);
          return { text: verdictJson, chunks: [] };
        },
      },
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(UNTRUSTED_EVIDENCE_BEGIN);
    expect(prompts[0]).toContain("Supporting analysis.");
  });
});
