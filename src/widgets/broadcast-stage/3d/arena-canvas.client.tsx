"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { Canvas, type RootState } from "@react-three/fiber";

/**
 * Phase A placeholder scene: proves the R3F pipeline (lit ground plane +
 * one emissive cube) without any world content. OrbitControls and physics
 * arrive in Phase B.
 */
function PlaceholderScene() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 3]} intensity={1.2} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#1a1f2e" roughness={0.9} metalness={0} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color="#111111"
          emissive="#ff5a3c"
          emissiveIntensity={1.6}
        />
      </mesh>
    </>
  );
}

/**
 * Minimal client-only R3F canvas shell. Loaded exclusively through
 * `canvas-gate.tsx` via `next/dynamic(..., { ssr: false })` — never import
 * this module (or `three`) from server components or pure test modules.
 *
 * Disposal discipline: the R3F root tears down on unmount, and this shell
 * additionally releases the WebGL renderer plus its `webglcontextlost`
 * listener in a mount-scoped effect cleanup, so React 19 StrictMode
 * double-mount (mount → cleanup → remount with a fresh renderer) is safe:
 * the stale root is nulled and never touched again.
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

  return (
    <div
      className="relative h-full w-full"
      aria-label="3D arena preview"
      data-testid="arena-canvas"
    >
      <Canvas
        dpr={[1, 1.5]}
        gl={{ powerPreference: "high-performance", antialias: true }}
        camera={{ position: [4, 3, 6], fov: 45 }}
        onCreated={handleCreated}
      >
        <Suspense fallback={null}>
          <PlaceholderScene />
        </Suspense>
      </Canvas>
    </div>
  );
}
