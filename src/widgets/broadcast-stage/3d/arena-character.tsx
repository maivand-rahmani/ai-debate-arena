"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CapsuleCollider } from "@react-three/rapier";
import {
  CONTENDER_POSES,
  JUDGE_POSES,
  type ContenderPose,
  type JudgePose,
} from "./character-poses";
import { type Vec3 } from "./scene-layout";
import type { ContenderMood, JudgeMood } from "@/widgets/broadcast-stage/mood";

/**
 * Character anchor refs shared by all visual factories. The animation hook
 * writes to these; consumers must read them on meshes/groups via `ref`.
 *
 * The four anchor groups are the minimum needed for mood + idle + verdict
 * reads from a wide audience POV:
 *   - headRef  : the head group (position.y = breath + pose headYOffset,
 *                rotation.z = pose headTilt).
 *   - mouthRef : single mouth mesh (scale.y = speech pulse, blink).
 *   - leftBrowRef / rightBrowRef: pose browLift applied to .position.y.
 */
export interface CharacterAnchorRefs {
  readonly headRef: React.MutableRefObject<THREE.Group | null>;
  readonly mouthRef: React.MutableRefObject<THREE.Mesh | null>;
  readonly leftBrowRef: React.MutableRefObject<THREE.Mesh | null>;
  readonly rightBrowRef: React.MutableRefObject<THREE.Mesh | null>;
}

/** Pose shape accepted via the live `mood` prop. */
export type Pose = ContenderPose | JudgePose;

function isJudgePose(p: Pose): p is JudgePose {
  return "browFurrow" in p;
}

/**
 * Character visual + physics scaffold props. The new `mood` field is
 * optional — if absent the character falls back to the baseline
 * "thinking"/"standing-by" pose so its idle loop keeps running unchanged.
 */
export interface ArenaCharacterProps {
  /** Foot position in world coords. */
  readonly position: Vec3;
  /** Head offset from `position` (camera framing reads this). */
  readonly headOffset: Vec3;
  /** Visual primitives factory receives named-group refs. */
  readonly visual: (refs: CharacterAnchorRefs) => React.ReactNode;
  /** Capsule half-height (used for the static collider). */
  readonly capsuleHalfHeight: number;
  /** Slightly larger presence for the judge (1.0 = standard, ~1.2 = elevated). */
  readonly scale: number;
  /** Per-character idle bob phase (decorrelates the breathing cycle). */
  readonly phaseOffset: number;
  /** Body color (jacket). */
  readonly suitColor: string;
  /** Body shadow color (deeper side of the suit). */
  readonly suitDeepColor: string;
  /** Optional mood — drives pose overlays on top of the idle. */
  readonly mood?: ContenderMood | JudgeMood | undefined;
  /** Whether to honor a verdict reaction burst (overlay scaling). */
  readonly verdictBoost?: { headYOffset: number; breathScale: number; mouthAmp: number; mouthPulseHz: number; browLift: number } | undefined;
}

const BASE_HEAD_Y_FOR_BROWS = 1.28;
const BASE_HEAD_Y_FOR_BROWS_JUDGE = 1.39;

/**
 * Pose table reference for the mood-driven overlay. We pick the matching
 * ContenderPose / JudgePose entry from the static mood tables.
 */
function poseForMood(
  mood: ContenderMood | JudgeMood | undefined,
  isJudge: boolean,
): Pose {
  if (!mood) return isJudge ? JUDGE_POSES["standing-by"] : CONTENDER_POSES.thinking;
  return isJudge
    ? JUDGE_POSES[mood as JudgeMood] ?? JUDGE_POSES["standing-by"]
    : CONTENDER_POSES[mood as ContenderMood] ?? CONTENDER_POSES.thinking;
}

/**
 * Generic seated character scaffold — a fixed-body capsule with the visual
 * mesh tree rendered above it. The visual tree gets `headRef` + `mouthRef`
 * etc. for idle + mood animations. Physics capsule stays fixed/kinematic
 * (no character ever moves); dynamic props react around them.
 *
 * Animation pipeline (deterministic, no per-frame React state):
 *   - Idle: breath bob on headRef.position.y + sway (modulated by pose breathScale)
 *   - Blink: mouthRef.scale.y when sin(t) crosses a threshold
 *   - Speech pulse: mouthRef.scale.y modulated by sin(pose.mouthPulseHz * t) * pose.mouthAmp
 *   - Mood pose: headRef.rotation.z = pose.headTilt + a small sway
 *                 mouthRef.scale.y *= speech pulse + blink (mutually consistent)
 *                 browRef.position.y = base + pose.browLift + verdict bust
 *
 * Refs only — no setState churn, no per-frame allocations.
 */
export function SeatedCharacter(props: ArenaCharacterProps) {
  const { position, headOffset, capsuleHalfHeight, scale, mood, verdictBoost } = props;
  const isJudge = capsuleHalfHeight > 0.5; // judge capsule is 0.55, contender 0.45
  const pose = poseForMood(mood, isJudge);
  const judgePose = isJudge ? (pose as JudgePose) : null;
  const contenderPose = !isJudge ? (pose as ContenderPose) : null;

  const headRef = useRef<THREE.Group | null>(null);
  const mouthRef = useRef<THREE.Mesh | null>(null);
  const leftBrowRef = useRef<THREE.Mesh | null>(null);
  const rightBrowRef = useRef<THREE.Mesh | null>(null);
  const tRef = useRef(0);

  useFrame((_, delta) => {
    tRef.current += delta * props.phaseOffset;
    const t = tRef.current;
    const breath = Math.sin(t * 1.6) * 0.015;

    if (headRef.current) {
      const scaleBreath = breath * pose.breathScale;
      const offset =
        pose.headYOffset + (verdictBoost?.headYOffset ?? 0) + scaleBreath;
      headRef.current.position.y = offset;
      headRef.current.rotation.z = pose.headTilt + Math.sin(t * 0.45) * 0.012;
    }

    if (mouthRef.current) {
      const mouthHz = verdictBoost?.mouthPulseHz ?? pose.mouthPulseHz;
      const mouthAmpBase = verdictBoost?.mouthAmp ?? pose.mouthAmp;
      const pulse = (Math.sin(t * mouthHz) + 1) * 0.5; // 0..1
      const blink = Math.abs(Math.sin(t * 1.4)) > 0.97 ? 0.1 : 1;
      const baseScale = 0.55 + mouthAmpBase * pulse * 0.55;
      mouthRef.current.scale.y = Math.max(0.05, baseScale * blink);
    }

    const browBase = isJudge ? BASE_HEAD_Y_FOR_BROWS_JUDGE : BASE_HEAD_Y_FOR_BROWS;
    const browLift = (contenderPose?.browLift ?? judgePose?.browFurrow ?? 0) +
      (verdictBoost?.browLift ?? 0);

    if (leftBrowRef.current) {
      leftBrowRef.current.position.y = browBase + browLift + Math.sin(t * 0.7 + 1.3) * 0.006;
    }
    if (rightBrowRef.current) {
      rightBrowRef.current.position.y = browBase + browLift - Math.sin(t * 0.7 + 1.3) * 0.006;
    }
  });

  return (
    <group position={position}>
      {/* Fixed capsule body — keeps a Rapier collider in the slot so dynamic
          props can't pass through the torso even though visuals dominate. */}
      <RigidBody type="fixed" colliders={false}>
        <CapsuleCollider args={[capsuleHalfHeight * 0.55, capsuleHalfHeight * 0.7]} />
      </RigidBody>

      {/* The visual mesh tree, scaled to match the character's presence. */}
      <group scale={scale}>
        {props.visual({ headRef, mouthRef, leftBrowRef, rightBrowRef })}
      </group>

      {/* Head anchor offset (camera framing reads the world position). */}
      <group position={headOffset}>
        {/* Empty marker — surfaces the anchor position for callers. */}
      </group>
    </group>
  );
}

// Internal helpers exposed for tests / collaborators.
export { isJudgePose, poseForMood };
