/**
 * Camera presets for the cinematic cut system.
 *
 * One preset per `StageCamera` value from `stage-state.ts` plus a
 * `neutral` preset for cancelled/error states. The {@link CameraDirector}
 * mounted inside the R3F scene tree lerps the spectator camera + OrbitControls
 * target toward the active preset for `holdMs`, then hands control back to
 * the user.
 *
 * Preset positions are biased so the spectator camera always frames the
 * active element: contenders get a tilted-3/4 close-up, the judge gets a
 * straight-on mid-shot, the verdict pulling wider for spectacle.
 *
 * This module is intentionally Three-free so it can be unit-tested in the
 * `node` vitest environment; the rendering side just reads tuples.
 */

import type { StageCamera, StageMode } from "@/widgets/broadcast-stage/stage-state";

export interface CameraPreset {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
  /** Milliseconds the director owns the camera; orbit re-enables after. */
  readonly holdMs: number;
  /** Static label for tests + telemetry. */
  readonly label: string;
}

/**
 * Distance / framing map. Each preset uses world-units (meters). The held
 * FOVs vary so close-ups feel intimate and wide shots feel theatrical.
 */
export const CAMERA_PRESETS: Readonly<Record<StageCamera | "neutral", CameraPreset>> = {
  idle: {
    position: [0, 4.6, 12.8],
    target: [0, 1.35, -1.45],
    fov: 50,
    holdMs: 700,
    label: "idle",
  },
  a: {
    position: [-3.9, 3.25, 6.8],
    target: [-4.15, 1.5, 0.15],
    fov: 42,
    holdMs: 850,
    label: "contender-a",
  },
  b: {
    position: [3.9, 3.25, 6.8],
    target: [4.15, 1.5, 0.15],
    fov: 42,
    holdMs: 850,
    label: "contender-b",
  },
  rebuttal: {
    position: [0, 5.0, 10.4],
    target: [0, 1.45, -1.5],
    fov: 46,
    holdMs: 950,
    label: "rebuttal",
  },
  judge: {
    position: [0, 3.7, 8.4],
    target: [0, 1.55, -2.95],
    fov: 38,
    holdMs: 1100,
    label: "judge",
  },
  verdict: {
    position: [0, 4.05, 13.6],
    target: [0, 1.45, -1.55],
    fov: 52,
    holdMs: 1800,
    label: "verdict",
  },
  neutral: {
    position: [0, 4.4, 11.5],
    target: [0, 1.2, -1.0],
    fov: 50,
    holdMs: 400,
    label: "neutral",
  },
};

/**
 * Pick the camera preset for the current stage mode. The spec mapping:
 *
 *   - speaking (round 1 A)   → a
 *   - speaking (round 1 B)   → b
 *   - speaking (rebuttal)    → rebuttal
 *   - judging                → judge
 *   - verdict                → verdict
 *   - cancelled / error      → neutral (wide, handoff quickly)
 *   - speaking (no currentSide) / idle / starting → idle
 */
export function presetForMode(
  mode: StageMode,
  camera: StageCamera,
): StageCamera | "neutral" {
  if (mode === "cancelled" || mode === "error") return "neutral";
  return camera;
}
