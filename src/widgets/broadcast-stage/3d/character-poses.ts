/**
 * Per-mood pose targets for the seated characters.
 *
 * The {@link SeatedCharacter} scaffold's `useFrame` reads the active
 * ContenderMood / JudgeMood and modulates the named anchor refs:
 *
 *   - `headRef.position.y`   — breathing bob + mood offset (lean/slump)
 *   - `headRef.rotation.z`   — head tilt (listening/thinking tilt slightly)
 *   - `mouthRef.scale.y`     — blink (binary 0.1/1.0) + speech pulse (sin)
 *   - `browRef.position.y`   — heat / focus expression
 *
 * The pose table is a Three-free lookup so vitest in a node environment can
 * drive the same mapping. Rendering side just sets the intensity multipliers
 * onto the ref-driving `useFrame`.
 */

import type { ContenderMood, JudgeMood } from "@/widgets/broadcast-stage/mood";

export interface ContenderPose {
  /** Vertical offset added on top of the breathing bob (lean forward = negative). */
  readonly headYOffset: number;
  /** Roll (head tilt left/right), radians. */
  readonly headTilt: number;
  /** Multiplier on the breathing bob amplitude (>1 = exaggerated motion). */
  readonly breathScale: number;
  /** Hz for the mouth pulse (speaking bumps this up; listening holds it quiet). */
  readonly mouthPulseHz: number;
  /** Multiplier on the mouth pulse amplitude. */
  readonly mouthAmp: number;
  /** Persistent brow lift — adds/subtracts from the Y position. */
  readonly browLift: number;
  /** Static label. */
  readonly label: string;
}

export interface JudgePose {
  /** Vertical offset for the head (considering sway = stoic lean). */
  readonly headYOffset: number;
  /** Roll (sway) baseline — judges square their shoulders. */
  readonly headTilt: number;
  readonly breathScale: number;
  /** Multiplier on the brow pinch for evaluating / revealed reactions. */
  readonly browFurrow: number;
  /** Mouth pulse frequency — slow during evaluating, opaque for verdict reveals. */
  readonly mouthPulseHz: number;
  readonly mouthAmp: number;
  readonly label: string;
}

/**
 * Contender pose table. Values are subtle (≤ ±0.05 m offsets, ≤ 0.18 rad tilt)
 * so they read from the wide audience POV without snapping.
 */
export const CONTENDER_POSES: Readonly<Record<ContenderMood, ContenderPose>> = {
  thinking: {
    headYOffset: 0.02,
    headTilt: 0.05,
    breathScale: 0.7,
    mouthPulseHz: 0.5,
    mouthAmp: 0.3,
    browLift: 0.012,
    label: "thinking",
  },
  speaking: {
    headYOffset: 0.0,
    headTilt: 0.0,
    breathScale: 1.0,
    mouthPulseHz: 3.4,
    mouthAmp: 0.95,
    browLift: 0.0,
    label: "speaking",
  },
  listening: {
    headYOffset: 0.01,
    headTilt: 0.14, // slight head tilt toward the speaker
    breathScale: 0.8,
    mouthPulseHz: 0.3,
    mouthAmp: 0.15,
    browLift: 0.0,
    label: "listening",
  },
  confident: {
    headYOffset: -0.01,
    headTilt: 0.0,
    breathScale: 1.0,
    mouthPulseHz: 2.2,
    mouthAmp: 0.7,
    browLift: -0.006,
    label: "confident",
  },
  heated: {
    headYOffset: -0.015,
    headTilt: -0.05,
    breathScale: 1.4,
    mouthPulseHz: 4.0,
    mouthAmp: 1.2,
    browLift: -0.022, // brows drawn down
    label: "heated",
  },
  confused: {
    headYOffset: 0.025,
    headTilt: 0.18,
    breathScale: 0.6,
    mouthPulseHz: 0.6,
    mouthAmp: 0.3,
    browLift: 0.018,
    label: "confused",
  },
  impressed: {
    headYOffset: -0.005,
    headTilt: 0.08,
    breathScale: 1.1,
    mouthPulseHz: 1.4,
    mouthAmp: 0.55,
    browLift: 0.005,
    label: "impressed",
  },
  victorious: {
    headYOffset: -0.02,
    headTilt: 0.0,
    breathScale: 1.6,
    mouthPulseHz: 2.4,
    mouthAmp: 1.0,
    browLift: -0.01,
    label: "victorious",
  },
  defeated: {
    headYOffset: 0.04,
    headTilt: 0.05,
    breathScale: 0.4,
    mouthPulseHz: 0.2,
    mouthAmp: 0.1,
    browLift: 0.022,
    label: "defeated",
  },
  panicking: {
    headYOffset: 0.0,
    headTilt: -0.06,
    breathScale: 2.0,
    mouthPulseHz: 5.0,
    mouthAmp: 1.4,
    browLift: 0.0,
    label: "panicking",
  },
};

/**
 * Judge pose table. The judge is shown larger so absolute amplitudes matter
 * more — we exaggerate the contrasts so verdict victors/defeats read at a
 * glance from the wide established shot.
 */
export const JUDGE_POSES: Readonly<Record<JudgeMood, JudgePose>> = {
  "standing-by": {
    headYOffset: 0.0,
    headTilt: 0.0,
    breathScale: 0.9,
    browFurrow: 0.0,
    mouthPulseHz: 0.4,
    mouthAmp: 0.2,
    label: "standing-by",
  },
  evaluating: {
    headYOffset: -0.015,
    headTilt: 0.08,
    breathScale: 1.0,
    browFurrow: 0.018,
    mouthPulseHz: 0.8,
    mouthAmp: 0.3,
    label: "evaluating",
  },
  revealed: {
    headYOffset: 0.0,
    headTilt: 0.0,
    breathScale: 1.1,
    browFurrow: 0.0,
    mouthPulseHz: 1.2,
    mouthAmp: 0.5,
    label: "revealed",
  },
  impressed: {
    headYOffset: -0.01,
    headTilt: 0.05,
    breathScale: 1.0,
    browFurrow: -0.005,
    mouthPulseHz: 1.0,
    mouthAmp: 0.45,
    label: "impressed",
  },
  "not-impressed": {
    headYOffset: 0.015,
    headTilt: -0.05,
    breathScale: 0.85,
    browFurrow: 0.022,
    mouthPulseHz: 0.4,
    mouthAmp: 0.18,
    label: "not-impressed",
  },
  stoic: {
    headYOffset: 0.0,
    headTilt: 0.0,
    breathScale: 0.8,
    browFurrow: 0.012,
    mouthPulseHz: 0.3,
    mouthAmp: 0.12,
    label: "stoic",
  },
  dismayed: {
    headYOffset: 0.035,
    headTilt: 0.12,
    breathScale: 0.55,
    browFurrow: 0.028,
    mouthPulseHz: 0.2,
    mouthAmp: 0.1,
    label: "dismayed",
  },
};

/**
 * Pose applied during a transient reaction burst (verdict reveal). The
 * `victoryBounce`/`defeatSlump` keys are writeback targets the gallery will
 * set when the verdict lands.
 */
export interface ReactionBurst {
  readonly headYOffset: number;
  readonly breathScale: number;
  readonly mouthPulseHz: number;
  readonly mouthAmp: number;
  readonly browLift: number;
}

export const VERDICT_REACTIONS = {
  winner: {
    headYOffset: -0.04,
    breathScale: 2.4,
    mouthPulseHz: 4.0,
    mouthAmp: 1.5,
    browLift: -0.012,
  },
  loser: {
    headYOffset: 0.07,
    breathScale: 0.3,
    mouthPulseHz: 0.0,
    mouthAmp: 0.0,
    browLift: 0.03,
  },
  draw: {
    headYOffset: 0.0,
    breathScale: 1.0,
    mouthPulseHz: 1.4,
    mouthAmp: 0.55,
    browLift: 0.012,
  },
} as const satisfies Readonly<Record<"winner" | "loser" | "draw", ReactionBurst>>;

/**
 * Blend two poses by mixing offsets linearly. Used during the verdict
 * reveal so the transition isn't snappy: the active pose eases into the
 * reaction pose over `blend` seconds, then back to the active pose after.
 */
export function blendPoseOffsets(
  base: { headYOffset: number; browLift: number },
  burst: ReactionBurst,
  t: number,
): { headYOffset: number; browLift: number } {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    headYOffset: base.headYOffset * (1 - clamped) + burst.headYOffset * clamped,
    browLift: base.browLift * (1 - clamped) + burst.browLift * clamped,
  };
}
