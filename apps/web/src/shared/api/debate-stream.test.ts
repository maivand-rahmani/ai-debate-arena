import { afterEach, describe, expect, it, vi } from "vitest";
import { openDebateStream, type DebateStreamEvent, type DebateStreamRequest } from "./debate-stream";

const request: DebateStreamRequest = {
  topic: "Topic",
  mode: "quick",
  agentA: { providerId: "p1", model: "m1", position: "FOR" },
  agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
};

function stubStream(lines: readonly unknown[]): void {
  const body = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  vi.stubGlobal(
    "fetch",
    (async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      })) as unknown as typeof fetch,
  );
}

async function collect(): Promise<DebateStreamEvent[]> {
  const events: DebateStreamEvent[] = [];
  for await (const event of openDebateStream(request).events) events.push(event);
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("debate-stream judge-activity normalization", () => {
  it("forwards a bounded judge-activity checkpoint with the v1 envelope", async () => {
    stubStream([
      {
        v: 1,
        matchId: "match-1",
        seq: 1,
        type: "judge-activity",
        activity: {
          stage: "evidence-check",
          turnCount: 6,
          evidenceCount: 3,
          successfulEvidenceCount: 2,
          criteria: ["argument quality", "rebuttal quality", "consistency", "relevance"],
        },
      },
      { v: 1, matchId: "match-1", seq: 2, type: "done", terminal: "completed" },
    ]);

    const events = await collect();
    const activityEvent = events.find((event) => event.type === "judge-activity");
    expect(activityEvent).toEqual({
      v: 1,
      matchId: "match-1",
      seq: 1,
      type: "judge-activity",
      activity: {
        stage: "evidence-check",
        turnCount: 6,
        evidenceCount: 3,
        successfulEvidenceCount: 2,
        criteria: ["argument quality", "rebuttal quality", "consistency", "relevance"],
      },
    });
  });

  it("coerces malformed counts to zero instead of crashing the stream", async () => {
    stubStream([
      {
        v: 1,
        matchId: "match-2",
        seq: 1,
        type: "judge-activity",
        activity: {
          stage: "record-loaded",
          turnCount: -4,
          evidenceCount: "many",
          successfulEvidenceCount: Number.NaN,
        },
      },
      { v: 1, matchId: "match-2", seq: 2, type: "done", terminal: "completed" },
    ]);

    const events = await collect();
    const activityEvent = events.find((event) => event.type === "judge-activity");
    expect(activityEvent?.type).toBe("judge-activity");
    if (activityEvent?.type !== "judge-activity") return;
    expect(activityEvent.activity.turnCount).toBe(0);
    expect(activityEvent.activity.evidenceCount).toBe(0);
    expect(activityEvent.activity.successfulEvidenceCount).toBe(0);
    expect(activityEvent.activity.criteria).toEqual([]);
  });

  it("drops unknown judge-activity stages and never re-labels them as speech or tools", async () => {
    stubStream([
      {
        v: 1,
        matchId: "match-3",
        seq: 1,
        type: "judge-activity",
        activity: { stage: "chain-of-thought", turnCount: 6, evidenceCount: 0, successfulEvidenceCount: 0 },
      },
      { v: 1, matchId: "match-3", seq: 2, type: "done", terminal: "completed" },
    ]);

    const events = await collect();
    expect(events.map((event) => event.type)).toEqual(["done"]);
    expect(events.some((event) => event.type === "token" || event.type === "turn" || event.type === "tool-start")).toBe(false);
  });
});
