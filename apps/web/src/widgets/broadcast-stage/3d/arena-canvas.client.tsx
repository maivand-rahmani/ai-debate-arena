"use client";

import { Suspense, useCallback, useEffect, useRef, useLayoutEffect } from "react";
import { Canvas, useFrame, type RootState } from "@react-three/fiber";
import { ArenaScene } from "./arena-scene";
import { ARENA_LAYOUT } from "./scene-layout";
import type { SceneSignal } from "./scene-signal";

/**
 * Props the parent CanvasGate forwards into the lazy canvas. We treat the
 * signal as optional so the canvas still mounts (idle default) before the
 * orchestrator computes the first projection — first frame momentarily
 * renders the idle scene signal, then syncs.
 */
export interface ArenaCanvasClientProps {
  readonly signal?: SceneSignal | undefined;
  /** Fired once after the R3F tree's first rendered frame. */
  readonly onFirstFrame?: () => void;
}

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
 * Scene signal forwarding: the parent {@link CanvasGate} passes a
 * serializable POJO describing the debate state. We hand it to
 * {@link ArenaScene} which routes it through the directors (camera,
 * lighting, characters, confetti). The lazy gate stays three-free; only
 * this client file touches three/r3f.
 */
export default function ArenaCanvasClient({ signal, onFirstFrame }: ArenaCanvasClientProps) {
  const rootRef = useRef<RootState | null>(null);
  const lostHandlerRef = useRef<((event: Event) => void) | null>(null);
  const firstFrameFiredRef = useRef(false);
  const onFirstFrameRef = useRef(onFirstFrame);
  useLayoutEffect(() => {
    onFirstFrameRef.current = onFirstFrame;
  }, [onFirstFrame]);

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
          <ArenaScene signal={signal} />
          <FirstFrameProbe firedRef={firstFrameFiredRef} onReadyRef={onFirstFrameRef} />
        </Suspense>
      </Canvas>
    </div>
  );
}

/**
 * Tiny probe that fires the parent's `onFirstFrame` callback exactly once
 * after the R3F render loop produces its first frame. Optional; inert
 * when no callback is provided.
 */
function FirstFrameProbe({
  firedRef,
  onReadyRef,
}: {
  readonly firedRef: React.MutableRefObject<boolean>;
  readonly onReadyRef: React.MutableRefObject<(() => void) | undefined>;
}) {
  useFrame(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReadyRef.current?.();
  });
  return null;
}
