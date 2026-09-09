/**
 * Render smoke tests for the match archive page components.
 * The page itself is exercised via static markup in the parent test.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TranscriptThread } from "./transcript-thread";
import type { TranscriptTurnRecord } from "@/shared/api/matches";

const turns: TranscriptTurnRecord[] = [
  {
    id: "t1",
    agentId: "a",
    side: "A",
    phase: "OPENING_A",
    content: "The motion is reasonable because freedom matters.",
    model: "alpha-default",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "t2",
    agentId: "b",
    side: "B",
    phase: "OPENING_B",
    content: "Freedom is not absolute; it must be balanced against harm.",
    model: "beta-default",
    createdAt: "2026-01-01T00:00:01.000Z",
  },
];

describe("TranscriptThread", () => {
  it("renders an empty state when no turns exist", () => {
    const html = renderToStaticMarkup(<TranscriptThread turns={[]} />);
    expect(html).toContain("No transcript turns");
  });

  it("renders one bubble per turn with speaker + phase", () => {
    const html = renderToStaticMarkup(<TranscriptThread turns={turns} />);
    expect(html).toContain("The Challenger");
    expect(html).toContain("The Advocate");
    expect(html).toContain("Opening · A");
    expect(html).toContain("Opening · B");
    expect(html).toContain("alpha-default");
    expect(html).toContain("freedom matters");
  });

  it("applies the coral / violet tone per side", () => {
    const html = renderToStaticMarkup(<TranscriptThread turns={turns} />);
    expect(html).toContain("transcript-thread__bubble--coral");
    expect(html).toContain("transcript-thread__bubble--violet");
  });
});
