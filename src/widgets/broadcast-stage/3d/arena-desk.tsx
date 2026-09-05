"use client";

import { type ReactNode } from "react";
import {
  RigidBody,
  CuboidCollider,
} from "@react-three/rapier";
import { PALETTE } from "./colors";
import type { DeskLayout } from "./scene-layout";

/**
 * One broadcast desk: a slab top with beveled edges, a dense base panel
 * underneath, an emissive accent strip along the front face (toward the
 * camera), and a static collider sized to the slab so dynamic props rest
 * cleanly on the surface.
 *
 * The collider is a thin box at the desk-top Y; this means mics dropped
 * just above the desk settle on top of it without falling through. Props
 * (gavel/mics) live in `arena-props.tsx`.
 */
export function ArenaDesk({ layout, children }: {
  readonly layout: DeskLayout;
  readonly children?: ReactNode;
}) {
  const {
    position,
    topSize,
    baseSize,
    accentColor,
    accentGlowColor,
    faceCameraRotationY,
  } = layout;
  const topY = position[1];
  const baseY = position[1] - topSize[1] / 2 - baseSize[1] / 2;
  const accentStripY = baseY + baseSize[1] / 2 + 0.02; // just above base, below top
  const accentStripDepth = 0.02;
  const accentStripWidth = baseSize[0] * 0.95;

  // Beveled slab via a slightly chamfered box — true chamfers need ExtrudeGeometry
  // for proper corner cuts; for Phase B we approximate by stacking a slightly
  // smaller top crate over the slab to read as a bevel.
  const bevelHeight = topSize[1] * 0.45;
  const slabHeight = topSize[1] - bevelHeight;

  // Visual mesh tree is rotated to face the audience. The collider doesn't
  // need to match exactly (props are tiny relative to the desk angle), so we
  // rotate it independently at the CuboidCollider rotation prop.
  return (
    <group rotation={[0, faceCameraRotationY, 0]}>
      {/* Base block */}
      <mesh position={[position[0], baseY, position[2]]} castShadow receiveShadow>
        <boxGeometry args={baseSize} />
        <meshStandardMaterial
          color={PALETTE.walnut}
          roughness={0.72}
          metalness={0.05}
        />
      </mesh>

      {/* Desk top slab (rendered as a single chamfered box via stacked geos) */}
      <mesh
        position={[position[0], topY - topSize[1] / 2 + slabHeight / 2, position[2]]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[topSize[0], slabHeight, topSize[2]]} />
        <meshStandardMaterial
          color={PALETTE.creamWarm}
          roughness={0.55}
          metalness={0.05}
        />
      </mesh>
      <mesh
        position={[position[0], topY - bevelHeight / 2, position[2]]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[topSize[0] * 0.92, bevelHeight, topSize[2] * 0.92]} />
        <meshStandardMaterial
          color={PALETTE.cream}
          roughness={0.5}
          metalness={0.05}
        />
      </mesh>

      {/* Honey/strip accent line on the front of the base — emissive (reads as
          a backlit accent strip on the desk front). */}
      <mesh position={[position[0], accentStripY, position[2] + baseSize[2] / 2 + accentStripDepth / 2]}>
        <boxGeometry args={[accentStripWidth, 0.05, accentStripDepth]} />
        <meshStandardMaterial
          color={accentGlowColor}
          emissive={accentColor}
          emissiveIntensity={0.95}
          roughness={0.35}
          metalness={0.6}
          toneMapped={false}
        />
      </mesh>

      {/* Children (typically a chair + character) */}
      {children ? (
        <group position={[position[0], 0, position[2]]}>{children}</group>
      ) : null}
    </group>
  );
}

/**
 * Desk-top collider — broken out of ArenaDesk so the rigid body isn't
 * affected by the visual rotation group (Rapier doesn't carry that rotation
 * through to its broadphase automatically). Sized so the top slab catches
 * any prop dropped just above it.
 */
export function ArenaDeskCollider({ layout }: { readonly layout: DeskLayout }) {
  const { position, topSize, faceCameraRotationY } = layout;
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider
        args={[
          topSize[0] / 2,
          Math.max(0.02, topSize[1] / 2),
          topSize[2] / 2,
        ]}
        position={[position[0], position[1], position[2]]}
        rotation={[0, faceCameraRotationY, 0]}
      />
    </RigidBody>
  );
}

/**
 * Simple chair tucked behind a desk: seat cube + backrest. Static collider so
 * the gavel/mics (if launched backward) settle against it without clipping.
 */
export function ArenaChair({ position, backRest }: {
  readonly position: readonly [number, number, number];
  readonly backRest: readonly [number, number, number];
}) {
  const seatSize: [number, number, number] = [0.7, 0.08, 0.7];
  const legHeight = position[1] - seatSize[1] / 2;
  const seatY = position[1];

  return (
    <group>
      {/* Seat */}
      <mesh position={[position[0], seatY, position[2]]} castShadow receiveShadow>
        <boxGeometry args={seatSize} />
        <meshStandardMaterial
          color={PALETTE.walnutShadow}
          roughness={0.6}
          metalness={0.1}
        />
      </mesh>

      {/* Legs (visual only — collider on whole seat would suffice). */}
      <mesh
        position={[position[0] - seatSize[0] / 2 + 0.05, legHeight, position[2] - seatSize[2] / 2 + 0.05]}
        castShadow
      >
        <boxGeometry args={[0.05, legHeight, 0.05]} />
        <meshStandardMaterial
          color={PALETTE.walnutBlackened}
          roughness={0.5}
          metalness={0.2}
        />
      </mesh>
      <mesh
        position={[position[0] + seatSize[0] / 2 - 0.05, legHeight, position[2] - seatSize[2] / 2 + 0.05]}
        castShadow
      >
        <boxGeometry args={[0.05, legHeight, 0.05]} />
        <meshStandardMaterial
          color={PALETTE.walnutBlackened}
          roughness={0.5}
          metalness={0.2}
        />
      </mesh>
      <mesh
        position={[position[0] - seatSize[0] / 2 + 0.05, legHeight, position[2] + seatSize[2] / 2 - 0.05]}
        castShadow
      >
        <boxGeometry args={[0.05, legHeight, 0.05]} />
        <meshStandardMaterial
          color={PALETTE.walnutBlackened}
          roughness={0.5}
          metalness={0.2}
        />
      </mesh>
      <mesh
        position={[position[0] + seatSize[0] / 2 - 0.05, legHeight, position[2] + seatSize[2] / 2 - 0.05]}
        castShadow
      >
        <boxGeometry args={[0.05, legHeight, 0.05]} />
        <meshStandardMaterial
          color={PALETTE.walnutBlackened}
          roughness={0.5}
          metalness={0.2}
        />
      </mesh>

      {/* Backrest */}
      <mesh
        position={[position[0], seatY + backRest[1] / 2 + 0.04, position[2] - seatSize[2] / 2 + backRest[2] / 2]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={backRest} />
        <meshStandardMaterial
          color={PALETTE.walnutShadow}
          roughness={0.6}
          metalness={0.1}
        />
      </mesh>

      {/* Static collider for the whole chair volume (prevents prop tunneling). */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[backRest[0] / 2 + 0.05, position[1] / 2, seatSize[2] / 2]}
          position={[position[0], position[1] / 2, position[2]]}
        />
      </RigidBody>
    </group>
  );
}
