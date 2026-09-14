import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  initialRuntimeState,
  type DebateRuntimeStatus,
  type SpeechPanel,
} from "@/features/run-debate/lib/reducer";
import { ArenaRails } from "./arena-rails";
import { ArenaFrame } from "./arena-frame";

describe("ArenaRails match visibility", () => {
  it("stays out of the idle home surface and appears for every match status", () => {
    const idleMarkup = renderToStaticMarkup(<ArenaRails state={initialRuntimeState} />);
    expect(idleMarkup).toBe("");

    const matchStatuses: DebateRuntimeStatus[] = [
      "starting",
      "streaming",
      "judging",
      "finished",
      "cancelled",
      "error",
    ];

    for (const status of matchStatuses) {
      const markup = renderToStaticMarkup(
        <ArenaRails state={{ ...initialRuntimeState, status }} />,
      );
      expect(markup).toContain("Ember");
      expect(markup).toContain("Vesper");
    }
  });

  it("marks the selected side as primary while keeping the opponent's sealed preview visible", () => {
    const emberPanel: SpeechPanel = {
      id: "A:OPENING_A",
      side: "A",
      phase: "OPENING_A",
      content: "Ember is making the live case.",
      sealed: false,
    };
    const vesperPreview: SpeechPanel = {
      id: "B:OPENING_B",
      side: "B",
      phase: "OPENING_B",
      content: "Vesper's latest sealed case remains available.",
      sealed: true,
    };

    const markup = renderToStaticMarkup(
      <ArenaRails
        state={{ ...initialRuntimeState, status: "streaming", panels: [emberPanel, vesperPreview] }}
        playback={{
          focusedPanel: emberPanel,
          focusedIndex: 0,
          unseenTurns: 1,
          nextIndex: 1,
          canAdvance: true,
          holdTerminal: false,
          isTerminalFrame: false,
          advance: () => undefined,
        }}
      />,
    );

    expect(markup).toContain('data-focus-side="a"');
    expect(markup).toContain('class="arena-rail arena-rail--ember is-focused"');
    expect(markup).toContain('data-side="a" data-focused="true"');
    expect(markup).toContain("Primary view");
    expect(markup).toContain('class="arena-rail arena-rail--vesper is-preview"');
    expect(markup).toContain('data-side="b" data-focused="false"');
    expect(markup).toContain("latest sealed case remains available.");
  });

  it("marks the live speaker as primary before playback selects a speech", () => {
    const markup = renderToStaticMarkup(
      <ArenaRails
        state={{
          ...initialRuntimeState,
          status: "streaming",
          currentPhase: "OPENING_A",
          currentSide: "A",
          panels: [{
            id: "A:OPENING_A",
            side: "A",
            phase: "OPENING_A",
            content: "Ember is live.",
            sealed: false,
          }],
        }}
      />,
    );

    expect(markup).toContain('data-focus-side="a"');
    expect(markup).toContain('data-side="a" data-focused="true"');
    expect(markup).toContain("Ember is live.");
  });

  it("applies the same focus treatment when Vesper is selected", () => {
    const emberPreview: SpeechPanel = {
      id: "A:OPENING_A",
      side: "A",
      phase: "OPENING_A",
      content: "Ember's latest sealed case.",
      sealed: true,
    };
    const vesperPanel: SpeechPanel = {
      id: "B:REBUTTAL_B",
      side: "B",
      phase: "REBUTTAL_B",
      content: "Vesper is making the live response.",
      sealed: false,
    };

    const markup = renderToStaticMarkup(
      <ArenaRails
        state={{ ...initialRuntimeState, status: "streaming", panels: [emberPreview, vesperPanel] }}
        playback={{
          focusedPanel: vesperPanel,
          focusedIndex: 1,
          unseenTurns: 0,
          nextIndex: null,
          canAdvance: false,
          holdTerminal: false,
          isTerminalFrame: false,
          advance: () => undefined,
        }}
      />
    );

    expect(markup).toContain('data-focus-side="b"');
    expect(markup).toContain('class="arena-rail arena-rail--vesper is-focused"');
    expect(markup).toContain('data-side="b" data-focused="true"');
    expect(markup).toContain('class="arena-rail arena-rail--ember is-preview"');
    expect(markup).toContain('data-side="a" data-focused="false"');
    expect(markup).toContain("latest sealed case.");
  });

  it("keeps sealed rails balanced when playback has no focused panel", () => {
    const panel: SpeechPanel = {
      id: "A:OPENING_A",
      side: "A",
      phase: "OPENING_A",
      content: "A sealed opening remains visible.",
      sealed: true,
    };
    const markup = renderToStaticMarkup(
      <ArenaRails
        state={{ ...initialRuntimeState, status: "finished", panels: [panel] }}
        playback={{
          focusedPanel: null,
          focusedIndex: 1,
          unseenTurns: 0,
          nextIndex: null,
          canAdvance: false,
          holdTerminal: false,
          isTerminalFrame: true,
          advance: () => undefined,
        }}
      />,
    );

    expect(markup).toContain('data-focus-side="none"');
    expect(markup).not.toContain("is-preview");
  });
});

describe("ArenaFrame terminal-frame rails gating", () => {
  const inMatchState = {
    ...initialRuntimeState,
    mode: "standard" as const,
    status: "streaming" as const,
    currentPhase: "OPENING_A" as const,
    currentSide: "A" as const,
    standardEvents: [{
      type: "tool-start" as const,
      tool: {
        callId: "call-1",
        side: "A" as const,
        tool: "web_search" as const,
        query: "public evidence",
        createdAt: "2026-09-14T12:00:00.000Z",
      },
    }],
  };

  function playback(isTerminalFrame: boolean) {
    return {
      focusedPanel: null,
      focusedIndex: 0,
      unseenTurns: 0,
      nextIndex: null,
      canAdvance: false,
      holdTerminal: false,
      isTerminalFrame,
      advance: () => undefined,
    };
  }

  it("mounts the contender rails before the terminal frame", () => {
    const markup = renderToStaticMarkup(
      <ArenaFrame
        topic="Topic"
        state={inMatchState}
        inMatch
        reactionsMuted={false}
        playback={playback(false)}
      />,
    );
    expect(markup).toContain("arena-rails");
    expect(markup).toContain("Public actions");
    expect(markup).not.toContain("Evidence rail");
  });

  it("omits the contender rails on the terminal frame so they cannot cover the verdict", () => {
    const markup = renderToStaticMarkup(
      <ArenaFrame
        topic="Topic"
        state={inMatchState}
        inMatch
        reactionsMuted={false}
        playback={playback(true)}
      />,
    );
    expect(markup).not.toContain("arena-rails");
  });
});
