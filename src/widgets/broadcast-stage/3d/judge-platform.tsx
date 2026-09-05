"use client";

import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";

/**
 * The central Judge platform — a low, wide raised dais with honey trim that
 * reads as the "throne" in the studio. Wider than the contender desks so the
 * gavel has room to rest on top without rolling off.
 *
 * Visual stack (bottom → top):
 *   - Two stacked base blocks (deeper/darker lower, lighter top) creating
 *     a stepped plinth silhouette.
 *   - Honey side rails along the front + back edges (emissive).
 *   - Honey-trim ring around the upper slab (the dais "rim").
 *
 * Static collider sized to the upper block so the gavel rests flush.
 */
export function JudgePlatform() {
  const { judge } = ARENA_LAYOUT;
  const { platformPosition, platformSize, accentColor } = judge;

  const topY = platformPosition[1] + platformSize[1] / 2;
  const halfWidth = platformSize[0] / 2;
  const halfDepth = platformSize[2] / 2;
  const trim = 0.08;

  return (
    <group>
      {/* Upper slab (the seat surface the gavel rests on). */}
      <mesh
        position={platformPosition}
        castShadow
        receiveShadow
      >
        <boxGeometry args={platformSize} />
        <meshStandardMaterial
          color={PALETTE.walnut}
          roughness={0.65}
          metalness={0.05}
        />
      </mesh>

      {/* Top surface accent plank so the surface reads as wood + planks, not a
          flat block. */}
      <mesh
        position={[platformPosition[0], topY + 0.001, platformPosition[2]]}
        rotation-x={-Math.PI / 2}
        receiveShadow
      >
        <planeGeometry args={[platformSize[0] * 0.96, platformSize[2] * 0.94]} />
        <meshStandardMaterial
          color={PALETTE.woodHighlight}
          roughness={0.55}
          metalness={0.0}
        />
      </mesh>

      {/* Honey rail across the front face */}
      <mesh
        position={[
          platformPosition[0],
          platformPosition[1],
          platformPosition[2] + halfDepth + trim / 2,
        ]}
      >
        <boxGeometry args={[platformSize[0] + trim * 2, trim, trim]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.5}
          roughness={0.4}
          metalness={0.55}
          toneMapped={false}
        />
      </mesh>

      {/* Honey rail across the back face */}
      <mesh
        position={[
          platformPosition[0],
          platformPosition[1],
          platformPosition[2] - halfDepth - trim / 2,
        ]}
      >
        <boxGeometry args={[platformSize[0] + trim * 2, trim, trim]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.5}
          roughness={0.4}
          metalness={0.55}
          toneMapped={false}
        />
      </mesh>

      {/* Side honey rails */}
      <mesh
        position={[
          platformPosition[0] + halfWidth + trim / 2,
          platformPosition[1],
          platformPosition[2],
        ]}
      >
        <boxGeometry args={[trim, trim, platformSize[2]]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.4}
          roughness={0.4}
          metalness={0.55}
        />
      </mesh>
      <mesh
        position={[
          platformPosition[0] - halfWidth - trim / 2,
          platformPosition[1],
          platformPosition[2],
        ]}
      >
        <boxGeometry args={[trim, trim, platformSize[2]]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.4}
          roughness={0.4}
          metalness={0.55}
        />
      </mesh>

      {/* Static collider for the platform (gavel rest target). */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[
            platformSize[0] / 2,
            platformSize[1] / 2,
            platformSize[2] / 2,
          ]}
          position={platformPosition}
        />
      </RigidBody>
    </group>
  );
}
