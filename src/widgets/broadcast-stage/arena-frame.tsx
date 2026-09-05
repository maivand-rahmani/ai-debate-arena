"use client";

import { CanvasGate } from "./3d";
import { BroadcastStage, type BroadcastStageProps } from "./broadcast-stage";
import { ArenaHud } from "./arena-hud";

/**
 * The v0.3 broadcast surface. Mounts the 3D arena via {@link CanvasGate}
 * (with the original 2D CSS {@link BroadcastStage} as the no-WebGL fallback)
 * and overlays the HUD pieces on top of the canvas for capable browsers.
 *
 * Props are inherited from {@link BroadcastStage} — same surface, two
 * presentations behind it. Consumers (arena-screen.tsx) only need to know
 * the single ArenaFrame component.
 *
 * The wrapper forces `position: relative; height: 100%` and grid stacks
 * the canvas (bottom) and HUD overlay (top). Pointer-events flows are
 * managed inside `arena-hud.tsx`.
 */
export function ArenaFrame(props: BroadcastStageProps) {
  return (
    <section className="arena-frame" aria-label="Live debate broadcast">
      {/* Full-screen 3D canvas for capable browsers; the existing
          CSS/SVG broadcast stage renders inside CanvasGate if WebGL
          detection or the canvas errors out. */}
      <CanvasGate>
        <BroadcastStage {...props} />
      </CanvasGate>
      {/* HUD overlays — only renders when WebGL is available; the 2D
          fallback already has these embedded. */}
      <ArenaHud {...props} />
    </section>
  );
}
