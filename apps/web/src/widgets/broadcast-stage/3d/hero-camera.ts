import type { CameraPreset } from "./camera-presets";

export interface HeroCameraProjection {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
}

/**
 * Additive entry treatment. The stage preset remains the source of truth;
 * this only starts a little higher, farther back, and wider before settling
 * into that preset at progress 1.
 */
export function projectHeroCamera(
  preset: CameraPreset,
  progress: number,
  reducedMotion: boolean,
): HeroCameraProjection {
  const p = reducedMotion ? 1 : Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 1));
  const amount = 1 - p;
  return {
    position: [preset.position[0], preset.position[1] + amount * 0.55, preset.position[2] + amount * 0.85],
    target: [preset.target[0], preset.target[1] + amount * 0.2, preset.target[2]],
    fov: preset.fov + amount * 5,
  };
}
