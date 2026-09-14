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

  it("keeps the final speech on screen until the viewer continues to the judge", () => {
    const playback = deriveMatchPlayback(state, 3);
    expect(playback.focusedPanel?.id).toBe("B:REBUTTAL_B");
    expect(playback.unseenTurns).toBe(0);
    expect(playback.nextIndex).toBe(4);
    expect(playback.canAdvance).toBe(true);
    expect(playback.holdTerminal).toBe(true);
  });

  it("reveals the verdict only after the final continue action", () => {
    const playback = deriveMatchPlayback(state, 4);
    expect(playback.focusedPanel).toBeNull();
    expect(playback.focusedIndex).toBe(4);
    expect(playback.nextIndex).toBeNull();
    expect(playback.canAdvance).toBe(false);
    expect(playback.holdTerminal).toBe(false);
  });

  it("is not the terminal frame while a speech is being read", () => {
    expect(deriveMatchPlayback(state, 0).isTerminalFrame).toBe(false);
    expect(deriveMatchPlayback(state, 2).isTerminalFrame).toBe(false);
  });

  it("keeps the final speech off the terminal frame until the viewer continues", () => {
    const held = deriveMatchPlayback(state, 3);
    expect(held.focusedPanel?.id).toBe("B:REBUTTAL_B");
    expect(held.holdTerminal).toBe(true);
    expect(held.isTerminalFrame).toBe(false);
  });

  it("becomes the terminal frame at the continue sentinel", () => {
    const terminal = deriveMatchPlayback(state, 4);
    expect(terminal.isTerminalFrame).toBe(true);
  });

  it("is already terminal when there is no speech to hold", () => {
    const empty = deriveMatchPlayback({ ...state, panels: [] }, 0);
    expect(empty.isTerminalFrame).toBe(true);
  });
});
