import { describe, expect, it } from "vitest";
import { deriveSceneSignal } from "./scene-signal";
import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";

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
