import { describe, expect, it, vi } from "vitest";
import type { MatchRecord, RejudgeSuccess } from "@/shared/api/matches";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import { performLiveRejudge } from "./live-rejudge";

const verdict: DebateStreamVerdict = {
  winner: "A",
  scoreA: 81,
  scoreB: 75,
  criteria: {
    argumentQualityA: 82,
    argumentQualityB: 74,
    rebuttalA: 80,
    rebuttalB: 73,
    consistencyA: 79,
    consistencyB: 76,
    relevanceA: 83,
    relevanceB: 77,
  },
  reasoning: "A was more consistent",
};

function rejudgeSuccess(): RejudgeSuccess {
  return {
    judgedAt: "2026-09-15T10:00:00.000Z",
    summary: {
      id: "match-1",
      topic: "topic",
      date: "2026-09-15T09:00:00.000Z",
      mode: "quick",
      winner: "A",
      terminal: "completed",
    },
  };
}

describe("performLiveRejudge", () => {
  it("resolves a failed live re-judge instead of rejecting", async () => {
    const failure = new Error("The judge is unavailable.");
    const onFailure = vi.fn();
    const onRefreshFailure = vi.fn();
    const onVerdict = vi.fn();

    const result = await performLiveRejudge("match-1", {
      rejudge: () => Promise.reject(failure),
      refresh: () => Promise.resolve({ verdict } as MatchRecord),
      onVerdict,
      onRefreshFailure,
      onFailure,
    });

    expect(result).toEqual({ ok: false });
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(failure);
    expect(onRefreshFailure).not.toHaveBeenCalled();
    expect(onVerdict).not.toHaveBeenCalled();
  });

  it("publishes the refreshed verdict on success", async () => {
    const onVerdict = vi.fn();
    const result = await performLiveRejudge("match-1", {
      rejudge: () => Promise.resolve(rejudgeSuccess()),
      refresh: () => Promise.resolve({ verdict } as MatchRecord),
      onVerdict,
      onRefreshFailure: vi.fn(),
      onFailure: vi.fn(),
    });

    expect(result).toEqual({
      ok: true,
      judgedAt: "2026-09-15T10:00:00.000Z",
      winner: "A",
      refreshed: true,
    });
    expect(onVerdict).toHaveBeenCalledExactlyOnceWith(verdict, "2026-09-15T10:00:00.000Z");
  });

  it("keeps the new judgement when only the refresh fails", async () => {
    const refreshFailure = new Error("Record unavailable.");
    const onRefreshFailure = vi.fn();
    const onVerdict = vi.fn();
    const result = await performLiveRejudge("match-1", {
      rejudge: () => Promise.resolve(rejudgeSuccess()),
      refresh: () => Promise.reject(refreshFailure),
      onVerdict,
      onRefreshFailure,
      onFailure: vi.fn(),
    });

    expect(result).toEqual({
      ok: true,
      judgedAt: "2026-09-15T10:00:00.000Z",
      winner: "A",
      refreshed: false,
    });
    expect(onRefreshFailure).toHaveBeenCalledExactlyOnceWith(refreshFailure);
    expect(onVerdict).not.toHaveBeenCalled();
  });
});
