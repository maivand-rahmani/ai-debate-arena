import { describe, expect, it } from "vitest";
import { deriveSceneSignal, isVerdictCueEligible } from "./scene-signal";
import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";

const finalVerdict: DebateStreamVerdict = {
  winner: "A",
  reasoning: "clear",
  scoreA: 80,
  scoreB: 40,
  criteria: {
    argumentQualityA: 75,
    argumentQualityB: 45,
    rebuttalA: 70,
    rebuttalB: 50,
    consistencyA: 80,
    consistencyB: 40,
    relevanceA: 75,
    relevanceB: 45,
  },
};

function baseState(overrides: Partial<DebateRuntimeState> = {}): DebateRuntimeState {
  return {
    status: "idle",
    mode: "idle",
    topic: "Sample topic",
    panels: [],
    currentSide: null,
    currentPhase: "OPENING_A",
    ...overrides,
  } as DebateRuntimeState;
}

describe("deriveSceneSignal", () => {
  it("reports idle mode + idle camera for the starting state", () => {
    const sig = deriveSceneSignal(baseState(), false);
    expect(sig.mode).toBe("idle");
    expect(sig.camera).toBe("idle");
    expect(sig.verdictWinner).toBeNull();
    expect(sig.reducedMotion).toBe(false);
    expect(sig.verdictStamp).toBeNull();
  });

  it("flips to contender-a camera while A is streaming", () => {
    const sig = deriveSceneSignal(
      baseState({ status: "streaming", currentSide: "A", currentPhase: "OPENING_A" }),
      false,
    );
    expect(sig.mode).toBe("speaking");
    expect(sig.camera).toBe("a");
  });

  it("flips to contender-b camera when B streams, rebuttal when round 2", () => {
    const sig = deriveSceneSignal(
      baseState({ status: "streaming", currentSide: "B", currentPhase: "REBUTTAL_B" }),
      false,
    );
    expect(sig.camera).toBe("rebuttal");
  });

  it("forwards flexible turn metadata to camera directors", () => {
    const sig = deriveSceneSignal(
      baseState({ mode: "quick", status: "streaming", currentSide: "A", currentPhase: "quick-a-response-2" }),
      false,
    );
    expect(sig.camera).toBe("rebuttal");
    expect(sig.turn).toMatchObject({ id: "quick-a-response-2", side: "A", role: "response", order: 5 });
  });

  it("follows the focused panel side over the live streaming side", () => {
    const live = baseState({ status: "streaming", currentSide: "A", currentPhase: "OPENING_A" });
    const unfocused = deriveSceneSignal(live, false);
    expect(unfocused.camera).toBe("a");
    const focused = deriveSceneSignal(live, false, undefined, { side: "B", phase: "OPENING_B" });
    expect(focused.mode).toBe("speaking");
    expect(focused.camera).toBe("b");
    expect(focused.turn).toMatchObject({ side: "B", role: "opening" });
  });

  it("presents a focused speech while the runtime is judging", () => {
    const sig = deriveSceneSignal(
      baseState({ status: "judging", currentPhase: "JUDGING", currentSide: null, judgeActive: true }),
      false,
      undefined,
      { side: "A", phase: "REBUTTAL_A" },
    );
    expect(sig.mode).toBe("speaking");
    expect(sig.camera).toBe("rebuttal");
    expect(sig.turn).toMatchObject({ side: "A", role: "response" });
  });

  it("computes moods (deriving from a streaming panel)", () => {
    const sig = deriveSceneSignal(
      baseState({
        status: "streaming",
        currentSide: "A",
        currentPhase: "OPENING_A",
        panels: [
          {
            id: "p1",
            side: "A",
            phase: "OPENING_A",
            content: "very short",
            sealed: false,
            model: "mock",
          },
        ],
      }),
      false,
    );
    expect(sig.moods.a).toBeDefined();
    expect(sig.moods.b).toBeDefined();
    expect(sig.moods.judge).toBe("standing-by");
  });

  it("stamps the verdict once the runtime reports finished with a verdict", () => {
    const sig = deriveSceneSignal(
      baseState({
        status: "finished",
        verdict: {
          winner: "A",
          reasoning: "clear",
          scoreA: 80,
          scoreB: 40,
          criteria: {
            argumentQualityA: 75,
            argumentQualityB: 45,
            rebuttalA: 70,
            rebuttalB: 50,
            consistencyA: 80,
            consistencyB: 40,
            relevanceA: 75,
            relevanceB: 45,
          },
        },
        currentSide: null,
        currentPhase: "FINISHED",
      }),
      false,
    );
    expect(sig.mode).toBe("verdict");
    expect(sig.camera).toBe("verdict");
    expect(sig.verdictWinner).toBe("A");
    expect(sig.verdictStamp).toContain("|A|");
  });

  it("returns a different stamp for each fresh verdict", () => {
    const s1 = deriveSceneSignal(
      baseState({
        status: "finished",
        verdict: {
          winner: "A",
          reasoning: "x",
          scoreA: 51,
          scoreB: 49,
          criteria: {
            argumentQualityA: 50,
            argumentQualityB: 50,
            rebuttalA: 50,
            rebuttalB: 50,
            consistencyA: 51,
            consistencyB: 49,
            relevanceA: 51,
            relevanceB: 49,
          },
        },
        matchId: "match-1",
      }),
      false,
    );
    const s2 = deriveSceneSignal(
      baseState({
        status: "finished",
        verdict: {
          winner: "B",
          reasoning: "x",
          scoreA: 49,
          scoreB: 51,
          criteria: {
            argumentQualityA: 50,
            argumentQualityB: 50,
            rebuttalA: 50,
            rebuttalB: 50,
            consistencyA: 49,
            consistencyB: 51,
            relevanceA: 49,
            relevanceB: 51,
          },
        },
        matchId: "match-1",
      }),
      false,
    );
    expect(s1.verdictStamp).not.toBe(s2.verdictStamp);
  });

  it("propagates reducedMotion through", () => {
    expect(deriveSceneSignal(baseState(), true).reducedMotion).toBe(true);
    expect(deriveSceneSignal(baseState(), false).reducedMotion).toBe(false);
  });
});

describe("deriveSceneSignal — terminal-frame gating", () => {
  const finished = baseState({
    status: "finished",
    verdict: finalVerdict,
    currentSide: null,
    currentPhase: "FINISHED",
  });

  it("holds the winner, verdict camera and victory moods while the final speech is read", () => {
    const held = deriveSceneSignal(
      finished,
      false,
      undefined,
      { side: "A", phase: "REBUTTAL_A" },
      false,
    );
    expect(held.isTerminalFrame).toBe(false);
    expect(held.verdictWinner).toBeNull();
    expect(held.verdictStamp).toBeNull();
    expect(held.verdictReasoning).toBeUndefined();
    expect(held.mode).toBe("speaking");
    expect(held.camera).not.toBe("verdict");
    expect(held.moods.a).toBe("confident");
    expect(held.moods.b).toBe("listening");
  });

  it("reveals the winner and victory moods only on the terminal frame", () => {
    const terminal = deriveSceneSignal(finished, false, undefined, null, true);
    expect(terminal.isTerminalFrame).toBe(true);
    expect(terminal.verdictWinner).toBe("A");
    expect(terminal.verdictStamp).toContain("|A|");
    expect(terminal.mode).toBe("verdict");
    expect(terminal.camera).toBe("verdict");
    expect(terminal.moods.a).toBe("victorious");
    expect(terminal.moods.b).toBe("defeated");
  });

  it("keeps reduced motion intact while the final speech is held", () => {
    const held = deriveSceneSignal(
      finished,
      true,
      undefined,
      { side: "A", phase: "REBUTTAL_A" },
      false,
    );
    expect(held.reducedMotion).toBe(true);
    expect(held.isTerminalFrame).toBe(false);
  });

  it("gates the verdict cue director on a fresh terminal-frame verdict", () => {
    const held = deriveSceneSignal(
      finished,
      false,
      undefined,
      { side: "A", phase: "REBUTTAL_A" },
      false,
    );
    const terminal = deriveSceneSignal(finished, false, undefined, null, true);
    expect(isVerdictCueEligible(held)).toBe(false);
    expect(isVerdictCueEligible(terminal)).toBe(true);
    expect(isVerdictCueEligible(undefined)).toBe(false);
    expect(isVerdictCueEligible(deriveSceneSignal(baseState(), false))).toBe(false);
  });
});
