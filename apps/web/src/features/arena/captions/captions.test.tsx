/**
 * Render smoke tests for the caption UI components. Verifies the
 * public markup that the rest of the arena depends on, using
 * `renderToStaticMarkup` to stay DOM-free.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialRuntimeState, type DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { LiveCaption } from "./live-caption";
import { VerdictCard } from "./verdict-card";
import { CompactChip } from "./compact-chip";
import { ErrorPanel } from "@/features/run-debate/ui/error-panel";
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

describe("LiveCaption", () => {
  it("renders nothing in the initial idle state", () => {
    const html = renderToStaticMarkup(<LiveCaption state={initialRuntimeState} />);
    expect(html).toBe("");
  });

  it("shows the speaker chip + body when a stream is in flight", () => {
    const state: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "OPENING_A",
      currentSide: "A",
      panels: [
        { id: "A:OPENING_A", side: "A", phase: "OPENING_A", content: "Hello", sealed: false },
      ],
    };
    const html = renderToStaticMarkup(<LiveCaption state={state} />);
    expect(html).toContain("The Challenger");
    expect(html).toContain("Round 1 · Opening");
    expect(html).toContain("Hello");
    expect(html).toContain("live-caption__caret");
  });

  it("uses the violet tone for Agent B", () => {
    const state: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "REBUTTAL_B",
      currentSide: "B",
      panels: [
        { id: "B:REBUTTAL_B", side: "B", phase: "REBUTTAL_B", content: "Counter.", sealed: true },
      ],
    };
    const html = renderToStaticMarkup(<LiveCaption state={state} />);
    expect(html).toContain("live-caption--violet");
    expect(html).toContain("The Advocate");
  });

  it("explains that the caption is waiting when the first token has not arrived", () => {
    const state: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "OPENING_A",
      currentSide: "A",
    };
    const html = renderToStaticMarkup(<LiveCaption state={state} />);
    expect(html).toContain("Waiting for the first words");
    expect(html).not.toContain(">…<");
  });
});

describe("VerdictCard", () => {
  it("renders the winner, scores, and reasoning", () => {
    const html = renderToStaticMarkup(<VerdictCard verdict={verdict} topic="Should AI be regulated?" />);
    expect(html).toContain("The Challenger wins");
    expect(html).toContain("8-point margin · for the motion");
    expect(html).toContain("82");
    expect(html).toContain("74");
    expect(html).toContain("A had stronger arguments");
    expect(html).toContain("Should AI be regulated?");
    expect(html).toContain("Judge scorecard");
    expect(html).toContain("Argument quality");
  });

  it("renders the draw branch when the verdict is a draw", () => {
    const draw: DebateStreamVerdict = { ...verdict, winner: "DRAW", scoreA: 80, scoreB: 80 };
    const html = renderToStaticMarkup(<VerdictCard verdict={draw} topic="Whatever" />);
    expect(html).toContain("Draw");
    expect(html).toContain("0-point gap · scored as a draw");
  });

  it("uses the configured winning position instead of assuming A is for the motion", () => {
    const html = renderToStaticMarkup(
      <VerdictCard verdict={verdict} topic="Whatever" sideAPosition="AGAINST" sideBPosition="FOR" />,
    );
    expect(html).toContain("8-point margin · against the motion");
  });

  it("offers a clear route to start another debate after the verdict", () => {
    const html = renderToStaticMarkup(
      <VerdictCard verdict={verdict} topic="Whatever" onNewMatch={() => undefined} />,
    );
    expect(html).toContain("New debate");
  });
});

describe("ErrorPanel", () => {
  it("renders one clear recovery action for a failed match", () => {
    const state: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "error",
      errorMessage: "Provider stopped responding",
    };
    const html = renderToStaticMarkup(<ErrorPanel state={state} onNewMatch={() => undefined} />);
    expect(html).toContain("The debate could not finish");
    expect(html).toContain("Provider stopped responding");
    expect(html).toContain("Start match");
  });
});

describe("CompactChip", () => {
  it("labels the active side during streaming", () => {
    const state: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "OPENING_A",
      currentSide: "A",
    };
    const html = renderToStaticMarkup(<CompactChip state={state} />);
    expect(html).toContain("A live");
  });

  it("labels the judge + verdict phases", () => {
    const judging: DebateRuntimeState = { ...initialRuntimeState, status: "judging" };
    expect(renderToStaticMarkup(<CompactChip state={judging} />)).toContain("Judging");
    const finished: DebateRuntimeState = { ...initialRuntimeState, status: "finished", verdict };
    expect(renderToStaticMarkup(<CompactChip state={finished} />)).toContain("Verdict");
  });
});
