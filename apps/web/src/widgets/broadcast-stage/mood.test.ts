import { describe, expect, it } from "vitest";
import { initialRuntimeState, type DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import { deriveMoods } from "./mood";

function withPhase(
  state: DebateRuntimeState,
  phase: DebateRuntimeState["currentPhase"],
  side: DebateRuntimeState["currentSide"],
  status: DebateRuntimeState["status"] = "streaming",
): DebateRuntimeState {
  return { ...state, status, currentPhase: phase, currentSide: side };
}

function panelFor(
  state: DebateRuntimeState,
  side: "A" | "B",
  content: string,
  sealed: boolean,
): DebateRuntimeState {
  const phase = side === "A" ? "OPENING_A" : "OPENING_B";
  return {
    ...state,
    panels: [
      ...state.panels,
      { id: `${side}:${phase}`, side, phase, content, sealed, model: "test" },
    ],
  };
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
  reasoning: "A wins clearly",
};

describe("deriveMoods — terminal states", () => {
  it("uses the panicking / dismayed palette on error", () => {
    const view = deriveMoods({
      ...initialRuntimeState,
      status: "error",
      currentPhase: "REBUTTAL_A",
      errorMessage: "Provider 500",
    });
    expect(view).toEqual({ a: "panicking", b: "panicking", judge: "dismayed" });
  });

  it("uses the defeated / stoic palette on cancelled", () => {
    const view = deriveMoods({
      ...initialRuntimeState,
      status: "cancelled",
      cancelled: true,
      currentPhase: "OPENING_A",
    });
    expect(view).toEqual({ a: "defeated", b: "defeated", judge: "stoic" });
  });

  it("lights the winning side victorious and the loser defeated on finished", () => {
    const view = deriveMoods({
      ...initialRuntimeState,
      status: "finished",
      currentPhase: "FINISHED",
      verdict,
    });
    expect(view.a).toBe("victorious");
    expect(view.b).toBe("defeated");
    expect(view.judge).toBe("stoic");
  });

  it("marks both sides confused on a draw verdict", () => {
    const draw: DebateStreamVerdict = { ...verdict, winner: "DRAW", scoreA: 70, scoreB: 70 };
    const view = deriveMoods({
      ...initialRuntimeState,
      status: "finished",
      currentPhase: "FINISHED",
      verdict: draw,
    });
    expect(view.a).toBe("confused");
    expect(view.b).toBe("confused");
    expect(view.judge).toBe("impressed");
  });

  it("marks the judge impressed on a close verdict (margin <= 4)", () => {
    const closeVerdict: DebateStreamVerdict = { ...verdict, winner: "A", scoreA: 78, scoreB: 76 };
    const view = deriveMoods({
      ...initialRuntimeState,
      status: "finished",
      verdict: closeVerdict,
      currentPhase: "FINISHED",
    });
    expect(view.judge).toBe("impressed");
  });

  it("marks the judge not-impressed on a lopsided verdict (margin >= 25)", () => {
    const blowout: DebateStreamVerdict = { ...verdict, winner: "A", scoreA: 90, scoreB: 60 };
    const view = deriveMoods({
      ...initialRuntimeState,
      status: "finished",
      verdict: blowout,
      currentPhase: "FINISHED",
    });
    expect(view.judge).toBe("not-impressed");
  });
});

describe("deriveMoods — judging states", () => {
  it("lights both sides listening while the judge is evaluating", () => {
    const view = deriveMoods({
      ...initialRuntimeState,
      status: "judging",
      judgeActive: true,
      currentPhase: "JUDGING",
    });
    expect(view.a).toBe("listening");
    expect(view.b).toBe("listening");
    expect(view.judge).toBe("evaluating");
  });

  it("falls back to standing-by when status is judging but judgeActive is false", () => {
    const view = deriveMoods({
      ...initialRuntimeState,
      status: "judging",
      judgeActive: false,
      currentPhase: "JUDGING",
    });
    expect(view.judge).toBe("standing-by");
  });
});

describe("deriveMoods — streaming heuristics", () => {
  it("is thinking for both sides on idle / starting", () => {
    const idle = deriveMoods(initialRuntimeState);
    expect(idle).toEqual({ a: "thinking", b: "thinking", judge: "standing-by" });

    const starting = deriveMoods({ ...initialRuntimeState, status: "starting", currentPhase: "CREATED" });
    expect(starting).toEqual({ a: "thinking", b: "thinking", judge: "standing-by" });
  });

  it("is listening on the idle side and speaking on the active side", () => {
    let state = withPhase(initialRuntimeState, "OPENING_A", "A");
    state = panelFor(state, "A", "Hello there, friend.", false);
    const view = deriveMoods(state);
    expect(view.a).toBe("speaking");
    expect(view.b).toBe("listening");
  });

  it("treats a short open-ended turn as thinking until tokens land", () => {
    let state = withPhase(initialRuntimeState, "OPENING_A", "A");
    state = panelFor(state, "A", "H", false);
    expect(deriveMoods(state).a).toBe("thinking");
  });

  it("treats a long, still-streaming turn as heated / panicking", () => {
    let state = withPhase(initialRuntimeState, "OPENING_A", "A");
    state = panelFor(state, "A", "x".repeat(500), false);
    expect(deriveMoods(state).a).toBe("heated");

    state = panelFor(state, "A", "y".repeat(2000), false);
    expect(deriveMoods(state).a).toBe("panicking");
  });

  it("treats a sealed turn as confident on the active side", () => {
    let state = withPhase(initialRuntimeState, "OPENING_A", "A");
    state = panelFor(state, "A", "Hello there, friend. " + "x".repeat(120), true);
    expect(deriveMoods(state).a).toBe("confident");
  });
});
