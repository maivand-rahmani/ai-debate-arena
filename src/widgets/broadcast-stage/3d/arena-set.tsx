"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";

/**
 * The arena's static floor assembly: a darker studio floor that surrounds a
 * raised, planked wooden stage (where the desks + judge live). One fixed
 * Rapier collider underneath the floor locks the dynamic props in place; the
 * visible planks and trim are pure rendering surfaces (no colliders of their
 * own — the desk/plinth colliders below them handle prop-on-desk resting).
 */
export function ArenaFloor() {
  const { arenaFloor, stage } = ARENA_LAYOUT;

  // Stage planks: 6 lengthwise planks across the 12-unit stage so the eye
  // reads the wood grain even without textures.
  const plankCount = 6;
  const planks = useMemo(() => {
    const plankWidth = stage.size[0] / plankCount;
    const list: { x: number; tone: string }[] = [];
    for (let i = 0; i < plankCount; i++) {
      const x = -stage.size[0] / 2 + plankWidth / 2 + i * plankWidth;
      // Alternate between warm and shadow tones so the planks read as wood.
      const toneIndex = i % 3;
      const tone =
        toneIndex === 0
          ? PALETTE.woodWarm
          : toneIndex === 1
            ? PALETTE.woodHighlight
            : PALETTE.woodMid;
      list.push({ x, tone });
    }
    return list;
  }, [stage.size]);

  const stageTopY = stage.position[1] + stage.size[1] / 2;

  return (
    <group>
      {/* Outer dark arena floor (kept simple — atmospheric textures live in the
          fog + cyclorama, not in floor detail). */}
      <mesh
        position={[0, -0.01, 0]}
        rotation-x={-Math.PI / 2}
        receiveShadow
      >
        <planeGeometry args={[arenaFloor.size[0], arenaFloor.size[1]]} />
        <meshStandardMaterial
          color={PALETTE.walnutBlackened}
          roughness={0.94}
          metalness={0.0}
        />
      </mesh>

      {/* Floor collider — a thin static box spanning the arena, so dynamic
          props (gavel + mics) cannot tunnel through at rest. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[arenaFloor.size[0] / 2, 0.05, arenaFloor.size[1] / 2]}
          position={[0, -0.05, 0]}
        />
      </RigidBody>

      {/* Raised wooden stage — deeper than just a slab to read as a real stage. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[stage.size[0] / 2, stage.size[1] / 2, stage.size[2] / 2]}
          position={stage.position}
        />
        <mesh position={stage.position} castShadow receiveShadow>
          <boxGeometry args={stage.size} />
          <meshStandardMaterial
            color={PALETTE.woodMid}
            roughness={0.78}
            metalness={0.0}
          />
        </mesh>
      </RigidBody>

      {/* Stage top planks (visual only, sits flush with stage top). */}
      {planks.map((plank) => (
        <mesh
          key={plank.x}
          position={[plank.x, stageTopY + 0.001, 0]}
          rotation-x={-Math.PI / 2}
          receiveShadow
        >
          <planeGeometry
            args={[
              ((stage.size[0] / plankCount) * 0.96),
              stage.size[2] * 0.985,
            ]}
          />
          <meshStandardMaterial
            color={plank.tone}
            roughness={0.72}
            metalness={0.0}
          />
        </mesh>
      ))}

      {/* Honey-trim strip along the front + back of the stage — small detail
          that lets the stage read against the dark floor. */}
      <FrontBackTrim y={stageTopY} width={stage.size[0]} />
    </group>
  );
}

function FrontBackTrim({
  y,
  width,
}: {
  readonly y: number;
  readonly width: number;
}) {
  const trimThickness = ARENA_LAYOUT.stage.trimThickness;
  const trimDepth = ARENA_LAYOUT.stage.size[2];
  return (
    <group>
      <mesh position={[0, y, trimDepth / 2 + trimThickness / 2]}>
        <boxGeometry args={[width + trimThickness * 2, trimThickness, trimThickness]} />
        <meshStandardMaterial
          color={PALETTE.honeyLight}
          roughness={0.5}
          metalness={0.55}
          emissive={PALETTE.honeyDeep}
          emissiveIntensity={0.18}
        />
      </mesh>
      <mesh position={[0, y, -trimDepth / 2 - trimThickness / 2]}>
        <boxGeometry args={[width + trimThickness * 2, trimThickness, trimThickness]} />
        <meshStandardMaterial
          color={PALETTE.honeyLight}
          roughness={0.5}
          metalness={0.55}
          emissive={PALETTE.honeyDeep}
          emissiveIntensity={0.18}
        />
      </mesh>
    </group>
  );
}

/**
 * A simple curved back-wall — the curved cyclorama that wraps the stage.
 * Half-cylinder oriented around the vertical Y axis, concave toward the
 * audience, painted cream so the dark set pieces read against it.
 *
 * Geometry: a half-cylinder centered at the cyclorama position. The visible
 * inner surface uses BackSide so the audience-facing side is what renders.
 */
export function ArenaCyclorama() {
  const { cycloramaPosition, cycloramaRadius, cycloramaSegments, height } =
    ARENA_LAYOUT.walls;
  const halfCirc = Math.PI; // half-cylinder
  const startAngle = -Math.PI / 2; // start at the right, sweep to the left

  return (
    <mesh
      position={[
        cycloramaPosition[0],
        height / 2,
        cycloramaPosition[2] + cycloramaRadius * 0.1,
      ]}
      rotation-y={Math.PI}
      receiveShadow
    >
      <cylinderGeometry
        args={[
          cycloramaRadius,
          cycloramaRadius,
          height,
          cycloramaSegments,
          1,
          true,
          startAngle,
          halfCirc,
        ]}
      />
      <meshStandardMaterial
        color={PALETTE.cream}
        side={THREE.BackSide}
        roughness={0.92}
        metalness={0.0}
      />
    </mesh>
  );
}

/**
 * Two side walls (left + right) flanking the arena. Static colliders keep
 * props from leaking out into the void if launched sideways.
 */
export function ArenaWalls() {
  const { leftPosition, rightPosition, height, thickness, span } =
    ARENA_LAYOUT.walls;

  return (
    <group>
      {[leftPosition, rightPosition].map((pos, idx) => (
        <RigidBody key={idx} type="fixed" colliders={false}>
          <CuboidCollider
            args={[thickness / 2, height / 2, span / 2]}
            position={pos}
          />
          <mesh position={pos} castShadow receiveShadow>
            <boxGeometry args={[thickness, height, span]} />
            <meshStandardMaterial
              color={PALETTE.walnutDeep}
              roughness={0.85}
              metalness={0.0}
            />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
}

/**
 * Ceiling truss suggestion — a thin dark lattice frame across the top, lit
 * with subtle warm emissive accents to imply theatrical rigging. Fixed
 * collider so props never escape through the top.
 */
export function ArenaTruss() {
  const { position, size, barCount } = ARENA_LAYOUT.truss;
  const barSpacing = size[0] / barCount;

  return (
    <group>
      {/* Main horizontal beam */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[size[0] / 2, size[1] / 2, size[2] / 2]}
          position={position}
        />
        <mesh position={position} castShadow>
          <boxGeometry args={size} />
          <meshStandardMaterial
            color={PALETTE.walnutBlackened}
            roughness={0.6}
            metalness={0.3}
          />
        </mesh>
      </RigidBody>

      {/* Crossbars */}
      {Array.from({ length: barCount - 1 }, (_, i) => {
        const x = -size[0] / 2 + barSpacing * (i + 1);
        return (
          <mesh
            key={`bar-${i}`}
            position={[x, position[1] - size[1] / 2 - 0.08, position[2]]}
            castShadow
          >
            <boxGeometry args={[0.04, 0.16, size[2] * 1.4]} />
            <meshStandardMaterial
              color={PALETTE.walnutShadow}
              roughness={0.5}
              metalness={0.4}
            />
          </mesh>
        );
      })}

      {/* Warm "fixture" accents — small boxes that read as hanging lights. */}
      {Array.from({ length: 5 }, (_, i) => {
        const x = (-size[0] / 2) + (size[0] / 4) * i;
        return (
          <mesh
            key={`fixture-${i}`}
            position={[x, position[1] - size[1] / 2 - 0.18, position[2]]}
          >
            <boxGeometry args={[0.18, 0.18, 0.18]} />
            <meshStandardMaterial
              color={PALETTE.honeyLight}
              emissive={PALETTE.honeyGlow}
              emissiveIntensity={1.6}
              roughness={0.4}
            />
          </mesh>
        );
      })}
    </group>
  );
}
