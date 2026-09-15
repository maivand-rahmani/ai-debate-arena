"use client";

import { useMemo } from "react";
import { CanvasGate } from "./3d";
import { BroadcastStage, type BroadcastStageProps } from "./broadcast-stage";
import { deriveSceneSignal } from "./3d/scene-signal";
import { ArenaHud } from "./arena-hud";
import { ArenaRails } from "./arena-rails";

/**
 * The v0.3 broadcast surface. Mounts the 3D arena via {@link CanvasGate}
 * (with the original 2D CSS {@link BroadcastStage} as the no-WebGL fallback)
 * and overlays the HUD pieces on top of the canvas for capable browsers.
 *
 * Before rendering we project the debate runtime state through
 * {@link deriveSceneSignal} into a serializable POJO. The signal flows
 * through CanvasGate's `canvasProps` slot to the lazy canvas client,
 * where the camera/lighting/verdict directors consume it. The HUD overlay
 * still watches the same state directly — no projection needed there.
 *
 * Reduced motion: we read the media query once via SSR-safe snapshot.
 * The canvas side uses it to short-circuit lerps into instant snaps.
 */
export function ArenaFrame(props: BroadcastStageProps) {
  // Reduced-motion detection — re-evaluated on each render so OS toggles
  // take effect without a remount. Type-safe window access for SSR.
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
    // Empty deps: only read once at mount; subsequent OS toggles would
    // require a route change to pick up (cheap to leave as-is for now).
  }, []);
  const isReducedMotion = Boolean(reducedMotion);

  const focusedPanel = props.playback?.focusedPanel ?? null;
  // A missing playback snapshot means there is no spectator hold in front of
  // the terminal surface, so the verdict is already presentable.
  const renderRails = shouldRenderArenaRails(props.state, props.playback);
  // Standard's live frame has no legacy playback snapshot. Give the scene the
  // same live/terminal distinction as the rails instead of defaulting to the
  // playback hook's terminal sentinel.
  const isTerminalFrame = props.playback === undefined && props.state.mode === "standard"
    ? !renderRails
    : props.playback?.isTerminalFrame ?? true;
  const signal = useMemo(
    () => deriveSceneSignal(props.state, isReducedMotion, undefined, focusedPanel, isTerminalFrame),
    [props.state, isReducedMotion, focusedPanel, isTerminalFrame],
  );

  return (
    <section
      className="arena-frame"
      aria-label="Live debate broadcast"
    >
      <CanvasGate
        canvasProps={signal}
      >
        <BroadcastStage {...props} />
      </CanvasGate>
      <ArenaHud {...props} />
      {/* Single source for the contender rails across both worlds. Standard
          live frames do not have a playback snapshot; terminal frames still
          omit the rails so they cannot cover judge/error surfaces. */}
      {renderRails ? (
        <ArenaRails
          state={props.state}
          playback={props.playback}
          standardLimits={props.standardLimits}
        />
      ) : null}
    </section>
  );
}

/**
 * Quick uses the legacy playback snapshot to decide when the terminal frame
 * has been reached. Standard live play normally has no playback snapshot: its
 * stream gate controls reveal pacing, while this frame keeps the rails present
 * during starting/streaming and out of terminal judge surfaces. If a playback
 * snapshot is supplied, its explicit terminal choice remains authoritative.
 */
export function shouldRenderArenaRails(
  state: BroadcastStageProps["state"],
  playback: BroadcastStageProps["playback"],
): boolean {
  if (state.mode === "standard" && playback === undefined) {
    return state.status === "starting" || state.status === "streaming";
  }
  return playback?.isTerminalFrame === false;
}
