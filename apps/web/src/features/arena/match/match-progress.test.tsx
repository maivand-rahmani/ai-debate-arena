import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialRuntimeState, type DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { MatchProgress } from "./match-progress";

describe("MatchProgress", () => {
  it("makes the current Quick turn and the seven-step format visible", () => {
    const state: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "quick-a-response-2",
      currentSide: "A",
    };

    const html = renderToStaticMarkup(<MatchProgress state={state} />);
    expect(html).toContain("Step 5 of 7");
    expect(html).toContain("Challenger responds");
    expect(html).toContain("Judge&#x27;s verdict");
    expect(html).toContain('aria-current="step"');
  });

  it("marks every step complete when the verdict is ready", () => {
    const state: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "finished",
      currentPhase: "FINISHED",
    };

    const html = renderToStaticMarkup(<MatchProgress state={state} />);
    expect(html).toContain("Match complete · verdict ready");
    expect((html.match(/match-progress__step--complete/g) ?? [])).toHaveLength(7);
  });

  it("adds only the Standard rounds that the public state has reached", () => {
    const state: DebateRuntimeState = {
      ...initialRuntimeState,
      mode: "standard",
      status: "streaming",
      currentPhase: "standard-b-round-2",
      currentSide: "B",
      panels: [
        { id: "A:standard-a-opening", side: "A", phase: "standard-a-opening", content: "Opening", sealed: true },
        { id: "B:standard-b-opening", side: "B", phase: "standard-b-opening", content: "Opening", sealed: true },
        { id: "A:standard-a-round-1", side: "A", phase: "standard-a-round-1", content: "Round one", sealed: true },
      ],
      standardState: {
        startingCredits: 20,
        speechCost: 2,
        toolCost: 1,
        maxMoves: 20,
        movesUsed: 5,
        moveLimitReached: false,
        closingRound: false,
        ready: { A: false, B: false },
        sides: {
          A: { side: "A", creditsRemaining: 10, toolsUsed: 1, toolsUsedThisMove: 0, maxToolsPerMove: 2, toolTimeoutMs: 8000, depleted: false },
          B: { side: "B", creditsRemaining: 10, toolsUsed: 1, toolsUsedThisMove: 1, maxToolsPerMove: 2, toolTimeoutMs: 8000, depleted: false },
        },
      },
    };

    const html = renderToStaticMarkup(<MatchProgress state={state} />);
    expect(html).toContain("Open round 1");
    expect(html).toContain("Open round 2");
    expect(html).toContain("5 moves used");
    expect(html).not.toContain("Open round 3");
    expect(html).toContain('class="match-progress__step match-progress__step--current"');
  });
});
