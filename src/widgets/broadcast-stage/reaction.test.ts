import { describe, expect, it } from "vitest";
import { initialRuntimeState, type DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import { deriveReaction, REACTIONS } from "./reaction";

function panel(content: string, sealed = false): DebateRuntimeState["panels"][number] {
  return { id: "A:OPENING_A", side: "A", phase: "OPENING_A", content, sealed, model: "test" };
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
  reasoning: "ok",
};

describe("deriveReaction — terminal states", () => {
  it("returns argument-stopped on error", () => {
    const view = deriveReaction({
      ...initialRuntimeState,
      status: "error",
      errorMessage: "Provider 500",
    });
    expect(view).toEqual(REACTIONS["argument-stopped"]);
  });

  it("returns timeout on cancelled", () => {
    const view = deriveReaction({
      ...initialRuntimeState,
      status: "cancelled",
      cancelled: true,
    });
    expect(view).toEqual(REACTIONS.timeout);
  });

  it("returns judge-not-impressed on a lopsided finished verdict (margin >= 25)", () => {
    const blowout: DebateStreamVerdict = { ...verdict, winner: "A", scoreA: 92, scoreB: 60 };
    const view = deriveReaction({
      ...initialRuntimeState,
      status: "finished",
      verdict: blowout,
    });
    expect(view).toEqual(REACTIONS["judge-not-impressed"]);
  });

  it("returns verdict-landed on a close finished verdict", () => {
    const close: DebateStreamVerdict = { ...verdict, scoreA: 78, scoreB: 76 };
    const view = deriveReaction({
      ...initialRuntimeState,
      status: "finished",
      verdict: close,
    });
    expect(view).toEqual(REACTIONS["verdict-landed"]);
  });

  it("returns nothing when the verdict is missing on finished", () => {
    expect(deriveReaction({ ...initialRuntimeState, status: "finished" })).toBeNull();
  });
});

describe("deriveReaction — streaming states", () => {
  it("returns cooking on a long streaming turn (>= 400 chars)", () => {
    const view = deriveReaction({
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "OPENING_A",
      currentSide: "A",
      panels: [panel("x".repeat(420))],
    });
    expect(view).toEqual(REACTIONS.cooking);
  });

  it("returns panicking on a very long streaming turn (>= 1500 chars)", () => {
    const view = deriveReaction({
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "OPENING_A",
      currentSide: "A",
      panels: [panel("x".repeat(1700))],
    });
    expect(view).toEqual(REACTIONS.panicking);
  });

  it("returns objection on a rebuttal phase, even when no long token yet", () => {
    const view = deriveReaction({
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "REBUTTAL_A",
      currentSide: "A",
      panels: [panel("Hi")],
    });
    expect(view).toEqual(REACTIONS.objection);
  });

  it("prefers cooking/panicking over objection when the token length crosses the threshold", () => {
    const view = deriveReaction({
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "REBUTTAL_A",
      currentSide: "A",
      panels: [panel("x".repeat(1800))],
    });
    expect(view).toEqual(REACTIONS.panicking);
  });

  it("returns null on idle / starting / judging", () => {
    expect(deriveReaction(initialRuntimeState)).toBeNull();
    expect(
      deriveReaction({ ...initialRuntimeState, status: "starting", currentPhase: "CREATED" }),
    ).toBeNull();
    expect(
      deriveReaction({
        ...initialRuntimeState,
        status: "judging",
        judgeActive: true,
        currentPhase: "JUDGING",
      }),
    ).toBeNull();
  });

  it("does not react to a sealed turn (the turn is already over)", () => {
    const view = deriveReaction({
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "OPENING_A",
      currentSide: "A",
      panels: [panel("x".repeat(800), true)],
    });
    // Phase is still OPENING_A — only the rebuttal check remains, but the
    // length heuristic should not fire on a sealed turn.
    expect(view).toBeNull();
  });
});
