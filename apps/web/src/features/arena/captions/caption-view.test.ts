/**
 * Tests for the pure caption projection. Drives the runtime through
 * the natural debate phases and asserts the single-caption surface
 * always picks the right speaker / phase / text / status.
 */

import { describe, expect, it } from "vitest";
import { initialRuntimeState, type DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { deriveCaptionView } from "./caption-view";

const base: DebateRuntimeState = initialRuntimeState;

describe("deriveCaptionView — initial state", () => {
  it("is hidden before the match starts", () => {
    const view = deriveCaptionView(base);
    expect(view.visible).toBe(false);
    expect(view.kind).toBeNull();
  });
});

describe("deriveCaptionView — streaming phases", () => {
  it("picks the live panel for Agent A's opening", () => {
    const view = deriveCaptionView({
      ...base,
      status: "streaming",
      currentPhase: "OPENING_A",
      currentSide: "A",
      panels: [
        { id: "A:OPENING_A", side: "A", phase: "OPENING_A", content: "Hello world", sealed: false },
      ],
    });
    expect(view.kind?.kind).toBe("speaker");
    if (view.kind?.kind === "speaker") {
      expect(view.kind.side).toBe("A");
      expect(view.kind.phase).toBe("OPENING_A");
      expect(view.kind.sealed).toBe(false);
    }
    expect(view.speakerLabel).toBe("The Challenger");
    expect(view.phaseLabel).toBe("Round 1 · Opening");
    expect(view.text).toBe("Hello world");
    expect(view.tone).toBe("coral");
    expect(view.isLive).toBe(true);
    expect(view.visible).toBe(true);
  });

  it("picks the live panel for Agent B's rebuttal", () => {
    const view = deriveCaptionView({
      ...base,
      status: "streaming",
      currentPhase: "REBUTTAL_B",
      currentSide: "B",
      panels: [
        { id: "B:REBUTTAL_B", side: "B", phase: "REBUTTAL_B", content: "I disagree.", sealed: true },
      ],
    });
    expect(view.speakerLabel).toBe("The Advocate");
    expect(view.phaseLabel).toBe("Round 2 · Rebuttal");
    expect(view.tone).toBe("violet");
    expect(view.isLive).toBe(false); // sealed turn → no caret
  });

  it("keeps the same panel visible after the turn is sealed (no flicker)", () => {
    const view = deriveCaptionView({
      ...base,
      status: "streaming",
      currentPhase: "OPENING_B",
      currentSide: "B",
      panels: [
        { id: "B:OPENING_B", side: "B", phase: "OPENING_B", content: "Sealed text", sealed: true },
      ],
    });
    expect(view.text).toBe("Sealed text");
    expect(view.isLive).toBe(false);
  });

  it("resolves dynamic Standard phases instead of treating them as Quick turns", () => {
    const view = deriveCaptionView({
      ...base,
      mode: "standard",
      status: "streaming",
      currentPhase: "standard-a-round-3",
      currentSide: "A",
      panels: [
        { id: "A:standard-a-round-3", side: "A", phase: "standard-a-round-3", content: "A researched response.", sealed: false },
      ],
    });
    expect(view.kind?.kind).toBe("speaker");
    expect(view.phaseLabel).toBe("Open round 3 · Response");
    expect(view.text).toBe("A researched response.");
  });
});

describe("deriveCaptionView — judge evaluating", () => {
  it("falls back to the last sealed line so the user still sees context", () => {
    const view = deriveCaptionView({
      ...base,
      status: "judging",
      currentPhase: "JUDGING",
      currentSide: null,
      judgeActive: true,
      panels: [
        { id: "A:OPENING_A", side: "A", phase: "OPENING_A", content: "First", sealed: true },
        { id: "B:OPENING_B", side: "B", phase: "OPENING_B", content: "Second", sealed: true },
        { id: "A:REBUTTAL_A", side: "A", phase: "REBUTTAL_A", content: "Third", sealed: true },
        { id: "B:REBUTTAL_B", side: "B", phase: "REBUTTAL_B", content: "Fourth", sealed: true },
      ],
    });
    expect(view.kind?.kind).toBe("judge-evaluating");
    expect(view.speakerLabel).toBe("The Advocate");
    expect(view.text).toBe("Fourth");
    expect(view.tone).toBe("violet");
    expect(view.isLive).toBe(false);
  });
});

describe("deriveCaptionView — verdict", () => {
  it("prefers the judge's rationale text over the last sealed line", () => {
    const view = deriveCaptionView({
      ...base,
      status: "finished",
      currentPhase: "FINISHED",
      currentSide: null,
      judgeActive: false,
      verdict: {
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
      },
    });
    expect(view.kind?.kind).toBe("verdict");
    expect(view.speakerLabel).toBe("The Judge");
    expect(view.phaseLabel).toBe("Judge’s rationale");
    expect(view.text).toBe("A had stronger arguments");
    expect(view.tone).toBe("honey");
  });
});

describe("deriveCaptionView — cancelled + error", () => {
  it("keeps the last sealed line visible after a cancel", () => {
    const view = deriveCaptionView({
      ...base,
      status: "cancelled",
      cancelled: true,
      panels: [
        { id: "A:OPENING_A", side: "A", phase: "OPENING_A", content: "Mid-sentence", sealed: false },
      ],
    });
    expect(view.kind?.kind).toBe("cancelled");
    expect(view.text).toBe("Mid-sentence");
  });

  it("falls back to the error message when no panel content exists", () => {
    const view = deriveCaptionView({
      ...base,
      status: "error",
      errorMessage: "Upstream 500",
    });
    expect(view.kind?.kind).toBe("error");
    if (view.kind?.kind === "error") {
      expect(view.kind.message).toBe("Upstream 500");
    }
    expect(view.text).toBe("Upstream 500");
  });
});
