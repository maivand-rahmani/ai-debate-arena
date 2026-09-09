"use client";

import type { DebateStreamVerdict } from "@/shared/api/debate-stream";

import { BroadcastBanner } from "./broadcast-banner";
import { ReactionOverlay } from "./reactions/reaction-overlay";
import { LiveCaption, VerdictCard } from "@/features/arena/captions";
import { MatchProgress } from "@/features/arena/match/match-progress";
import { VerdictEvaluating } from "./verdict/verdict-reveal";
import { CancelledPanel } from "@/features/run-debate/ui/cancelled-panel";
import { ErrorPanel } from "@/features/run-debate/ui/error-panel";
import { deriveStageView, isBroadcastLiveStatus, shouldShowLiveCaptionStatus } from "./stage-state";
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
 * Lifts the banner + compact status chip + reaction overlay + single
 * bottom-center live caption + verdict / cancelled panels out of
 * the existing 2D stage so they can sit transparently over the canvas
 * while the desk row + cyclorama + characters live in 3D.
 *
 * Idle setup lives in the SetupModal (opened from the idle hero) — this
 * HUD never renders a setup form.
 *
 * Pointer-events discipline: the wrapper is `pointer-events: none` so the
 * canvas (OrbitControls etc.) can absorb clicks on empty regions.
 * Interactive children opt back into `pointer-events: auto` via the
 * `arena-hud__top` / `arena-hud__round` / `arena-hud__terminal` classes
 * that target buttons and links.
 */
export function ArenaHud(props: ArenaHudProps) {
  const support = useWebGLSupport();
  if (!support.supported) return null;

  const {
    topic,
    state,
    footer,
    onNewMatch,
    onEndMatch,
    onOpenHistory,
    reactionsMuted,
    onToggleMute,
  } = props;

  const view = deriveStageView(state);

  const showCancelled = state.status === "cancelled";
  const showError = state.status === "error";
  const showJudge = state.status === "judging" || state.status === "finished";
  const showLiveCaption = shouldShowLiveCaptionStatus(state.status);
  const broadcastLive = isBroadcastLiveStatus(state.status);
  const judgeState =
    state.status === "judging" ? "evaluating" : state.status === "finished" ? "revealed" : null;
  const verdict = state.verdict as DebateStreamVerdict | undefined;

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
          status={state.status}
          onEndMatch={broadcastLive ? onEndMatch : undefined}
          onOpenHistory={onOpenHistory}
          reactionsMuted={reactionsMuted}
          onToggleMute={onToggleMute}
        />
      </div>

      {/* The five-step spine tells viewers where the match is, rather than
          only naming the current speaker. */}
      {broadcastLive ? (
        <div className="arena-hud__round arena-hud__round--progress">
          <MatchProgress state={state} />
        </div>
      ) : null}

      {/* Floating reaction overlay (aria-hidden, decorative). */}
      <ReactionOverlay
        reaction={state.status === "error" || state.status === "cancelled" ? null : view.reaction}
        muted={reactionsMuted}
        position="top-right"
      />

      {/* Dim the 3D scene so the captions stay the focal point. The
          overlay is invisible when no match is in flight. */}
      {broadcastLive ? <div className="arena-hud__scrim" aria-hidden="true" /> : null}

      {/* Live caption — the new single bottom-center speech surface. */}
      {showLiveCaption ? (
        <div className="arena-hud__caption">
          <LiveCaption state={state} />
        </div>
      ) : null}

      {/* Terminal surfaces — the cancelled + judging states keep their
          calmer panels; the verdict reveal now uses the new VerdictCard
          (which lives in the same caption chrome) instead of a
          full-screen terminal. */}
      {showError ? (
        onNewMatch ? (
          <div className="arena-hud__terminal arena-hud__terminal--error">
            <ErrorPanel state={state} onNewMatch={onNewMatch} />
          </div>
        ) : null
      ) : showCancelled ? (
        onNewMatch ? (
          <div className="arena-hud__terminal arena-hud__terminal--cta">
            <CancelledPanel state={state} onNewMatch={onNewMatch} />
          </div>
        ) : null
      ) : showJudge ? (
        judgeState === "revealed" && verdict ? (
          <div className="arena-hud__terminal arena-hud__terminal--verdict">
            <VerdictCard
              verdict={verdict}
              topic={state.topic ?? topic}
              footer={footer ? { ...footer, matchId: state.matchId ?? footer.matchId } : undefined}
            />
          </div>
        ) : (
          <div className="arena-hud__terminal arena-hud__terminal--judging">
            <VerdictEvaluating footer={footer} />
          </div>
        )
      ) : null}
    </div>
  );
}
