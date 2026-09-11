"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";

/**
 * The static architectural shell of the arena. Visual meshes are deliberately
 * layered around the same simple colliders: the extra seams, reveals, and
 * practical fixtures sell scale without making Rapier solve a mesh collider.
 */
export function ArenaFloor() {
  const { arenaFloor, stage } = ARENA_LAYOUT;
  const plankCount = 6;
  const planks = useMemo(() => {
    const plankWidth = stage.size[0] / plankCount;
    return Array.from({ length: plankCount }, (_, index) => ({
      x: -stage.size[0] / 2 + plankWidth / 2 + index * plankWidth,
      tone:
        index % 3 === 0
          ? PALETTE.woodWarm
          : index % 3 === 1
            ? PALETTE.woodHighlight
            : PALETTE.woodMid,
    }));
  }, [stage.size]);

  const stageTopY = stage.position[1] + stage.size[1] / 2;
  const stageEdge = stage.size[0] / 2;

  return (
    <group>
      <mesh position={[0, -0.01, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[arenaFloor.size[0], arenaFloor.size[1]]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.88} metalness={0.08} />
      </mesh>

      {/* Low-contrast floor inlays give the camera a premium studio floor cue. */}
      <mesh position={[0, 0.002, 2.7]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[10.8, 0.025]} />
        <meshStandardMaterial color={PALETTE.walnut} roughness={0.72} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.002, -5.9]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[10.8, 0.025]} />
        <meshStandardMaterial color={PALETTE.walnut} roughness={0.72} metalness={0.15} />
      </mesh>

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[arenaFloor.size[0] / 2, 0.05, arenaFloor.size[1] / 2]}
          position={[0, -0.05, 0]}
        />
      </RigidBody>

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[stage.size[0] / 2, stage.size[1] / 2, stage.size[2] / 2]}
          position={stage.position}
        />

        {/* Shadow plinth and inset upper stage create a real broadcast riser. */}
        <mesh position={[0, stage.position[1] - 0.09, 0]} castShadow receiveShadow>
          <boxGeometry args={[stage.size[0] + 0.22, 0.22, stage.size[2] + 0.22]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.72} metalness={0.18} />
        </mesh>
        <mesh position={stage.position} castShadow receiveShadow>
          <boxGeometry args={stage.size} />
          <meshStandardMaterial color={PALETTE.walnut} roughness={0.68} metalness={0.12} />
        </mesh>
      </RigidBody>

      {planks.map((plank) => (
        <mesh key={plank.x} position={[plank.x, stageTopY + 0.003, 0]} rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[stage.size[0] / plankCount * 0.965, stage.size[2] * 0.965]} />
          <meshStandardMaterial color={plank.tone} roughness={0.7} metalness={0.05} />
        </mesh>
      ))}

      {/* Broadcast-floor detailing: inset seams, twin brass lanes, and a
          subtle center medallion give the wide shot a designed focal plane. */}
      {[-3.5, -1.75, 0, 1.75, 3.5].map((x) => (
        <mesh key={`floor-seam-x-${x}`} position={[x, stageTopY + 0.012, 0]} receiveShadow>
          <boxGeometry args={[0.018, 0.012, stage.size[2] * 0.9]} />
          <meshStandardMaterial color={PALETTE.walnutShadow} roughness={0.7} metalness={0.18} />
        </mesh>
      ))}
      {[-2.1, -0.7, 0.7, 2.1].map((z) => (
        <mesh key={`floor-seam-z-${z}`} position={[0, stageTopY + 0.013, z]} receiveShadow>
          <boxGeometry args={[stage.size[0] * 0.88, 0.012, 0.018]} />
          <meshStandardMaterial color={PALETTE.walnutShadow} roughness={0.7} metalness={0.18} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`inlay-${side}`} position={[side * 1.18, stageTopY + 0.017, 0.48]} rotation-y={side * 0.16} receiveShadow>
          <boxGeometry args={[0.035, 0.014, 3.9]} />
          <meshStandardMaterial color={PALETTE.honeyDeep} emissive={PALETTE.honeyDeep} emissiveIntensity={0.12} roughness={0.34} metalness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, stageTopY + 0.018, 0.55]} rotation-x={-Math.PI / 2} receiveShadow>
        <ringGeometry args={[0.62, 0.66, 40]} />
        <meshStandardMaterial color={PALETTE.honeyDeep} roughness={0.4} metalness={0.65} />
      </mesh>
      <mesh position={[0, stageTopY + 0.017, 0.55]} rotation-x={-Math.PI / 2} receiveShadow>
        <ringGeometry args={[0.38, 0.4, 40]} />
        <meshStandardMaterial color={PALETTE.walnutShadow} roughness={0.55} metalness={0.34} />
      </mesh>

      {/* Flush metal edge profile, with small breaks that read as joinery. */}
      <mesh position={[0, stageTopY + 0.015, stage.size[2] / 2 + 0.055]} castShadow>
        <boxGeometry args={[stage.size[0] + 0.12, 0.08, 0.08]} />
        <meshStandardMaterial color={PALETTE.honeyLight} roughness={0.34} metalness={0.7} />
      </mesh>
      <mesh position={[0, stageTopY + 0.015, -stage.size[2] / 2 - 0.055]} castShadow>
        <boxGeometry args={[stage.size[0] + 0.12, 0.08, 0.08]} />
        <meshStandardMaterial color={PALETTE.honeyLight} roughness={0.34} metalness={0.7} />
      </mesh>
      <mesh position={[-stageEdge - 0.055, stageTopY + 0.015, 0]} castShadow>
        <boxGeometry args={[0.08, 0.08, stage.size[2]]} />
        <meshStandardMaterial color={PALETTE.honeyLight} roughness={0.34} metalness={0.7} />
      </mesh>
      <mesh position={[stageEdge + 0.055, stageTopY + 0.015, 0]} castShadow>
        <boxGeometry args={[0.08, 0.08, stage.size[2]]} />
        <meshStandardMaterial color={PALETTE.honeyLight} roughness={0.34} metalness={0.7} />
      </mesh>
      <mesh position={[0, stage.position[1] - 0.07, stage.size[2] / 2 + 0.035]} castShadow receiveShadow>
        <boxGeometry args={[stage.size[0] + 0.16, 0.26, 0.09]} />
        <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.62} metalness={0.28} />
      </mesh>
      <mesh position={[0, stage.position[1] - 0.07, stage.size[2] / 2 + 0.084]}>
        <boxGeometry args={[stage.size[0] * 0.74, 0.035, 0.018]} />
        <meshStandardMaterial color={PALETTE.honeyGlow} emissive={PALETTE.honeyGlow} emissiveIntensity={0.35} toneMapped={false} roughness={0.32} metalness={0.6} />
      </mesh>
    </group>
  );
}

export function ArenaCyclorama() {
  const { cycloramaPosition, cycloramaRadius, cycloramaSegments, height } = ARENA_LAYOUT.walls;
  // Keep the acoustic ribs outside the title panel so the banner remains a
  // readable architectural feature instead of being sliced by vertical bars.
  const ribs = useMemo(() => [-5.45, -4.95, 4.95, 5.45], []);

  return (
    <group>
      <mesh
        position={[cycloramaPosition[0], height / 2, cycloramaPosition[2] + cycloramaRadius * 0.1]}
        rotation-y={Math.PI}
        receiveShadow
      >
        <cylinderGeometry args={[cycloramaRadius, cycloramaRadius, height, Math.max(32, cycloramaSegments), 1, true, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color={PALETTE.cream} side={THREE.BackSide} roughness={0.9} metalness={0.02} />
      </mesh>

      {/* Narrow acoustic ribs and a horizontal light slot add depth to the wall. */}
      {ribs.map((x) => (
        <mesh key={x} position={[x, 2.55, -6.56]} castShadow>
          <boxGeometry args={[0.07, 4.9, 0.12]} />
          <meshStandardMaterial color={PALETTE.taupeMid} roughness={0.62} metalness={0.18} />
        </mesh>
      ))}
      <mesh position={[0, 2.04, -6.48]}>
        <boxGeometry args={[10.4, 0.035, 0.035]} />
        <meshStandardMaterial
          color={PALETTE.honeyLight}
          emissive={PALETTE.honeyGlow}
          emissiveIntensity={0.38}
          roughness={0.38}
          metalness={0.45}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export function ArenaWalls() {
  const { leftPosition, rightPosition, height, thickness, span } = ARENA_LAYOUT.walls;

  return (
    <group>
      {[leftPosition, rightPosition].map((pos, index) => (
        <RigidBody key={index} type="fixed" colliders={false}>
          <CuboidCollider args={[thickness / 2, height / 2, span / 2]} position={pos} />
          <mesh position={pos} castShadow receiveShadow>
            <boxGeometry args={[thickness, height, span]} />
            <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.8} metalness={0.22} />
          </mesh>
          <mesh position={[pos[0] - (index === 0 ? 0.08 : -0.08), height * 0.55, pos[2]]} castShadow>
            <boxGeometry args={[0.16, height * 0.84, span * 0.92]} />
            <meshStandardMaterial color={PALETTE.walnut} roughness={0.68} metalness={0.3} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
}

function PracticalFixture({ position, accent }: { readonly position: readonly [number, number, number]; readonly accent: string }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.115, 0.14, 0.13, 12]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.35} metalness={0.72} />
      </mesh>
      <mesh position={[0, -0.075, 0]} rotation-x={Math.PI / 2}>
        <circleGeometry args={[0.075, 12]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.12, 0]}>
        <boxGeometry args={[0.18, 0.025, 0.18]} />
        <meshStandardMaterial color={PALETTE.walnutShadow} roughness={0.45} metalness={0.5} />
      </mesh>
    </group>
  );
}

export function ArenaTruss() {
  const { position, size, barCount } = ARENA_LAYOUT.truss;
  const barSpacing = size[0] / barCount;

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} position={position} />
        <mesh position={position} castShadow>
          <boxGeometry args={size} />
          <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.46} metalness={0.62} />
        </mesh>
      </RigidBody>

      {Array.from({ length: barCount - 1 }, (_, index) => {
        const x = -size[0] / 2 + barSpacing * (index + 1);
        return (
          <mesh key={`bar-${index}`} position={[x, position[1] - size[1] / 2 - 0.08, position[2]]} castShadow>
            <boxGeometry args={[0.05, 0.16, size[2] * 1.5]} />
            <meshStandardMaterial color={PALETTE.walnutShadow} roughness={0.38} metalness={0.7} />
          </mesh>
        );
      })}

      {Array.from({ length: 5 }, (_, index) => {
        const x = -size[0] / 2 + (size[0] / 4) * index;
        return (
          <PracticalFixture
            key={`fixture-${index}`}
            position={[x, position[1] - size[1] / 2 - 0.23, position[2]]}
            accent={index === 2 ? PALETTE.honeyGlow : PALETTE.creamWarm}
          />
        );
      })}
    </group>
  );
}
