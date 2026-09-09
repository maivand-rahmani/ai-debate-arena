import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialRuntimeState, type DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { MatchProgress } from "./match-progress";

describe("MatchProgress", () => {
  it("makes the current turn and the full five-step format visible", () => {
    const state: DebateRuntimeState = {
      ...initialRuntimeState,
      status: "streaming",
      currentPhase: "REBUTTAL_A",
      currentSide: "A",
    };

    const html = renderToStaticMarkup(<MatchProgress state={state} />);
    expect(html).toContain("Step 3 of 5");
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
    expect((html.match(/match-progress__step--complete/g) ?? [])).toHaveLength(5);
  });
});
