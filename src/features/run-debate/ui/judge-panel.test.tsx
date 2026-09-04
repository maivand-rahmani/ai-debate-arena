import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JudgePanel } from "./judge-panel";
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

describe("JudgePanel without a verdict", () => {
  it("does not fabricate a DRAW/0 verdict when revealing with no verdict", () => {
    const html = renderToStaticMarkup(
      <JudgePanel state="revealed" errorMessage="Judge returned invalid verdict" />,
    );
    expect(html).toContain("No verdict reached");
    expect(html).toContain("Judge returned invalid verdict");
    expect(html).not.toMatch(/The Challenger wins|The Advocate wins/);
    expect(html).not.toContain(">Draw<");
  });

  it("shows the generic empty state when no error message is provided", () => {
    const html = renderToStaticMarkup(<JudgePanel state="revealing" />);
    expect(html).toContain("No verdict reached");
    expect(html).toContain("ended without a verdict");
  });

  it("still renders the real verdict when one exists", () => {
    const html = renderToStaticMarkup(
      <JudgePanel state="revealed" reasoning={verdict.reasoning} verdict={verdict} />,
    );
    expect(html).toContain("The Challenger wins");
    expect(html).toContain("A had stronger arguments");
  });
});
