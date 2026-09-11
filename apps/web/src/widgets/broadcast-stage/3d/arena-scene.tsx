"use client";

import { Suspense, useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import * as THREE from "three";

import { ArenaFloor, ArenaCyclorama, ArenaWalls, ArenaTruss } from "./arena-set";
import { ArenaSignage } from "./arena-signage";
import { ArenaDesk, ArenaDeskCollider, ArenaChair } from "./arena-desk";
import { JudgePlatform } from "./judge-platform";
import { MonitorStation } from "./monitor-station";
import {
  ArenaLighting,
  useArenaLightingControls,
  type ArenaLightingHandles,
} from "./arena-lighting";
import { CharacterContenderA } from "./arena-character-a";
import { CharacterContenderB } from "./arena-character-b";
import { CharacterJudge } from "./arena-judge-character";
import { ArenaProps, type VerdictPropHandles } from "./arena-props";
import {
  ArenaOrbitCamera,
  type ArenaOrbitCameraHandle,
} from "./arena-orbit-camera";
import { CameraDirector } from "./camera-director";
import { LightingDirector } from "./lighting-director";
import { VerdictDirector } from "./verdict-director";
import { ARENA_LAYOUT, PHYSICS_CONFIG } from "./scene-layout";
import { PALETTE } from "./colors";
import type { SceneSignal } from "./scene-signal";

/**
 * The top-level R3F scene for the 3D arena: physics root, lighting rig, the
 * full set (floor/walls/cyclorama/truss/signage), the three characters,
 * dynamic props, the camera + lighting + verdict directors, and the
 * spectator OrbitControls.
 *
 * Mounted inside the Canvas from `arena-canvas.client.tsx`, inside a
 * `<Suspense fallback={null}>` so the Rapier WASM load is masked by R3F's
 * usual loader behavior.
 */
interface ArenaSceneProps {
  readonly signal?: SceneSignal | undefined;
}

export function ArenaScene({ signal }: ArenaSceneProps) {
  const { color, near, far } = ARENA_LAYOUT.fog;
  return (
    <>
      <fog attach="fog" args={[color, near, far]} />
      <color attach="background" args={[PALETTE.inkDim]} />

      <Suspense fallback={null}>
        <World signal={signal} />
      </Suspense>
    </>
  );
}

/**
 * The world composer: physics + characters + props + spectators. Owns the
 * cross-cutting refs (lighting handles, orbit handle, verdict prop handles)
 * in one place so directors and trees can find each other without prop
 * drilling or window-singleton trickery.
 */
function World({ signal }: ArenaSceneProps) {
  const controls = useArenaLightingControls();
  const lightingRef = useRef<ArenaLightingHandles>(null);
  const orbitRef = useRef<ArenaOrbitCameraHandle | null>(null);
  const verdictHandlesRef = useRef<VerdictPropHandles>({
    gavel: null,
    confetti: null,
  });

  return (
    <>
      <Physics
        gravity={[
          PHYSICS_CONFIG.gravity[0],
          PHYSICS_CONFIG.gravity[1],
          PHYSICS_CONFIG.gravity[2],
        ]}
        timeStep={PHYSICS_CONFIG.timeStep}
      >
        <ArenaLighting controls={controls} handlesRef={lightingRef} />
        <LightingDirector signal={signal} controls={controls} />
        <ArenaSet />
        <ArenaCharacterAssembly signal={signal} />
        <JudgePlatform />
        <ArenaProps handlesRef={verdictHandlesRef} />
        <VerdictDirector signal={signal} handlesRef={verdictHandlesRef} />
      </Physics>

      <SpectatorCamera orbitRef={orbitRef} signal={signal} />
      <CameraDirector signal={signal} orbitRef={orbitRef} />
    </>
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
      <ArenaDeskCollider layout={ARENA_LAYOUT.desks.A} />
      <ArenaDeskCollider layout={ARENA_LAYOUT.desks.B} />
    </>
  );
}

interface CharacterSignal {
  readonly signal?: SceneSignal | undefined;
}

function ArenaCharacterAssembly({ signal }: CharacterSignal) {
  const chairA = ARENA_LAYOUT.chairs.A;
  const chairB = ARENA_LAYOUT.chairs.B;
  const judgeChair = ARENA_LAYOUT.judge;
  const platformTopY =
    ARENA_LAYOUT.judge.platformPosition[1] +
    ARENA_LAYOUT.judge.platformSize[1] / 2;
  return (
    <>
      <ArenaDesk layout={ARENA_LAYOUT.desks.A}>
        <ArenaChair
          position={[0, chairA.seatPosition[1], chairA.seatPosition[2] - ARENA_LAYOUT.desks.A.position[2]]}
          backRest={[chairA.backRest[0], chairA.backRest[1], chairA.backRest[2]]}
        />
      </ArenaDesk>
      <ArenaDesk layout={ARENA_LAYOUT.desks.B}>
        <ArenaChair
          position={[0, chairB.seatPosition[1], chairB.seatPosition[2] - ARENA_LAYOUT.desks.B.position[2]]}
          backRest={[chairB.backRest[0], chairB.backRest[1], chairB.backRest[2]]}
        />
      </ArenaDesk>
      {/* Workstation monitors — sit centered on each desk in front of the
          talent so the contender reads as "at their computer". */}
      <MonitorStation layout={ARENA_LAYOUT.monitors.A} />
      <MonitorStation layout={ARENA_LAYOUT.monitors.B} />
      {/* Judge's throne — sits behind the character on top of the raised
          platform. `floorY` stops the legs at the platform top instead of
          the world floor; the accent color paints the honey crest on the
          backrest so the throne reads as a proper magistrate chair. */}
      <ArenaChair
        position={[
          judgeChair.chairSeatPosition[0],
          judgeChair.chairSeatPosition[1],
          judgeChair.chairSeatPosition[2],
        ]}
        backRest={[
          judgeChair.chairBackRest[0],
          judgeChair.chairBackRest[1],
          judgeChair.chairBackRest[2],
        ]}
        floorY={platformTopY}
        accentColor={PALETTE.honeyGlow}
      />
      <CharacterContenderA phaseOffset={1.0} mood={signal?.moods.a} />
      <CharacterContenderB phaseOffset={1.15} mood={signal?.moods.b} />
      <CharacterJudge phaseOffset={0.85} mood={signal?.moods.judge} />
    </>
  );
}

/**
 * Sets up the default spectator camera position + mounts the OrbitControls.
 * Forwards the controls handle to the CameraDirector so it can disable +
 * re-enable them during cinematic cuts.
 */
function SpectatorCamera({
  orbitRef,
  signal,
}: {
  orbitRef: React.MutableRefObject<ArenaOrbitCameraHandle | null>;
  signal?: SceneSignal | undefined;
}) {
  const { camera } = useThree();
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const { initialPosition, initialTarget, fov } = ARENA_LAYOUT.camera;
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
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

  return <ArenaOrbitCamera ref={orbitRef} heroProgress={signal?.heroProgress ?? 1} />;
}
