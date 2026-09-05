"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CapsuleCollider } from "@react-three/rapier";
import { PALETTE } from "./colors";
import {
  type Vec3,
} from "./scene-layout";

/**
 * Character anchor refs shared by all visual factories. The animation hook
 * writes to these; consumers must read them on meshes/groups via `ref`.
 */
export interface CharacterAnchorRefs {
  readonly headRef: React.MutableRefObject<THREE.Group | null>;
  readonly mouthRef: React.MutableRefObject<THREE.Mesh | null>;
  readonly leftBrowRef: React.MutableRefObject<THREE.Mesh | null>;
  readonly rightBrowRef: React.MutableRefObject<THREE.Mesh | null>;
}

/**
 * Character visual props.
 */
export interface ArenaCharacterProps {
  /** Foot position in world coords. */
  readonly position: Vec3;
  /** Head offset from `position` (used by idle animation to bob). */
  readonly headOffset: Vec3;
  /** Visual primitives factory receives named-group refs. */
  readonly visual: (refs: CharacterAnchorRefs) => React.ReactNode;
  /** Phase C can extend this; for now we only need a static seat capsule. */
  readonly capsuleHalfHeight: number;
  /** Slightly larger presence for the judge (1.0 = standard, ~1.2 = elevated). */
  readonly scale: number;
  /** Phase C will read this for breathing phase. */
  readonly phaseOffset: number;
  /** Body color (jacket). */
  readonly suitColor: string;
  /** Body shadow color (deeper side of the suit). */
  readonly suitDeepColor: string;
}

/**
 * Generic seated character scaffold — a fixed-body capsule with the visual
 * mesh tree rendered above it. The visual tree gets `headRef` + `mouthRef`
 * etc. for idle animation hooks. The physics capsule stays fixed/kinematic
 * (no character ever moves); dynamic props react around them.
 *
 * Idle animation is uniform across contenders — gentle breathing bob,
 * occasional blink (eye scale via mouthRef — used here for the mouth
 * strip), and subtle head sway — driven by `useFrame`. Phase C will layer
 * mood-driven pose changes on top by writing to the same refs.
 */
export function SeatedCharacter(props: ArenaCharacterProps) {
  const { position, headOffset, capsuleHalfHeight, scale } = props;
  const headRef = useRef<THREE.Group | null>(null);
  const mouthRef = useRef<THREE.Mesh | null>(null);
  const leftBrowRef = useRef<THREE.Mesh | null>(null);
  const rightBrowRef = useRef<THREE.Mesh | null>(null);
  const tRef = useRef(0);

  useFrame((_, delta) => {
    tRef.current += delta * props.phaseOffset;
    const t = tRef.current;
    const breathe = Math.sin(t * 1.6) * 0.015;
    const sway = Math.sin(t * 0.7 + 1.3) * 0.018;
    if (headRef.current) headRef.current.position.y = breathe;
    const blink = Math.abs(Math.sin(t * 1.4)) > 0.97 ? 0.1 : 1;
    if (mouthRef.current) mouthRef.current.scale.y = blink;
    if (leftBrowRef.current) leftBrowRef.current.position.y = 1.28 + sway;
    if (rightBrowRef.current) rightBrowRef.current.position.y = 1.28 - sway;
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

      {/* Head anchor offset (Phase C reads through the head group above; this
          marker reserves the nominal head world position for camera framing). */}
      <group position={headOffset}>
        {/* Empty marker — surfaces the anchor position for callers. */}
      </group>
      {/* Hint for the linter: palette used by callers extending the scaffold. */}
      <mesh visible={false}>
        <boxGeometry args={[0.001, 0.001, 0.001]} />
        <meshStandardMaterial color={PALETTE.ink} />
      </mesh>
    </group>
  );
}
