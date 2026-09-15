import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VerdictEvaluating } from "./verdict-reveal";

describe("VerdictEvaluating", () => {
  it("renders public review stages, counts, and their current state", () => {
    const html = renderToStaticMarkup(
      <VerdictEvaluating
        judgeActivity={{
          stage: "evidence-check",
          stages: ["record-loaded", "evidence-check"],
          turnCount: 6,
          evidenceCount: 3,
          successfulEvidenceCount: 2,
          criteria: ["argumentQuality", "rebuttal", "consistency", "relevance"],
        }}
      />,
    );

    expect(html).toContain("JUDGE REVIEW");
    expect(html).toContain("Record loaded");
    expect(html).toContain("Public evidence checked");
    expect(html).toContain("Rubric checked");
    expect(html).toContain("Comparing both sides");
    expect(html).toContain("6 turns");
    expect(html).toContain("2 / 3 public evidence successful");
    expect(html).toContain("4 criteria");
    expect(html).toContain("verdict-evaluating__stage--complete");
    expect(html).toContain("verdict-evaluating__stage--current");
    expect(html).toContain("verdict-evaluating__stage--upcoming");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("keeps the final review stage current without exposing judge output", () => {
    const html = renderToStaticMarkup(
      <VerdictEvaluating
        judgeActivity={{
          stage: "comparing",
          stages: ["record-loaded", "evidence-check", "rubric-check", "comparing"],
          turnCount: 4,
          evidenceCount: 0,
          successfulEvidenceCount: 0,
          criteria: ["argumentQuality", "rebuttal", "consistency", "relevance"],
        }}
      />,
    );

    expect(html).toContain("Comparing both sides");
    expect(html).toContain("0 / 0 public evidence successful");
    expect(html).toContain("verdict-evaluating__stage--current");
    expect(html).not.toContain("draft score");
    expect(html).not.toContain("chain-of-thought");
  });
});
