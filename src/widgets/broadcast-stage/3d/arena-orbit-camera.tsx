"use client";

import { OrbitControls } from "@react-three/drei";
import { ARENA_LAYOUT } from "./scene-layout";

/**
 * Constrained spectator camera. The drei OrbitControls is registered as the
 * default camera controller — Phase C can read the `controls` ref to do
 * animated cinematic cuts or to pulse the orbit limits during a verdict.
 *
 * Constraints (from {@link ARENA_LAYOUT.camera}):
 *   - polar angle locked between ~32° and ~83° so the camera cannot dip
 *     below the stage floor or rise above the truss
 *   - distance clamped to a tight framing range (6m — 18m)
 *   - damping enabled for buttery inertia
 *   - target biased slightly behind the desks so the cyclorama signage
 *     stays visible
 */
export function ArenaOrbitCamera() {
  const {
    initialTarget,
    minDistance,
    maxDistance,
    minPolarAngle,
    maxPolarAngle,
  } = ARENA_LAYOUT.camera;
  // Initial position is set on the Canvas's camera prop (see
  // `arena-canvas.client.tsx`); OrbitControls just inherits it on mount.
  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      target={[initialTarget[0], initialTarget[1], initialTarget[2]]}
      minDistance={minDistance}
      maxDistance={maxDistance}
      minPolarAngle={minPolarAngle}
      maxPolarAngle={maxPolarAngle}
    />
  );
}
