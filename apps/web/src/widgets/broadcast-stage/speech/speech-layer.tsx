"use client";

import type { DebateSide } from "@arena/debate-engine";
import type { RedactedProvider } from "@/shared/api/providers";
import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { Teleprompter } from "./teleprompter";

interface SpeechLayerProps {
  readonly state: DebateRuntimeState;
  readonly agentA?: RedactedProvider;
  readonly agentB?: RedactedProvider;
  readonly draftSideAModel?: string;
  readonly draftSideBModel?: string;
  readonly draftSideAPosition?: "FOR" | "AGAINST";
  readonly draftSideBPosition?: "FOR" | "AGAINST";
  readonly className?: string;
}

/**
 * Two side-by-side broadcast teleprompters. Renders one Teleprompter per
 * contender; the live streaming panel shows the blinking caret, sealed
 * turns roll in below. The widget only adds the broadcast framing — the
 * Teleprompter component handles the streaming/HTML rendering.
 */
export function SpeechLayer({
  state,
  agentA,
  agentB,
  draftSideAModel,
  draftSideBModel,
  draftSideAPosition = "FOR",
  draftSideBPosition = "AGAINST",
  className = "",
}: SpeechLayerProps) {
  const panelsForSide = (side: DebateSide) =>
    state.panels.filter((panel) => panel.side === side);

  const modelA = draftSideAModel ?? state.panels.find((p) => p.side === "A")?.model;
  const modelB = draftSideBModel ?? state.panels.find((p) => p.side === "B")?.model;

  return (
    <div className={`broadcast-stage__speech ${className}`} aria-label="Debate speech">
      <Teleprompter
        side="A"
        tone="coral"
        identity="The Challenger"
        provider={agentA}
        model={modelA}
        position={draftSideAPosition}
        panels={panelsForSide("A")}
        currentSide={state.currentSide}
      />
      <Teleprompter
        side="B"
        tone="violet"
        identity="The Advocate"
        provider={agentB}
        model={modelB}
        position={draftSideBPosition}
        panels={panelsForSide("B")}
        currentSide={state.currentSide}
      />
    </div>
  );
}

