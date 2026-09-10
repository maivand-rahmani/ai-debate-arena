import { describe, expect, it } from "vitest";
import { initialRuntimeState, type DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { deriveMatchPlayback } from "./match-playback";

const state: DebateRuntimeState = {
  ...initialRuntimeState,
  status: "finished",
  panels: [
    { id: "A:OPENING_A", side: "A", phase: "OPENING_A", content: "A opens", sealed: true },
    { id: "B:OPENING_B", side: "B", phase: "OPENING_B", content: "B opens", sealed: true },
    { id: "A:REBUTTAL_A", side: "A", phase: "REBUTTAL_A", content: "A responds", sealed: true },
    { id: "B:REBUTTAL_B", side: "B", phase: "REBUTTAL_B", content: "B responds", sealed: true },
  ],
};

describe("deriveMatchPlayback", () => {
  it("holds a completed verdict until the viewer has advanced through earlier turns", () => {
    const playback = deriveMatchPlayback(state, 0);
    expect(playback.focusedPanel?.id).toBe("A:OPENING_A");
    expect(playback.unseenTurns).toBe(3);
    expect(playback.canAdvance).toBe(true);
    expect(playback.holdTerminal).toBe(true);
  });

  it("releases the verdict once the last speech is in view", () => {
    const playback = deriveMatchPlayback(state, 3);
    expect(playback.focusedPanel?.id).toBe("B:REBUTTAL_B");
    expect(playback.canAdvance).toBe(false);
    expect(playback.holdTerminal).toBe(false);
  });
});
