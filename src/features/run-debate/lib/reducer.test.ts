import { describe, expect, it } from "vitest";
import {
  initialRuntimeState,
  reduceDebateRuntime,
  type DebateRuntimeState,
} from "./reducer";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";

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
