"use client";

import type { DebateSide } from "@/entities/debate";
import type { RedactedProvider } from "@/shared/api/providers";
import { AgentCorner } from "@/features/run-debate/ui/agent-corner";
import type { DebateRuntimeState, SpeechPanel } from "@/features/run-debate/lib/reducer";

interface SpeechLayerProps {
  readonly state: DebateRuntimeState;
  readonly topic: string;
  readonly agentA?: RedactedProvider;
  readonly agentB?: RedactedProvider;
  readonly draftSideAModel?: string;
  readonly draftSideBModel?: string;
  readonly draftSideAPosition?: "FOR" | "AGAINST";
  readonly draftSideBPosition?: "FOR" | "AGAINST";
  readonly className?: string;
}

/**
 * Stacked teleprompter / speech layer. Re-uses the existing `AgentCorner`
 * component unchanged so the live token text stays first-class and accessible.
 * The widget only adds the broadcast framing on top.
 */
export function SpeechLayer({
  state,
  topic,
  agentA,
  agentB,
  draftSideAModel,
  draftSideBModel,
  draftSideAPosition = "FOR",
  draftSideBPosition = "AGAINST",
  className = "",
}: SpeechLayerProps) {
  const panelsForSide = (side: DebateSide): readonly SpeechPanel[] =>
    state.panels.filter((panel) => panel.side === side);

  const modelA = draftSideAModel ?? state.panels.find((p) => p.side === "A")?.model;
  const modelB = draftSideBModel ?? state.panels.find((p) => p.side === "B")?.model;

  return (
    <div className={`speech-layer ${className}`} aria-label="Debate speech">
      <AgentCorner
        side="A"
        tone="coral"
        identity="The Challenger"
        provider={agentA}
        model={modelA}
        position={draftSideAPosition}
        panels={panelsForSide("A")}
        currentSide={state.currentSide}
      />
      <AgentCorner
        side="B"
        tone="violet"
        identity="The Advocate"
        provider={agentB}
        model={modelB}
        position={draftSideBPosition}
        panels={panelsForSide("B")}
        currentSide={state.currentSide}
      />
      {/* `topic` is accepted so future iterations can reuse it without changing
          this widget's prop surface; keep the lint quiet by referencing it. */}
      <span hidden>{topic}</span>
    </div>
  );
}
