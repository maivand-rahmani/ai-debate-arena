"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { Canvas, type RootState } from "@react-three/fiber";
import { ArenaScene } from "./arena-scene";
import { ARENA_LAYOUT } from "./scene-layout";

/**
 * Client-only R3F canvas shell. Loaded exclusively through
 * `canvas-gate.tsx` via `next/dynamic(..., { ssr: false })` — never import
 * this module (or `three`) from server components or pure test modules.
 *
 * Disposal discipline: the R3F root tears down on unmount, and this shell
 * additionally releases the WebGL renderer plus its `webglcontextlost`
 * listener in a mount-scoped effect cleanup, so React 19 StrictMode
 * double-mount (mount → cleanup → remount with a fresh renderer) is safe:
 * the stale root is nulled and never touched again.
 *
 * The canvas sits at the bottom of a `relative`-positioned frame with
 * `pointer-events: auto` so the spectator camera (OrbitControls) works
 * everywhere on the world surface; HTML overlays above the canvas opt
 * back into pointer events for their interactive children only.
 */
export default function ArenaCanvasClient() {
  const rootRef = useRef<RootState | null>(null);
  const lostHandlerRef = useRef<((event: Event) => void) | null>(null);

  const handleCreated = useCallback((state: RootState) => {
    rootRef.current = state;
    const onLost = (event: Event) => {
      // Prevent the default so the context can still be restored.
      event.preventDefault();
    };
    lostHandlerRef.current = onLost;
    state.gl.domElement.addEventListener("webglcontextlost", onLost);
  }, []);

  useEffect(() => {
    return () => {
      const root = rootRef.current;
      rootRef.current = null;
      const onLost = lostHandlerRef.current;
      lostHandlerRef.current = null;
      try {
        if (onLost) root?.gl.domElement.removeEventListener("webglcontextlost", onLost);
      } catch {
        // DOM node already gone — nothing to detach.
      }
      try {
        root?.gl.dispose();
      } catch {
        // Context already lost — renderer release is best-effort.
      }
    };
  }, []);

  const { initialPosition, fov } = ARENA_LAYOUT.camera;

  return (
    <div
      className="absolute inset-0 h-full w-full"
      aria-label="3D debate arena"
      data-testid="arena-canvas"
    >
      <Canvas
        dpr={[1, 1.5]}
        shadows
        gl={{ powerPreference: "high-performance", antialias: true }}
        camera={{
          position: [initialPosition[0], initialPosition[1], initialPosition[2]],
          fov,
          near: 0.1,
          far: 80,
        }}
        onCreated={handleCreated}
      >
        <Suspense fallback={null}>
          <ArenaScene />
        </Suspense>
      </Canvas>
    </div>
  );
}
