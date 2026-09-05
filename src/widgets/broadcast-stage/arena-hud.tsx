"use client";

import type { DebateStreamVerdict } from "@/shared/api/debate-stream";

import { BroadcastBanner } from "./broadcast-banner";
import { RoundMarker } from "./monitors/round-marker";
import { ReactionOverlay } from "./reactions/reaction-overlay";
import { SpeechLayer } from "./speech/speech-layer";
import { VerdictEvaluating, VerdictReveal } from "./verdict/verdict-reveal";
import { IdleSetup } from "./idle/idle-setup";
import { BroadcastConsole } from "./broadcast-console";
import { CancelledPanel } from "@/features/run-debate/ui/cancelled-panel";
import { deriveStageView } from "./stage-state";
import type { BroadcastStageProps } from "./broadcast-stage";
import { useWebGLSupport } from "./3d";

/**
 * Same prop surface as {@link BroadcastStage} — kept colocated so the
 * `arena-frame.tsx` orchestrator can swap the world (canvas vs 2D fallback)
 * without consumer changes.
 */
export type ArenaHudProps = BroadcastStageProps;

/**
 * HTML HUD overlay rendered above the 3D canvas when WebGL is available.
 * Lifts the banner + round marker + reaction overlay + speech layer +
 * verdict / idle / cancelled panels out of the existing 2D stage so they
 * can sit transparently over the canvas while the desk row + cyclorama
 * + characters live in 3D. Logic mirrors {@link BroadcastStage}; only the
 * wrappers change (no StageBackdrop, no desks/plinths row).
 *
 * Pointer-events discipline: the wrapper is `pointer-events: none` so the
 * canvas (OrbitControls etc.) can absorb clicks on empty regions. Interactive
 * children opt back into `pointer-events: auto` via the `arena-hud__pulse`
 * / `arena-hud__form` / `__cta` classes that target buttons and form fields.
 */
export function ArenaHud(props: ArenaHudProps) {
  const support = useWebGLSupport();
  if (!support.supported) return null;

  const {
    topic,
    state,
    agentA,
    agentB,
    // judgeProvider / judgeModel are intentionally not consumed in the HUD
    // overlay itself — the 3D characters read the verdict state via their
    // own lighting rig in Phase C. Kept on the prop surface for parity with
    // BroadcastStage so the orchestrator can pass them through unchanged.
    draftSideAModel,
    draftSideBModel,
    draftSideAPosition,
    draftSideBPosition,
    footer,
    onNewMatch,
    inMatch,
    onEndMatch,
    onOpenHistory,
    onStart,
    busy = false,
    errorMessage,
    reactionsMuted,
    onToggleMute,
  } = props;

  const view = deriveStageView(state);

  const showCancelled = state.status === "cancelled";
  const showJudge = state.status === "judging" || state.status === "finished";
  const judgeState =
    state.status === "judging" ? "evaluating" : state.status === "finished" ? "revealed" : null;
  const verdict = state.verdict as DebateStreamVerdict | undefined;

  const showSetup = !inMatch && Boolean(onStart);

  return (
    <div
      className="arena-hud"
      // Root data-attributes mirror the BroadcastStage root so any future
      // CSS hooks matching on data-stage / data-camera will still apply.
      {...view.rootDataAttributes}
      aria-label="Live debate broadcast"
    >
      {/* Top banner — interactive (history / mute / end buttons) */}
      <div className="arena-hud__top">
        <BroadcastBanner
          topic={topic}
          mode={state.mode}
          inMatch={inMatch}
          onEndMatch={onEndMatch}
          onOpenHistory={onOpenHistory}
          reactionsMuted={reactionsMuted}
          onToggleMute={onToggleMute}
        />
      </div>

      {/* Round marker — centered below the banner */}
      <div className="arena-hud__round">
        <RoundMarker view={view} />
      </div>

      {/* Floating reaction overlay (aria-hidden, decorative). */}
      <ReactionOverlay reaction={view.reaction} muted={reactionsMuted} position="top-right" />

      {/* Speech teleprompters — anchored to the bottom edge. */}
      {inMatch ? (
        <div className="arena-hud__speech">
          <SpeechLayer
            state={state}
            agentA={agentA}
            agentB={agentB}
            draftSideAModel={draftSideAModel}
            draftSideBModel={draftSideBModel}
            draftSideAPosition={draftSideAPosition}
            draftSideBPosition={draftSideBPosition}
          />
        </div>
      ) : null}

      {/* Terminal surfaces — full-bleed modal-style panel above the canvas. */}
      {showCancelled ? (
        onNewMatch ? (
          <div className="arena-hud__terminal arena-hud__terminal--cta">
            <CancelledPanel state={state} onNewMatch={onNewMatch} />
          </div>
        ) : null
      ) : showJudge ? (
        <div className="arena-hud__terminal">
          {judgeState === "revealed" && verdict ? (
            <VerdictReveal verdict={verdict} reasoning={verdict.reasoning} footer={footer} />
          ) : (
            <VerdictEvaluating footer={footer} />
          )}
        </div>
      ) : showSetup && onStart ? (
        <div className="arena-hud__terminal arena-hud__terminal--form">
          {/* 3D-aware console UI (idle desktop visual). The 2D fallback
              BroadcastStage keeps using the original IdleSetup so users on
              non-WebGL clients see the same form they had pre-Phase C. */}
          {support.supported ? (
            <BroadcastConsole onStart={onStart} busy={busy} errorMessage={errorMessage} />
          ) : (
            <IdleSetup onStart={onStart} busy={busy} errorMessage={errorMessage} />
          )}
        </div>
      ) : null}
    </div>
  );
}
