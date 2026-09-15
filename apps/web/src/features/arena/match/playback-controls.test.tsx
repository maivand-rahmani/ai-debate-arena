import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialRuntimeState } from "@/features/run-debate/lib/reducer";
import { PlaybackControls } from "./playback-controls";

describe("PlaybackControls", () => {
  it("exposes position, previous/next controls, and catch-up as labeled native controls", () => {
    const html = renderToStaticMarkup(
      <PlaybackControls
        state={{
          ...initialRuntimeState,
          status: "streaming",
          panels: [
            { id: "A:OPENING_A", side: "A", phase: "OPENING_A", content: "A", sealed: true },
            { id: "B:OPENING_B", side: "B", phase: "OPENING_B", content: "B", sealed: true },
            { id: "A:REBUTTAL_A", side: "A", phase: "REBUTTAL_A", content: "A again", sealed: true },
          ],
        }}
        playback={{
          focusedPanel: { id: "B:OPENING_B", side: "B", phase: "OPENING_B", content: "B", sealed: true },
          focusedIndex: 1,
          unseenTurns: 1,
          nextIndex: 2,
          canAdvance: true,
          holdTerminal: false,
          isTerminalFrame: false,
          canGoPrevious: true,
          canCatchUp: true,
          isAtLive: false,
          advance: () => undefined,
          previous: () => undefined,
          catchUpToLive: () => undefined,
        }}
      />,
    );
    expect(html).toContain('aria-label="Speech playback controls"');
    expect(html).toContain("Speech 2 of 3");
    expect(html).toContain('aria-label="Show previous speech"');
    expect(html).toContain('aria-label="Show next speech"');
    expect(html).toContain('aria-label="Catch up to live"');
    expect(html).toContain('aria-keyshortcuts="ArrowLeft"');
    expect(html).toContain('aria-keyshortcuts="ArrowRight Escape"');
  });

  it("keeps the previous control discoverable but disabled at the first speech", () => {
    const html = renderToStaticMarkup(
      <PlaybackControls
        state={{
          ...initialRuntimeState,
          status: "finished",
          panels: [{ id: "A:OPENING_A", side: "A", phase: "OPENING_A", content: "A", sealed: true }],
        }}
        playback={{
          focusedPanel: { id: "A:OPENING_A", side: "A", phase: "OPENING_A", content: "A", sealed: true },
          focusedIndex: 0,
          unseenTurns: 0,
          nextIndex: 1,
          canAdvance: true,
          holdTerminal: true,
          isTerminalFrame: false,
          canGoPrevious: false,
          canCatchUp: true,
          isAtLive: false,
          advance: () => undefined,
        }}
      />,
    );
    expect(html).toContain('aria-label="Show previous speech"');
    expect(html).toContain("disabled");
    expect(html).toContain("Show judge");
  });

  it("keeps Previous available at the terminal verdict sentinel", () => {
    const html = renderToStaticMarkup(
      <PlaybackControls
        state={{
          ...initialRuntimeState,
          status: "finished",
          panels: [{ id: "A:OPENING_A", side: "A", phase: "OPENING_A", content: "A", sealed: true }],
        }}
        playback={{
          focusedPanel: null,
          focusedIndex: 1,
          unseenTurns: 0,
          nextIndex: null,
          canAdvance: false,
          holdTerminal: false,
          isTerminalFrame: true,
          canGoPrevious: true,
          canCatchUp: false,
          isAtLive: true,
          advance: () => undefined,
          previous: () => undefined,
        }}
      />,
    );
    expect(html).toContain("Live verdict · 1 speeches");
    expect(html).toContain('aria-label="Show previous speech"');
    expect(html).not.toContain('aria-label="Show next speech"');
  });
});
