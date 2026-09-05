"use client";

import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT, PROP_MASS } from "./scene-layout";

/**
 * Tiny in-set dressing props that have physics: the judge's gavel and a mic
 * per contender desk. Each one is a real dynamic RigidBody so they fall,
 * collide with the desk/platform colliders, and settle at rest.
 *
 * The initial Y is a hair above the resting surface so gravity gives them a
 * small, theatrical drop on first frame; they find their rest pose after
 * about a second of physics simulation.
 */
export function ArenaProps() {
  return (
    <group>
      <Gavel />
      <Mic
        color={PALETTE.terracotta}
        accentColor={PALETTE.terracottaLight}
        initialPosition={ARENA_LAYOUT.props.micA.initialPosition}
        size={ARENA_LAYOUT.props.micA.size}
      />
      <Mic
        color={PALETTE.plum}
        accentColor={PALETTE.plumLight}
        initialPosition={ARENA_LAYOUT.props.micB.initialPosition}
        size={ARENA_LAYOUT.props.micB.size}
      />
    </group>
  );
}

function Gavel() {
  const { initialPosition, size } = ARENA_LAYOUT.props.gavel;
  return (
    <RigidBody
      type="dynamic"
      mass={PROP_MASS.gavel}
      colliders={false}
      position={[initialPosition[0], initialPosition[1], initialPosition[2]]}
      linearDamping={0.6}
      angularDamping={0.6}
    >
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
      {/* Mallet head */}
      <mesh castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.18, 12]} />
        <meshStandardMaterial
          color={PALETTE.woodWarm}
          roughness={0.55}
          metalness={0.1}
        />
      </mesh>
      {/* Mallet head top — slightly deeper wood tone. */}
      <mesh position={[0.06, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.08, 12]} />
        <meshStandardMaterial
          color={PALETTE.woodMid}
          roughness={0.55}
          metalness={0.1}
        />
      </mesh>
      {/* Metal band wrapping the mallet head */}
      <mesh position={[-0.02, 0, 0]}>
        <cylinderGeometry args={[0.052, 0.052, 0.03, 12]} />
        <meshStandardMaterial
          color={PALETTE.honeyGlow}
          emissive={PALETTE.honeyGlow}
          emissiveIntensity={0.7}
          roughness={0.3}
          metalness={0.8}
        />
      </mesh>
    </RigidBody>
  );
}

function Mic({
  color,
  accentColor,
  initialPosition,
  size,
}: {
  readonly color: string;
  readonly accentColor: string;
  readonly initialPosition: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}) {
  return (
    <RigidBody
      type="dynamic"
      mass={PROP_MASS.mic}
      colliders={false}
      position={[initialPosition[0], initialPosition[1], initialPosition[2]]}
      linearDamping={0.5}
      angularDamping={0.5}
    >
      <CuboidCollider
        args={[
          Math.max(0.025, size[0] / 2),
          Math.max(0.05, size[1] / 2),
          Math.max(0.025, size[2] / 2),
        ]}
      />
      {/* Mic stand base */}
      <mesh position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.04, 12]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.6} />
      </mesh>
      {/* Mic body */}
      <mesh castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.12, 12]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
      {/* Accent ring */}
      <mesh position={[0, 0.04, 0]}>
        <torusGeometry args={[0.045, 0.008, 8, 16]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.5}
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>
      {/* Mic head (foam windscreen) */}
      <mesh position={[0, 0.08, 0]}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color={accentColor} roughness={0.85} />
      </mesh>
    </RigidBody>
  );
}
