/**
 * Per-stage intensity targets for the lighting rig.
 *
 * The {@link LightingDirector} in the scene tree reads the active preset
 * (chosen by {@link presetForMode}) and smooth-lerps each light's intensity
 * toward it via the existing ArenaLightingControls handle.
 *
 * Defaults vs. cues:
 *   - stage palette baseline = LIGHTING_INTENSITY_DEFAULTS
 *   - `speaking-a`/`speaking-b`      → active-side spot up, idle side dim
 *   - `rebuttal`                     → both spots normalized, key bright
 *   - `judging`/`verdict`            → honey flood + ambient bump, side spots dim
 *   - `cancelled`/`error`            → ambient cool dip, key stays for legibility
 *
 * Values are tuned to NOT exceed the prior defaults — they modulate within
 * the existing rig envelope so the initial Phase B lighting preserves its
 * read.
 */

import type { LightKey } from "./scene-layout";
import type { StageCamera, StageMode } from "@/widgets/broadcast-stage/stage-state";

export interface LightingPreset {
  readonly intensities: Readonly<Record<LightKey, number>>;
  /** Static label for tests + telemetry. */
  readonly label: string;
}

/** Baseline envelope — same as LIGHTING_INTENSITY_DEFAULTS but typed for the preset. */
const BASELINE: Readonly<Record<LightKey, number>> = {
  ambient: 0.32,
  hemisphere: 0.55,
  key: 1.15,
  spotA: 1.4,
  spotB: 1.4,
  spotJudge: 1.6,
  rimHoneylight: 0.45,
};

/**
 * Active A: terracotta spot up (~+45%), plum spot down (~-40%), judge preserved.
 */
const SPEAKING_A: Record<LightKey, number> = {
  ...BASELINE,
  spotA: 2.05,
  spotB: 0.85,
  rimHoneylight: 0.55,
};

const SPEAKING_B: Record<LightKey, number> = {
  ...BASELINE,
  spotA: 0.85,
  spotB: 2.05,
  rimHoneylight: 0.55,
};

const REBUTTAL: Record<LightKey, number> = {
  ...BASELINE,
  spotA: 1.6,
  spotB: 1.6,
  key: 1.25,
  hemisphere: 0.45,
};

const JUDGING: Record<LightKey, number> = {
  ...BASELINE,
  ambient: 0.42,
  spotJudge: 2.4,
  rimHoneylight: 0.75,
  spotA: 0.7,
  spotB: 0.7,
};

const VERDICT: Record<LightKey, number> = {
  ...BASELINE,
  ambient: 0.5,
  spotJudge: 2.6,
  rimHoneylight: 0.95,
  spotA: 1.0,
  spotB: 1.0,
  key: 1.05,
};

const CANCELLED: Record<LightKey, number> = {
  ...BASELINE,
  ambient: 0.28,
  hemisphere: 0.4,
  spotA: 0.9,
  spotB: 0.9,
  spotJudge: 1.1,
};

export const LIGHTING_PRESETS: Readonly<Record<StageCamera | "neutral", LightingPreset>> =
  {
    idle: { intensities: BASELINE, label: "idle" },
    a: { intensities: SPEAKING_A, label: "contender-a-active" },
    b: { intensities: SPEAKING_B, label: "contender-b-active" },
    rebuttal: { intensities: REBUTTAL, label: "rebuttal" },
    judge: { intensities: JUDGING, label: "judge-evaluating" },
    verdict: { intensities: VERDICT, label: "verdict-revealed" },
    neutral: { intensities: CANCELLED, label: "cancelled-error" },
  };

/**
 * Pick the lighting preset for the current stage state. Mirrors
 * `presetForMode` in {@link ./camera-presets} but folds rebuttal and the
 * non-speaking edge cases into a single mapping.
 */
export function lightingPresetFor(
  mode: StageMode,
  camera: StageCamera,
): StageCamera | "neutral" {
  if (mode === "cancelled" || mode === "error") return "neutral";
  if (mode === "judging") return "judge";
  if (mode === "verdict") return "verdict";
  return camera;
}
