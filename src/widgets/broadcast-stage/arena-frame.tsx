"use client";

import { useMemo, type CSSProperties } from "react";
import { CanvasGate } from "./3d";
import { BroadcastStage, type BroadcastStageProps } from "./broadcast-stage";
import { deriveSceneSignal } from "./3d/scene-signal";
import { ArenaHud } from "./arena-hud";

/**
 * The v0.3 broadcast surface. Mounts the 3D arena via {@link CanvasGate}
 * (with the original 2D CSS {@link BroadcastStage} as the no-WebGL fallback)
 * and overlays the HUD pieces on top of the canvas for capable browsers.
 *
 * Phase C: before rendering we project the debate runtime state through
 * {@link deriveSceneSignal} into a serializable POJO. The signal flows
 * through CanvasGate's new `canvasProps` slot to the lazy canvas client,
 * where the camera/lighting/verdict directors consume it. The HUD overlay
 * still watches the same state directly — no projection needed there.
 *
 * Reduced motion: we read the media query once via SSR-safe snapshot.
 * The canvas side uses it to short-circuit lerps into instant snaps.
 */
export function ArenaFrame(
  props: BroadcastStageProps & {
    readonly heroProgress?: number;
    readonly onFirstFrame?: () => void;
  },
) {
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

  const signal = useMemo(
    () => deriveSceneSignal(props.state, isReducedMotion, props.heroProgress),
    [props.state, isReducedMotion, props.heroProgress],
  );

  return (
    <section
      className="arena-frame"
      aria-label="Live debate broadcast"
      data-entry-phase={(props.heroProgress ?? 1) >= 0.98 ? "arena" : "hero"}
      style={{ "--entry-progress": props.heroProgress ?? 1 } as CSSProperties}
    >
      <CanvasGate
        canvasProps={signal}
        onFirstFrame={props.onFirstFrame}
      >
        <BroadcastStage {...props} />
      </CanvasGate>
      <ArenaHud {...props} />
    </section>
  );
}
