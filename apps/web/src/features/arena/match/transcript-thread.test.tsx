/**
 * Render smoke tests for the match archive page components.
 * The page itself is exercised via static markup in the parent test.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TranscriptThread } from "./transcript-thread";
import type { StandardToolEventRecord, TranscriptTurnRecord } from "@/shared/api/matches";

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

  it("renders recorded tool calls beside a turn and keeps unmatched calls explicit", () => {
    const events: StandardToolEventRecord[] = [
      {
        callId: "call-1",
        side: "A",
        tool: "web_search",
        query: "copyright research",
        output: "A concise recorded result.",
        ok: true,
        createdAt: "2025-12-31T23:59:59.000Z",
      },
      {
        callId: "call-2",
        side: "B",
        tool: "run_code",
        query: "check the numbers",
        output: "The command failed.",
        ok: false,
        error: "Process exited with status 1",
        createdAt: "2026-01-01T00:00:03.000Z",
      },
    ];
    const html = renderToStaticMarkup(<TranscriptThread turns={turns} mode="standard" toolEvents={events} />);
    expect(html).toContain("Web search");
    expect(html).toContain("Succeeded");
    expect(html).toContain("Between turns");
    expect(html).toContain("Code run");
    expect(html).toContain("Inspect recorded call");
  });

  it("names Quick history without tool calls instead of showing a blank evidence rail", () => {
    const html = renderToStaticMarkup(<TranscriptThread turns={turns} mode="quick" />);
    expect(html).toContain("Quick format · no tool calls recorded.");
  });
});
