import { describe, expect, it } from "vitest";
import {
  runDebate,
  runJudge,
  sessionKeyForMatchSlot,
  type DebateSlot,
  type ModelCallArgs,
} from "../src/runner";

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

const noopSave = async (): Promise<void> => {};

function quickInput() {
  return {
    topic: "Should AI be regulated?",
    mode: "quick" as const,
    agentA: { providerId: "p1", model: "m1", position: "FOR" as const },
    agentB: { providerId: "p2", model: "m2", position: "AGAINST" as const },
  };
}

async function stubCallModel(seen: ModelCallArgs[]) {
  return async (args: ModelCallArgs) => {
    seen.push(args);
    if (args.kind === "judge") return { text: verdictJson, chunks: [] };
    return { text: `text-${args.providerId}`, chunks: [] };
  };
}

describe("sessionKeyForMatchSlot", () => {
  it("derives <matchId>:<slot> keys", () => {
    expect(sessionKeyForMatchSlot("m-1", "agent-a")).toBe("m-1:agent-a");
    expect(sessionKeyForMatchSlot("m-1", "agent-b")).toBe("m-1:agent-b");
    expect(sessionKeyForMatchSlot("m-1", "judge")).toBe("m-1:judge");
  });

  it("is stable per match+slot and unique across matches/slots", () => {
    const slots: DebateSlot[] = ["agent-a", "agent-b", "judge"];
    for (const slot of slots) {
      expect(sessionKeyForMatchSlot("m-1", slot)).toBe(sessionKeyForMatchSlot("m-1", slot));
    }
    const keys = new Set<string>();
    for (const matchId of ["m-1", "m-2"]) {
      for (const slot of slots) keys.add(sessionKeyForMatchSlot(matchId, slot));
    }
    expect(keys.size).toBe(6);
  });
});

describe("runDebate session-key wiring", () => {
  it("passes stable per-slot keys for every agent turn, retry, and judge call", async () => {
    const seen: ModelCallArgs[] = [];
    const matchId = "match-session-1";
    let eventCount = 0;
    for await (const event of runDebate(quickInput(), {
      matchId,
      saveMatch: noopSave,
      callModel: await stubCallModel(seen),
    })) {
      // Drain the full run (4 agent turns + judge + retry-safe judge path).
      void event;
      eventCount += 1;
    }
    expect(eventCount).toBeGreaterThan(0);

    expect(seen.length).toBeGreaterThanOrEqual(5);
    const agents = seen.filter((args) => args.kind === "agent");
    const judges = seen.filter((args) => args.kind === "judge");
    expect(agents).toHaveLength(4);
    // Turn order: A, B, A, B — each side reuses its own slot key.
    expect(agents.map((args) => args.sessionKey)).toEqual([
      "match-session-1:agent-a",
      "match-session-1:agent-b",
      "match-session-1:agent-a",
      "match-session-1:agent-b",
    ]);
    // Judge attempts (initial + any retry) share the judge key.
    expect(judges.length).toBeGreaterThanOrEqual(1);
    expect(judges.every((args) => args.sessionKey === "match-session-1:judge")).toBe(true);
  });

  it("uses different keys for different matches", async () => {
    const seenA: ModelCallArgs[] = [];
    const seenB: ModelCallArgs[] = [];
    const drain = async (matchId: string, seen: ModelCallArgs[]): Promise<void> => {
      let eventCount = 0;
      for await (const event of runDebate(quickInput(), {
        matchId,
        saveMatch: noopSave,
        callModel: await stubCallModel(seen),
      })) {
        void event;
        eventCount += 1;
      }
      expect(eventCount).toBeGreaterThan(0);
    };
    await drain("match-a", seenA);
    await drain("match-b", seenB);
    const keysA = new Set(seenA.map((args) => args.sessionKey));
    const keysB = new Set(seenB.map((args) => args.sessionKey));
    expect(keysA).toEqual(new Set(["match-a:agent-a", "match-a:agent-b", "match-a:judge"]));
    expect(keysB).toEqual(new Set(["match-b:agent-a", "match-b:agent-b", "match-b:judge"]));
  });
});

describe("runJudge session-key wiring", () => {
  it("forwards the judge session key (initial + retry) so re-judges reuse it", async () => {
    const seen: ModelCallArgs[] = [];
    const deps = {
      callModel: async (args: ModelCallArgs) => {
        seen.push(args);
        return { text: verdictJson, chunks: [] };
      },
      sessionKey: "stored-match:judge",
    };
    const result = await runJudge(
      { topic: "T", turns: [], providerId: "p", model: "m" },
      deps,
    );
    expect(result.verdict.winner).toBe("A");
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.every((args) => args.sessionKey === "stored-match:judge")).toBe(true);

    // A second re-judge of the same stored match passes the same key again.
    seen.length = 0;
    await runJudge({ topic: "T", turns: [], providerId: "p", model: "m" }, deps);
    expect(seen.every((args) => args.sessionKey === "stored-match:judge")).toBe(true);
  });
});
