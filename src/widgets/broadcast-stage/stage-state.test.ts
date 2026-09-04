import { describe, expect, it } from "vitest";
import { initialRuntimeState, type DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import { deriveStageView } from "./stage-state";

const baseState: DebateRuntimeState = initialRuntimeState;

function withPhase(
  state: DebateRuntimeState,
  phase: DebateRuntimeState["currentPhase"],
  side: DebateRuntimeState["currentSide"],
  status: DebateRuntimeState["status"] = "streaming",
): DebateRuntimeState {
  return { ...state, status, currentPhase: phase, currentSide: side };
}

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

describe("deriveStageView — mode mapping", () => {
  it("is idle for the initial state", () => {
    const view = deriveStageView(baseState);
    expect(view.mode).toBe("idle");
    expect(view.camera).toBe("idle");
    expect(view.round).toBe("none");
    expect(view.activeSide).toBeNull();
  });

  it("is idle when the runtime is starting (no stream yet)", () => {
    const view = deriveStageView({ ...baseState, status: "starting", currentPhase: "CREATED" });
    expect(view.mode).toBe("idle");
    expect(view.camera).toBe("idle");
  });

  it("is speaking when streaming during OPENING_A with currentSide A", () => {
    const view = deriveStageView(withPhase(baseState, "OPENING_A", "A"));
    expect(view.mode).toBe("speaking");
    expect(view.camera).toBe("a");
    expect(view.round).toBe("1");
    expect(view.activeSide).toBe("A");
    expect(view.sideAActivity).toBe("active");
    expect(view.sideBActivity).toBe("idle");
    expect(view.judgeActivity).toBe("idle");
  });

  it("is speaking and camera=b when streaming during OPENING_B", () => {
    const view = deriveStageView(withPhase(baseState, "OPENING_B", "B"));
    expect(view.mode).toBe("speaking");
    expect(view.camera).toBe("b");
    expect(view.round).toBe("1");
    expect(view.activeSide).toBe("B");
  });

  it("encodes rebuttal A as camera=a + round=2", () => {
    const view = deriveStageView(withPhase(baseState, "REBUTTAL_A", "A"));
    expect(view.mode).toBe("speaking");
    expect(view.camera).toBe("a");
    expect(view.round).toBe("2");
  });

  it("encodes rebuttal B as camera=b + round=2", () => {
    const view = deriveStageView(withPhase(baseState, "REBUTTAL_B", "B"));
    expect(view.mode).toBe("speaking");
    expect(view.camera).toBe("b");
    expect(view.round).toBe("2");
  });

  it("is judging when the runtime status is judging", () => {
    const view = deriveStageView({
      ...baseState,
      status: "judging",
      currentPhase: "JUDGING",
      currentSide: null,
      judgeActive: true,
    });
    expect(view.mode).toBe("judging");
    expect(view.camera).toBe("judge");
    expect(view.round).toBe("none");
    expect(view.activeSide).toBeNull();
    expect(view.judgeActivity).toBe("active");
  });

  it("is verdict when the runtime has a verdict", () => {
    const view = deriveStageView({
      ...baseState,
      status: "finished",
      currentPhase: "FINISHED",
      currentSide: null,
      verdict,
    });
    expect(view.mode).toBe("verdict");
    expect(view.camera).toBe("verdict");
    expect(view.judgeActivity).toBe("active");
    expect(view.stageLabel).toBe("Verdict reached");
  });

  it("is cancelled when the runtime was cancelled", () => {
    const view = deriveStageView({
      ...baseState,
      status: "cancelled",
      cancelled: true,
      currentPhase: "OPENING_A",
      currentSide: null,
    });
    expect(view.mode).toBe("cancelled");
    expect(view.camera).toBe("idle");
    expect(view.stageLabel).toBe("Match ended");
  });

  it("is error when the runtime reported a stream failure", () => {
    const view = deriveStageView({
      ...baseState,
      status: "error",
      currentPhase: "REBUTTAL_A",
      currentSide: null,
      errorMessage: "Provider 500",
    });
    expect(view.mode).toBe("error");
    expect(view.camera).toBe("idle");
    expect(view.stageLabel).toBe("Provider 500");
  });

  it("uses the fallback label for an error without a message", () => {
    const view = deriveStageView({ ...baseState, status: "error", errorMessage: undefined });
    expect(view.mode).toBe("error");
    expect(view.stageLabel).toBe("Match error");
  });
});

describe("deriveStageView — root data attributes", () => {
  it("emits the four CSS data attributes for a speaking A turn", () => {
    const view = deriveStageView(withPhase(baseState, "OPENING_A", "A"));
    expect(view.rootDataAttributes).toEqual({
      "data-stage": "speaking",
      "data-camera": "a",
      "data-round": "1",
      "data-active-side": "a",
    });
  });

  it("emits data-round=2 and data-active-side=b for rebuttal B", () => {
    const view = deriveStageView(withPhase(baseState, "REBUTTAL_B", "B"));
    expect(view.rootDataAttributes).toEqual({
      "data-stage": "speaking",
      "data-camera": "b",
      "data-round": "2",
      "data-active-side": "b",
    });
  });

  it("emits data-active-side=none outside of an agent speaking turn", () => {
    const view = deriveStageView({
      ...baseState,
      status: "judging",
      currentPhase: "JUDGING",
      currentSide: null,
      judgeActive: true,
    });
    expect(view.rootDataAttributes).toEqual({
      "data-stage": "judging",
      "data-camera": "judge",
      "data-round": "none",
      "data-active-side": "none",
    });
  });

  it("emits data-stage=cancelled when the match was stopped", () => {
    const view = deriveStageView({
      ...baseState,
      status: "cancelled",
      cancelled: true,
    });
    expect(view.rootDataAttributes["data-stage"]).toBe("cancelled");
    expect(view.rootDataAttributes["data-camera"]).toBe("idle");
    expect(view.rootDataAttributes["data-active-side"]).toBe("none");
  });
});

describe("deriveStageView — per-element activity", () => {
  it("lights up only Agent A during OPENING_A", () => {
    const view = deriveStageView(withPhase(baseState, "OPENING_A", "A"));
    expect(view.sideAActivity).toBe("active");
    expect(view.sideBActivity).toBe("idle");
    expect(view.judgeActivity).toBe("idle");
  });

  it("lights up only Agent B during OPENING_B", () => {
    const view = deriveStageView(withPhase(baseState, "OPENING_B", "B"));
    expect(view.sideAActivity).toBe("idle");
    expect(view.sideBActivity).toBe("active");
    expect(view.judgeActivity).toBe("idle");
  });

  it("lights up the Judge during judging AND verdict (so the panel keeps its glow)", () => {
    const judging = deriveStageView({
      ...baseState,
      status: "judging",
      currentPhase: "JUDGING",
      currentSide: null,
      judgeActive: true,
    });
    expect(judging.judgeActivity).toBe("active");

    const finished = deriveStageView({
      ...baseState,
      status: "finished",
      currentPhase: "FINISHED",
      currentSide: null,
      verdict,
    });
    expect(finished.judgeActivity).toBe("active");
  });

  it("does not light up the Judge when only judgeActive is true but status is idle", () => {
    // This protects against stale runtime state where judgeActive carries over
    // from a previous match — the desk should stay calm until judging actually begins.
    const view = deriveStageView({ ...baseState, judgeActive: true });
    expect(view.judgeActivity).toBe("idle");
  });
});

describe("deriveStageView — invariants", () => {
  it("always produces a non-empty stageLabel", () => {
    const labels = [
      deriveStageView(baseState).stageLabel,
      deriveStageView(withPhase(baseState, "OPENING_A", "A")).stageLabel,
      deriveStageView({ ...baseState, status: "judging", currentPhase: "JUDGING", currentSide: null }).stageLabel,
      deriveStageView({ ...baseState, status: "finished", currentPhase: "FINISHED", verdict }).stageLabel,
      deriveStageView({ ...baseState, status: "cancelled", cancelled: true }).stageLabel,
      deriveStageView({ ...baseState, status: "error", errorMessage: "boom" }).stageLabel,
    ];
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("returns a fresh object on each call (no shared mutable state)", () => {
    const a = deriveStageView(withPhase(baseState, "OPENING_A", "A"));
    const b = deriveStageView(withPhase(baseState, "OPENING_A", "A"));
    expect(a).not.toBe(b);
    expect(a.rootDataAttributes).not.toBe(b.rootDataAttributes);
    expect(a.rootDataAttributes).toEqual(b.rootDataAttributes);
  });
});
