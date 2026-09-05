"use client";

import { useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { PALETTE } from "./colors";
import {
  ARENA_LAYOUT,
  LIGHTING_DEFAULTS,
  LIGHTING_INTENSITY_DEFAULTS,
  type LightKey,
} from "./scene-layout";

/**
 * Per-light intensity handle. Phase C can call `controls.set("key", 1.4)`
 * from a useEffect to drive the rig from debate state — values persist
 * across frames via the mutable ref and the useFrame inside
 * {@link ArenaLighting} writes them to the actual Three.js lights.
 */
export interface ArenaLightingControls {
  /** Mutate a single light's target intensity. */
  set(key: LightKey, value: number): void;
  /** Snapshot of the current values. */
  readonly values: Readonly<Record<LightKey, number>>;
}

/**
 * Light handle types — references the relevant Three.js light objects the
 * rig owns. Phase C may use these directly if needed (e.g. for color tweens).
 */
export interface ArenaLightingHandles {
  readonly ambient: THREE.AmbientLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  readonly spotA: THREE.SpotLight;
  readonly spotB: THREE.SpotLight;
  readonly spotJudge: THREE.SpotLight;
  readonly rimHoneylight: THREE.PointLight;
}

/**
 * Create a shared mutable intensity map. Mount this near the root of the
 * arena tree (e.g. in `arena-canvas.client.tsx`) so children can pull
 * intensity targets out of it via context. Phase C will mutate `current`
 * entries from debate state changes.
 */
export function useArenaLightingControls(): ArenaLightingControls {
  const values = useRef<Record<LightKey, number>>({ ...LIGHTING_INTENSITY_DEFAULTS });
  return useMemo<ArenaLightingControls>(
    () => ({
      set(key, value) {
        values.current[key] = value;
      },
      get values() {
        return values.current;
      },
    }),
    [],
  );
}

/**
 * The lighting rig itself — a static layout of:
 *   - warm ambient (cream tint)
 *   - hemisphere (sky=honey, ground=walnut)
 *   - directional KEY with soft shadows (the studio key light)
 *   - colored spots aimed at each desk (terracotta/plum)
 *   - honey spot aimed at the judge
 *   - a small honey "rim" point light for the judge's hair
 *
 * Each `useFrame` call copies the mutable intensity targets into the actual
 * Three.js light intensities. Refs are exposed via the `handlesRef` prop so
 * callers (or Phase C) can read or override individual lights by direct
 * mutation without touching the controls API.
 */
export function ArenaLighting({
  controls,
  handlesRef,
}: {
  readonly controls: ArenaLightingControls;
  readonly handlesRef?: Ref<ArenaLightingHandles>;
}) {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemisphereRef = useRef<THREE.HemisphereLight>(null);
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const spotARef = useRef<THREE.SpotLight>(null);
  const spotBRef = useRef<THREE.SpotLight>(null);
  const spotJudgeRef = useRef<THREE.SpotLight>(null);
  const rimHoneylightRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    if (ambientRef.current) ambientRef.current.intensity = controls.values.ambient;
    if (hemisphereRef.current) hemisphereRef.current.intensity = controls.values.hemisphere;
    if (keyRef.current) keyRef.current.intensity = controls.values.key;
    if (spotARef.current) spotARef.current.intensity = controls.values.spotA;
    if (spotBRef.current) spotBRef.current.intensity = controls.values.spotB;
    if (spotJudgeRef.current) spotJudgeRef.current.intensity = controls.values.spotJudge;
    if (rimHoneylightRef.current) rimHoneylightRef.current.intensity = controls.values.rimHoneylight;
  });

  useImperativeHandle(
    handlesRef,
    () => {
      const ensure = <T,>(value: T | null): T => {
        if (value == null) throw new Error("Lighting handles not yet mounted");
        return value;
      };
      return {
        get ambient() {
          return ensure(ambientRef.current);
        },
        get hemisphere() {
          return ensure(hemisphereRef.current);
        },
        get key() {
          return ensure(keyRef.current);
        },
        get spotA() {
          return ensure(spotARef.current);
        },
        get spotB() {
          return ensure(spotBRef.current);
        },
        get spotJudge() {
          return ensure(spotJudgeRef.current);
        },
        get rimHoneylight() {
          return ensure(rimHoneylightRef.current);
        },
      };
    },
    [],
  );

  return (
    <group>
      <ambientLight
        ref={ambientRef}
        intensity={LIGHTING_DEFAULTS.ambient}
        color={PALETTE.creamWarm}
      />
      <hemisphereLight
        ref={hemisphereRef}
        args={[
          LIGHTING_DEFAULTS.hemisphereSky,
          LIGHTING_DEFAULTS.hemisphereGround,
          LIGHTING_DEFAULTS.hemisphere,
        ]}
      />
      {/* Directional KEY with soft shadows — only the key light casts shadows
          so we keep the shadow budget small. */}
      <directionalLight
        ref={keyRef}
        intensity={LIGHTING_DEFAULTS.key}
        color={LIGHTING_DEFAULTS.keyColor}
        position={[5, 8, 7]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0008}
      />

      {/* Terracotta spotlight aimed at desk A — warm-corner key. */}
      <spotLight
        ref={spotARef}
        intensity={LIGHTING_DEFAULTS.spotA}
        color={PALETTE.terracottaLight}
        position={[ARENA_LAYOUT.desks.A.position[0], 5, ARENA_LAYOUT.desks.A.position[2] + 4]}
        target-position={[
          ARENA_LAYOUT.desks.A.position[0],
          ARENA_LAYOUT.desks.A.position[1],
          ARENA_LAYOUT.desks.A.position[2],
        ]}
        angle={0.6}
        penumbra={0.6}
        decay={1.6}
        distance={9}
      />

      {/* Plum spotlight aimed at desk B. */}
      <spotLight
        ref={spotBRef}
        intensity={LIGHTING_DEFAULTS.spotB}
        color={PALETTE.plumLight}
        position={[ARENA_LAYOUT.desks.B.position[0], 5, ARENA_LAYOUT.desks.B.position[2] + 4]}
        target-position={[
          ARENA_LAYOUT.desks.B.position[0],
          ARENA_LAYOUT.desks.B.position[1],
          ARENA_LAYOUT.desks.B.position[2],
        ]}
        angle={0.6}
        penumbra={0.6}
        decay={1.6}
        distance={9}
      />

      {/* Honey key spot aimed at the judge from slightly above. */}
      <spotLight
        ref={spotJudgeRef}
        intensity={LIGHTING_DEFAULTS.spotJudge}
        color={PALETTE.honeyLight}
        position={[0, 6, 1]}
        target-position={[
          ARENA_LAYOUT.judge.platformPosition[0],
          ARENA_LAYOUT.judge.platformPosition[1] + ARENA_LAYOUT.judge.platformSize[1] / 2 + 1.5,
          ARENA_LAYOUT.judge.platformPosition[2],
        ]}
        angle={0.55}
        penumbra={0.5}
        decay={1.5}
        distance={11}
        castShadow={false}
      />

      {/* Honey rim for the judge — a small point light just behind/above the
          judge character for hair/rim shading. */}
      <pointLight
        ref={rimHoneylightRef}
        intensity={LIGHTING_DEFAULTS.rimHoneylight}
        color={PALETTE.honeyGlow}
        position={[
          ARENA_LAYOUT.judge.platformPosition[0],
          ARENA_LAYOUT.judge.platformPosition[1] + 2.6,
          ARENA_LAYOUT.judge.platformPosition[2] - 1.5,
        ]}
        distance={5}
        decay={2}
      />
    </group>
  );
}
