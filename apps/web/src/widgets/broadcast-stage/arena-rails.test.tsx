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

  it("keeps expanded evidence inside the activity scroll region", () => {
    const markup = renderToStaticMarkup(
      <ArenaRails
        state={{
          ...initialRuntimeState,
          mode: "standard",
          status: "streaming",
          currentPhase: "standard-a-round-1",
          currentSide: "A",
          activeStandardEvents: [
            {
              type: "tool-start",
              tool: {
                callId: "call-working",
                side: "A",
                tool: "fetch_url",
                query: "https://example.com/live-source",
                createdAt: "2026-09-14T11:59:00.000Z",
              },
            },
            {
              type: "tool-result",
              result: {
                callId: "call-success",
                side: "A",
                tool: "web_search",
                query: "renewable energy adoption",
                ok: true,
                output: "Source result: global energy report excerpt",
                createdAt: "2026-09-14T12:00:00.000Z",
              },
            },
            {
              type: "tool-result",
              result: {
                callId: "call-rejected",
                side: "A",
                tool: "run_code",
                query: "verify the percentage",
                ok: false,
                rejected: true,
                output: "Tool budget exhausted",
                error: "Tool budget exhausted",
                createdAt: "2026-09-14T12:01:00.000Z",
              },
            },
            {
              type: "tool-result",
              result: {
                callId: "call-failed",
                side: "A",
                tool: "fetch_url",
                query: "https://example.com/missing-source",
                ok: false,
                output: "Fetch returned HTTP 404.",
                error: "Fetch request failed",
                createdAt: "2026-09-14T12:02:00.000Z",
              },
            },
            {
              type: "tool-result",
              result: {
                callId: "call-three",
                side: "A",
                tool: "run_code",
                query: "check the first calculation",
                ok: true,
                output: "Calculation result three",
                createdAt: "2026-09-14T12:03:00.000Z",
              },
            },
            {
              type: "tool-result",
              result: {
                callId: "call-four",
                side: "A",
                tool: "web_search",
                query: "check the second source",
                ok: true,
                output: "Search result four",
                createdAt: "2026-09-14T12:04:00.000Z",
              },
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Evidence receipts");
    expect(markup).toContain("6 total");
    expect(markup).toContain("Call call-working");
    expect(markup).toContain("Call call-success");
    expect(markup).toContain("Call call-rejected");
    expect(markup).toContain("Call call-failed");
    expect(markup).toContain("Call call-three");
    expect(markup).toContain("Call call-four");
    expect(markup).toContain("Working");
    expect(markup).toContain("Public result");
    expect(markup).toContain("Not run");
    expect(markup).toContain("Failed");
    expect(markup).toContain("Source result: global energy report excerpt");
    expect(markup).toContain("Fetch request failed");
    expect(markup).toContain("Calculation result three");
    expect(markup.indexOf("Call call-working")).toBeLessThan(markup.indexOf("Call call-four"));
    expect(markup).toContain("Inspect result");
    expect(markup).toContain('arena-rail__action--rejected');
    expect(markup).toContain('data-caption-region="reserved"');
    expect(markup).toContain('class="arena-rail__activity"');
    expect(markup).toContain('class="arena-rail__evidence-list"');
    expect(markup.indexOf('class="arena-rail__evidence"')).toBeGreaterThan(
      markup.indexOf('class="arena-rail__activity"'),
    );
  });

  it("shows only the current Standard move and retires tools when its speech seals", () => {
    const moveBTools = [
      {
        type: "tool-start" as const,
        tool: {
          callId: "b-current",
          side: "B" as const,
          tool: "web_search" as const,
          query: "current move research",
          createdAt: "2026-09-14T12:00:00.000Z",
        },
      },
      {
        type: "tool-result" as const,
        result: {
          callId: "b-current",
          side: "B" as const,
          tool: "web_search" as const,
          query: "current move research",
          ok: true,
          output: "Current move result",
          createdAt: "2026-09-14T12:00:01.000Z",
        },
      },
    ];
    const researching = {
      ...initialRuntimeState,
      mode: "standard" as const,
      status: "streaming" as const,
      currentPhase: "standard-b-round-1" as const,
      currentSide: "B" as const,
      panels: [{
        id: "B:standard-b-round-1",
        side: "B" as const,
        phase: "standard-b-round-1",
        content: "B is still researching.",
        sealed: false,
      }],
      // The archive contains the previous move too, but the live rail receives
      // only the active move collection.
      standardEvents: [
        {
          type: "tool-result" as const,
          result: {
            callId: "a-previous",
            side: "A" as const,
            tool: "run_code" as const,
            query: "previous move research",
            ok: true,
            output: "Previous move result",
            createdAt: "2026-09-14T11:59:00.000Z",
          },
        },
        ...moveBTools,
      ],
      activeStandardEvents: moveBTools,
    };

    const liveMarkup = renderToStaticMarkup(<ArenaRails state={researching} />);
    expect(liveMarkup).toContain("current move research");
    expect(liveMarkup).toContain("Current move result");
    expect(liveMarkup).not.toContain("previous move research");
    expect(liveMarkup).not.toContain("Previous move result");

    const sealedMarkup = renderToStaticMarkup(
      <ArenaRails
        state={{
          ...researching,
          panels: [{ ...researching.panels[0]!, content: "B's sealed response", sealed: true }],
        }}
      />,
    );
    expect(sealedMarkup).toContain("B&#x27;s sealed response");
    expect(sealedMarkup).toContain("Primary view");
    expect(sealedMarkup).not.toContain("Public actions");
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

  it("mounts Standard rails when ArenaScreen has no legacy playback snapshot", () => {
    const markup = renderToStaticMarkup(
      <ArenaFrame
        topic="Topic"
        state={inMatchState}
        inMatch
        reactionsMuted={false}
      />,
    );
    expect(markup).toContain("arena-rails");
    expect(markup).toContain("Ember");
    expect(markup).toContain("Vesper");
  });

  it("keeps Standard terminal surfaces free of rails without playback", () => {
    const markup = renderToStaticMarkup(
      <ArenaFrame
        topic="Topic"
        state={{ ...inMatchState, status: "finished" }}
        inMatch
        reactionsMuted={false}
      />,
    );
    expect(markup).not.toContain("arena-rails");
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
