import { describe, expect, it } from "vitest";
import { DebatePhase } from "../src/types";
import { advanceDebate, createDebateState } from "../src/state";
import { parseDebateVerdict } from "../src/verdict";

describe("debate domain", () => {
  it("progresses deterministically through every phase", () => {
    let state = createDebateState();
    const phases = [DebatePhase.OPENING_A, DebatePhase.OPENING_B, DebatePhase.REBUTTAL_A, DebatePhase.REBUTTAL_B, DebatePhase.JUDGING, DebatePhase.FINISHED];
    for (const phase of phases) {
      state = advanceDebate(state);
      expect(state.phase).toBe(phase);
    }
  });

  it("parses and validates judge JSON", () => {
    expect(parseDebateVerdict('{"winner":"A","scoreA":8,"scoreB":6,"reasoning":"clear evidence"}').success).toBe(true);
    expect(parseDebateVerdict('{"winner":"X","scoreA":8,"scoreB":6,"reasoning":"bad"}').success).toBe(false);
  });
});

