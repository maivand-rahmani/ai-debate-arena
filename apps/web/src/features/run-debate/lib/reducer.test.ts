import { describe, expect, it } from "vitest";
import {
  initialRuntimeState,
  reduceDebateRuntime,
  type DebateRuntimeState,
} from "./reducer";
import type {
  DebateStreamEvent,
  DebateStreamStandardState,
  DebateStreamVerdict,
} from "@/shared/api/debate-stream";

const verdict: DebateStreamVerdict = {
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
};

function judgingState(): DebateRuntimeState {
  return {
    ...initialRuntimeState,
    status: "judging",
    judgeActive: true,
    currentPhase: "JUDGING",
  };
}

describe("reduceDebateRuntime done handling", () => {
  it("preserves an error state unchanged when done arrives after an error", () => {
    const errored: DebateRuntimeState = {
      ...judgingState(),
      status: "error",
      errorMessage: "Judge returned invalid verdict",
    };
    const next = reduceDebateRuntime(errored, { type: "stream-event", event: { type: "done" } });
    expect(next.status).toBe("error");
    expect(next.errorMessage).toBe("Judge returned invalid verdict");
    expect(next.verdict).toBeUndefined();
  });

  it("models the live failure sequence: error then done stays error with no fabricated draw", () => {
    let state = judgingState();
    state = reduceDebateRuntime(
      state,
      { type: "stream-event", event: { type: "error", message: "Judge returned invalid verdict" } },
    );
    state = reduceDebateRuntime(state, { type: "stream-event", event: { type: "done" } });
    expect(state.status).toBe("error");
    expect(state.verdict).toBeUndefined();
    expect(state.status).not.toBe("finished");
  });

  it("turns done-without-verdict into a safe error instead of finished", () => {
    const next = reduceDebateRuntime(judgingState(), { type: "stream-event", event: { type: "done" } });
    expect(next.status).toBe("error");
    expect(next.errorMessage).toBe("Match ended without a verdict");
    expect(next.verdict).toBeUndefined();
  });

  it("finishes when a verdict exists", () => {
    const withVerdict: DebateRuntimeState = { ...judgingState(), verdict };
    const next = reduceDebateRuntime(withVerdict, { type: "stream-event", event: { type: "done" } });
    expect(next.status).toBe("finished");
    expect(next.verdict).toEqual(verdict);
  });

  it("keeps an already-finished state unchanged on done", () => {
    const finished: DebateRuntimeState = {
      ...judgingState(),
      status: "finished",
      verdict,
      currentPhase: "FINISHED",
    };
    expect(reduceDebateRuntime(finished, { type: "stream-event", event: { type: "done" } })).toBe(finished);
  });
});

describe("Standard public tool timeline", () => {
  it("keeps tool selection and result visible in server event order without exposing private text", () => {
    let state = reduceDebateRuntime(initialRuntimeState, { type: "start", topic: "Topic", mode: "standard" });
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { type: "phase", phase: "standard-a-opening", side: "A" },
    });
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { type: "tool-start", tool: { callId: "call-1", side: "A", tool: "web_search", query: "current facts", createdAt: "now" } },
    });
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { type: "tool-result", result: { callId: "call-1", side: "A", tool: "web_search", query: "current facts", ok: true, output: "A bounded result", createdAt: "later" } },
    });

    expect(state.mode).toBe("standard");
    expect(state.standardEvents.map((event) => event.type)).toEqual(["tool-start", "tool-result"]);
    expect(state.standardEvents[1]?.type === "tool-result" && state.standardEvents[1].result.output).toBe("A bounded result");
    expect(state.panels).toHaveLength(0);
  });
});

describe("Standard authoritative resource state", () => {
  const snapshot: DebateStreamStandardState = {
    startingCredits: 12,
    speechCost: 1,
    toolCost: 2,
    maxMoves: 12,
    movesUsed: 1,
    moveLimitReached: false,
    closingRound: false,
    sides: {
      A: { side: "A", creditsRemaining: 7, toolsUsed: 2, toolsUsedThisMove: 2, maxToolsPerMove: 2, toolTimeoutMs: 8000, depleted: false },
      B: { side: "B", creditsRemaining: 11, toolsUsed: 0, toolsUsedThisMove: 0, maxToolsPerMove: 2, toolTimeoutMs: 8000, depleted: false },
    },
  };

  it("stores the latest runner snapshot without disturbing the tool timeline order", () => {
    let state = reduceDebateRuntime(initialRuntimeState, { type: "start", topic: "Topic", mode: "standard" });
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { type: "phase", phase: "standard-a-opening", side: "A" },
    });
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { type: "tool-start", tool: { callId: "call-1", side: "A", tool: "web_search", query: "facts", createdAt: "now" } },
    });
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { type: "tool-result", result: { callId: "call-1", side: "A", tool: "web_search", query: "facts", ok: true, output: "result", createdAt: "later" } },
    });
    state = reduceDebateRuntime(state, { type: "stream-event", event: { type: "standard-state", state: snapshot } });

    expect(state.standardState).toEqual(snapshot);
    expect(state.standardEvents.map((event) => event.type)).toEqual(["tool-start", "tool-result"]);

    const later: DebateStreamStandardState = {
      ...snapshot,
      movesUsed: 2,
      closingRound: true,
      sides: {
        A: { ...snapshot.sides.A, creditsRemaining: 4, toolsUsedThisMove: 0 },
        B: { ...snapshot.sides.B, creditsRemaining: 10 },
      },
    };
    state = reduceDebateRuntime(state, { type: "stream-event", event: { type: "standard-state", state: later } });
    expect(state.standardState?.movesUsed).toBe(2);
    expect(state.standardState?.closingRound).toBe(true);
    expect(state.standardState?.sides.A.creditsRemaining).toBe(4);
  });

  it("leaves standardState undefined for Quick and before the first Standard move", () => {
    const quick = reduceDebateRuntime(initialRuntimeState, {
      type: "stream-event",
      event: { type: "phase", phase: "quick-a-opening", side: "A" },
    });
    expect(quick.standardState).toBeUndefined();

    const standardOpening = reduceDebateRuntime(
      { ...initialRuntimeState, mode: "standard" },
      { type: "stream-event", event: { type: "phase", phase: "standard-a-opening", side: "A" } },
    );
    expect(standardOpening.standardState).toBeUndefined();
  });
});

describe("reduceDebateRuntime cancel handling", () => {
  it("cancels an actively streaming match and preserves streamed panels + topic + phase", () => {
    let state = reduceDebateRuntime(
      { ...initialRuntimeState, topic: "Should AI art be copyrightable?" },
      { type: "stream-event", event: { type: "phase", phase: "OPENING_A", side: "A" } },
    );
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { type: "token", side: "A", text: "Hello" },
    });
    const streaming = state;
    expect(streaming.status).toBe("streaming");
    expect(streaming.panels).toHaveLength(1);

    const cancelled = reduceDebateRuntime(streaming, { type: "cancel" });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.topic).toBe("Should AI art be copyrightable?");
    expect(cancelled.currentPhase).toBe("OPENING_A");
    expect(cancelled.currentSide).toBeNull();
    expect(cancelled.panels).toEqual(streaming.panels);
    expect(cancelled.judgeActive).toBe(false);
    expect(cancelled.verdict).toBeUndefined();
    expect(cancelled.errorMessage).toBeUndefined();
  });

  it("cancels while the judge is evaluating", () => {
    const cancelled = reduceDebateRuntime(judgingState(), { type: "cancel" });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.judgeActive).toBe(false);
    expect(cancelled.currentPhase).toBe("JUDGING");
    expect(cancelled.currentSide).toBeNull();
  });

  it("preserves precedence: error wins over cancelled", () => {
    const errored: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "error",
      topic: "Should AI art be copyrightable?",
      errorMessage: "Provider 500",
    };
    const next = reduceDebateRuntime(errored, { type: "cancel" });
    expect(next).toBe(errored);
    expect(next.status).toBe("error");
    expect(next.cancelled).toBe(false);
    expect(next.errorMessage).toBe("Provider 500");
  });

  it("preserves precedence: verdict wins over cancelled", () => {
    const finished: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "finished",
      topic: "Should AI art be copyrightable?",
      verdict,
      currentPhase: "FINISHED",
    };
    const next = reduceDebateRuntime(finished, { type: "cancel" });
    expect(next).toBe(finished);
    expect(next.status).toBe("finished");
    expect(next.cancelled).toBe(false);
    expect(next.verdict).toEqual(verdict);
  });

  it("preserves precedence: an error arriving after cancel flips back to error", () => {
    let state = reduceDebateRuntime(
      { ...initialRuntimeState, topic: "topic" },
      { type: "stream-event", event: { type: "phase", phase: "OPENING_A", side: "A" } },
    );
    state = reduceDebateRuntime(state, { type: "cancel" });
    expect(state.status).toBe("cancelled");
    expect(state.cancelled).toBe(true);

    // A late server-side error event must still surface.
    const next = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { type: "error", message: "Late failure" },
    });
    expect(next.status).toBe("error");
    expect(next.cancelled).toBe(false);
    expect(next.errorMessage).toBe("Late failure");
  });

  it("ignores a done event after cancel so we never fabricate a finish", () => {
    let state = reduceDebateRuntime(
      { ...initialRuntimeState, topic: "topic" },
      { type: "stream-event", event: { type: "phase", phase: "OPENING_A", side: "A" } },
    );
    state = reduceDebateRuntime(state, { type: "cancel" });
    const next = reduceDebateRuntime(state, { type: "stream-event", event: { type: "done" } });
    expect(next.status).toBe("cancelled");
    expect(next.verdict).toBeUndefined();
  });

  it("is idempotent: cancelling twice keeps the cancelled state", () => {
    const once = reduceDebateRuntime(judgingState(), { type: "cancel" });
    const twice = reduceDebateRuntime(once, { type: "cancel" });
    expect(twice).toBe(once);
    expect(twice.status).toBe("cancelled");
  });

  it("abort silently clears cancelled back to idle (no cancelled presentation)", () => {
    const cancelled: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "cancelled",
      cancelled: true,
      topic: "topic",
      currentPhase: "OPENING_A",
    };
    const next = reduceDebateRuntime(cancelled, { type: "abort" });
    expect(next.status).toBe("idle");
    expect(next.cancelled).toBe(false);
    expect(next.errorMessage).toBeUndefined();
  });

  it("reset returns to the initial state with cancelled=false", () => {
    const cancelled: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "cancelled",
      cancelled: true,
      topic: "topic",
      currentPhase: "OPENING_A",
    };
    expect(reduceDebateRuntime(cancelled, { type: "reset" })).toBe(initialRuntimeState);
  });
});

describe("reduceDebateRuntime stream contract v1", () => {
  const envelope = { v: 1 as const, matchId: "match-1", seq: 1 };

  it("accepts enveloped events exactly like bare ones", () => {
    let state = reduceDebateRuntime(
      { ...initialRuntimeState, topic: "topic" },
      { type: "stream-event", event: { ...envelope, type: "phase", phase: "OPENING_A", side: "A" } },
    );
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { ...envelope, seq: 2, type: "token", side: "A", text: "Hello" },
    });
    expect(state.status).toBe("streaming");
    expect(state.panels).toHaveLength(1);
    expect(state.panels[0]?.content).toBe("Hello");
  });

  it("treats an enveloped error/done pair like the bare failure sequence", () => {
    let state = judgingState();
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { ...envelope, type: "error", message: "boom" } satisfies DebateStreamEvent,
    });
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { ...envelope, seq: 3, type: "done", terminal: "error" } satisfies DebateStreamEvent,
    });
    expect(state.status).toBe("error");
    expect(state.verdict).toBeUndefined();
  });

  it("finishes on an enveloped verdict plus completed done", () => {
    let state = judgingState();
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { ...envelope, type: "verdict", verdict } satisfies DebateStreamEvent,
    });
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { ...envelope, seq: 5, type: "done", terminal: "completed" } satisfies DebateStreamEvent,
    });
    expect(state.status).toBe("finished");
    expect(state.verdict).toEqual(verdict);
  });
});

describe("reduceDebateRuntime matchId threading", () => {
  it("captures the matchId from the first enveloped event", () => {
    const next = reduceDebateRuntime(initialRuntimeState, {
      type: "stream-event",
      event: {
        v: 1,
        matchId: "match-abc",
        seq: 1,
        type: "phase",
        phase: "OPENING_A",
        side: "A",
      },
    });
    expect(next.matchId).toBe("match-abc");
  });

  it("keeps the first matchId it sees even if a later event carries a different id", () => {
    let state = reduceDebateRuntime(initialRuntimeState, {
      type: "stream-event",
      event: { v: 1, matchId: "first", seq: 1, type: "phase", phase: "OPENING_A", side: "A" },
    });
    state = reduceDebateRuntime(state, {
      type: "stream-event",
      event: { v: 1, matchId: "second", seq: 2, type: "token", side: "A", text: "hi" },
    });
    expect(state.matchId).toBe("first");
  });

  it("does not set matchId when the envelope is missing", () => {
    const next = reduceDebateRuntime(initialRuntimeState, {
      type: "stream-event",
      event: { type: "phase", phase: "OPENING_A", side: "A" },
    });
    expect(next.matchId).toBeUndefined();
  });

  it("reset clears matchId so the next match starts fresh", () => {
    const running = reduceDebateRuntime(initialRuntimeState, {
      type: "stream-event",
      event: { v: 1, matchId: "old-match", seq: 1, type: "phase", phase: "OPENING_A", side: "A" },
    });
    expect(running.matchId).toBe("old-match");
    const fresh = reduceDebateRuntime(running, { type: "reset" });
    expect(fresh.matchId).toBeUndefined();
  });
});

describe("reduceDebateRuntime rejudge-success", () => {
  const rejudged: DebateStreamVerdict = {
    winner: "B",
    scoreA: 60,
    scoreB: 72,
    criteria: {
      argumentQualityA: 55,
      argumentQualityB: 70,
      rebuttalA: 60,
      rebuttalB: 75,
      consistencyA: 65,
      consistencyB: 70,
      relevanceA: 60,
      relevanceB: 75,
    },
    reasoning: "On a closer look B rebuts more cleanly",
  };

  it("replaces the verdict and stamps judgedAt when a match is already finished", () => {
    const finished: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "finished",
      topic: "topic",
      verdict,
      currentPhase: "FINISHED",
      matchId: "match-x",
    };
    const next = reduceDebateRuntime(finished, {
      type: "rejudge-success",
      verdict: rejudged,
      judgedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(next.status).toBe("finished");
    expect(next.verdict).toEqual(rejudged);
    expect(next.judgedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(next.matchId).toBe("match-x");
    expect(next.errorMessage).toBeUndefined();
  });

  it("clears the cancelled flag when a re-judge arrives for a cancelled match", () => {
    const cancelled: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "cancelled",
      cancelled: true,
      topic: "topic",
      currentPhase: "OPENING_A",
      matchId: "match-y",
    };
    // Cancelled without a verdict should NOT show a verdict panel; rejudge
    // should still set the verdict (server may have produced one before the
    // cancel landed) and reset the cancelled bit.
    const next = reduceDebateRuntime(cancelled, {
      type: "rejudge-success",
      verdict: rejudged,
      judgedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(next.status).toBe("finished");
    expect(next.cancelled).toBe(false);
    expect(next.verdict).toEqual(rejudged);
  });

  it("preserves error precedence: a rejudge never overwrites an error state", () => {
    const errored: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "error",
      topic: "topic",
      errorMessage: "Provider 500",
    };
    const next = reduceDebateRuntime(errored, {
      type: "rejudge-success",
      verdict: rejudged,
      judgedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(next).toBe(errored);
    expect(next.status).toBe("error");
    expect(next.verdict).toBeUndefined();
  });
});
