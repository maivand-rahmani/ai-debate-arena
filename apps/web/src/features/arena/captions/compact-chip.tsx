"use client";

import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { deriveStageView } from "@/widgets/broadcast-stage/stage-state";

interface CompactChipProps {
  readonly state: DebateRuntimeState;
}

/**
 * Tiny status chip that sits in the top bar (next to the broadcast
 * banner). Replaces the larger floating round-marker so the speech
 * surface can have the bottom-center real-estate to itself.
 */
export function CompactChip({ state }: CompactChipProps) {
  const view = deriveStageView(state);
  const label = chipLabel(view.mode, view.activeSide, state.status);
  return (
    <span
      className={`compact-chip compact-chip--${view.mode}`}
      data-mode={view.mode}
      data-active-side={view.activeSide ?? "none"}
      aria-label={view.stageLabel}
    >
      <span aria-hidden="true" className="compact-chip__dot" />
      <span className="compact-chip__label">{label}</span>
    </span>
  );
}

function chipLabel(
  mode: ReturnType<typeof deriveStageView>["mode"],
  activeSide: ReturnType<typeof deriveStageView>["activeSide"],
  status: DebateRuntimeState["status"],
): string {
  if (mode === "speaking") {
    return activeSide === "A" ? "A live" : activeSide === "B" ? "B live" : "Live";
  }
  if (mode === "judging") return "Judging";
  if (mode === "verdict") return "Verdict";
  if (mode === "cancelled") return "Ended";
  if (mode === "error") return "Error";
  if (status === "starting") return "Starting";
  return "Ready";
}
