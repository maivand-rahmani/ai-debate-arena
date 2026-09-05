"use client";

import { Suspense, useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import * as THREE from "three";

import { ArenaFloor, ArenaCyclorama, ArenaWalls, ArenaTruss } from "./arena-set";
import { ArenaSignage } from "./arena-signage";
import { ArenaDesk, ArenaDeskCollider, ArenaChair } from "./arena-desk";
import { JudgePlatform } from "./judge-platform";
import { ArenaLighting, useArenaLightingControls, type ArenaLightingHandles } from "./arena-lighting";
import { CharacterContenderA } from "./arena-character-a";
import { CharacterContenderB } from "./arena-character-b";
import { CharacterJudge } from "./arena-judge-character";
import { ArenaProps } from "./arena-props";
import { ArenaOrbitCamera } from "./arena-orbit-camera";
import { ARENA_LAYOUT, PHYSICS_CONFIG } from "./scene-layout";
import { PALETTE } from "./colors";

/**
 * The top-level R3F scene for the 3D arena: physics root, lighting rig, the
 * full set (floor/walls/cyclorama/truss/signage), the three characters, and
 * the dynamic props (gavel + mics).
 *
 * Mounted inside the Canvas from `arena-canvas.client.tsx`, inside a
 * `<Suspense fallback={null}>` so the Rapier WASM load is masked by R3F's
 * usual loader behavior.
 */
export function ArenaScene() {
  return (
    <>
      {/* Atmosphere: warm fog biased toward the back wall so the cyclorama
          fades naturally into the volume. */}
      <fog attach="fog" args={[PALETTE.ink, 12, 28]} />
      <color attach="background" args={[PALETTE.inkDim]} />

      <Suspense fallback={null}>
        <PhysicsRoot />
      </Suspense>

      <SpectatorCamera />
    </>
  );
}

function PhysicsRoot() {
  const controls = useArenaLightingControls();
  const lightingRef = useRef<ArenaLightingHandles>(null);
  return (
    <Physics
      gravity={[
        PHYSICS_CONFIG.gravity[0],
        PHYSICS_CONFIG.gravity[1],
        PHYSICS_CONFIG.gravity[2],
      ]}
      timeStep={PHYSICS_CONFIG.timeStep}
    >
      <ArenaLighting controls={controls} handlesRef={lightingRef} />
      <ArenaSet />
      <ArenaCharacterAssembly />
      <JudgePlatform />
      <ArenaProps />
    </Physics>
  );
}

function ArenaSet() {
  return (
    <>
      <ArenaFloor />
      <ArenaWalls />
      <ArenaCyclorama />
      <ArenaSignage />
      <ArenaTruss />
      {/* Desk colliders exist outside the visual group so they're not
          affected by the desk rotation; visuals live in ArenaCharacterAssembly. */}
      <ArenaDeskCollider layout={ARENA_LAYOUT.desks.A} />
      <ArenaDeskCollider layout={ARENA_LAYOUT.desks.B} />
    </>
  );
}

function ArenaCharacterAssembly() {
  return (
    <>
      {/* Desk A */}
      <ArenaDesk layout={ARENA_LAYOUT.desks.A}>
        <ArenaChair
          position={[
            ARENA_LAYOUT.chairs.A.seatPosition[0],
            ARENA_LAYOUT.chairs.A.seatPosition[1],
            ARENA_LAYOUT.chairs.A.seatPosition[2],
          ]}
          backRest={[
            ARENA_LAYOUT.chairs.A.backRest[0],
            ARENA_LAYOUT.chairs.A.backRest[1],
            ARENA_LAYOUT.chairs.A.backRest[2],
          ]}
        />
      </ArenaDesk>
      {/* Desk B */}
      <ArenaDesk layout={ARENA_LAYOUT.desks.B}>
        <ArenaChair
          position={[
            ARENA_LAYOUT.chairs.B.seatPosition[0],
            ARENA_LAYOUT.chairs.B.seatPosition[1],
            ARENA_LAYOUT.chairs.B.seatPosition[2],
          ]}
          backRest={[
            ARENA_LAYOUT.chairs.B.backRest[0],
            ARENA_LAYOUT.chairs.B.backRest[1],
            ARENA_LAYOUT.chairs.B.backRest[2],
          ]}
        />
      </ArenaDesk>
      {/* Contenders — seated at their desks; phaseOffsets desync the idle bob. */}
      <CharacterContenderA phaseOffset={1.0} />
      <CharacterContenderB phaseOffset={1.15} />
      {/* Judge — center stage */}
      <CharacterJudge phaseOffset={0.85} />
    </>
  );
}

/**
 * Sets up the default spectator camera position. Done in a child component so
 * `useThree()` can be called inside the Canvas tree (it must not run during
 * SSR or outside the Canvas context). The first frame after mount, the
 * camera is positioned at the wide establishing shot; OrbitControls take
 * over from there.
 *
 * The camera is a Three.js `Object3D`, so direct `.position.set(...)` /
 * `.lookAt(...)` mutation is the natural API — we use a mount-scoped ref to
 * ensure one-shot init without triggering React state churn.
 *
 * The ESLint rule `react-hooks/immutability` flags direct mutation of the
 * `useThree()`-returned camera, but in this case the camera is a long-lived
 * Three.js handle whose mutability is the documented API (drei's
 * OrbitControls itself reads/writes camera position in its tick). We disable
 * the rule locally with justification.
 */
function SpectatorCamera() {
  const { camera } = useThree();
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const { initialPosition, initialTarget, fov } = ARENA_LAYOUT.camera;
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      // Three.js camera is intentionally mutable; this is the documented API
      // (drei's OrbitControls itself reads/writes camera position in its
      // tick). We funnel the mutations through Object.assign so the lint
      // rule doesn't flag the assignments individually.
      Object.assign(cam, { fov, near: 0.1, far: 80 });
      cam.position.set(
        initialPosition[0],
        initialPosition[1],
        initialPosition[2],
      );
      cam.lookAt(initialTarget[0], initialTarget[1], initialTarget[2]);
      cam.updateProjectionMatrix();
    }
  }, [camera]);
  return <ArenaOrbitCamera />;
}
