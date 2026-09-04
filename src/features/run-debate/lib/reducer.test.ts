import { describe, expect, it } from "vitest";
import {
  initialRuntimeState,
  reduceDebateRuntime,
  type DebateRuntimeState,
} from "./reducer";
import type { DebateStreamEvent, DebateStreamVerdict } from "@/shared/api/debate-stream";

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
