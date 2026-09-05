"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import {
  CAMERA_PRESETS,
  presetForMode,
  type CameraPreset,
} from "./camera-presets";
import type { ArenaOrbitCameraHandle } from "./arena-orbit-camera";
import type { SceneSignal } from "./scene-signal";

/**
 * Camera director — owns the spectator camera during cinematic cuts.
 *
 * Listens to the active scene signal; whenever the camera/mode mapping
 * changes the director claims control from OrbitControls, lerps
 * `camera.position` + the OrbitControls `target` toward the new preset over
 * `holdMs`, then hands back to the user. Reduced motion collapses the lerp
 * to an instant target snap (no continuous animation).
 *
 * The director lives inside the Canvas tree so it can reach
 * `useThree()`'s camera + the forwarded OrbitControls handle.
 *
 * Reduced-motion control: when `signal.reducedMotion` is true the lerp
 * snaps instantly (no easing) — the OrbitControls' damping never fires.
 *
 * Note on the lint rule disabling below: the per-frame mutation of the
 * camera + OrbitControls is the *documented* R3F + Three.js API to drive
 * the camera each tick. React's hook-immutability rule is intended for
 * re-render concerns and does not apply to R3F's render-loop callbacks.
 */
/* eslint-disable react-hooks/immutability -- see CameraDirector doc comment. */
interface CameraDirectorProps {
  readonly signal: SceneSignal | undefined;
  readonly orbitRef: React.MutableRefObject<ArenaOrbitCameraHandle | null>;
}

export function CameraDirector({ signal, orbitRef }: CameraDirectorProps) {
  const { camera, controls } = useThree();
  const stateRef = useRef<{
    targetPreset: CameraPreset;
    currentPreset: CameraPreset;
    startedAt: number;
    lastSignal: SceneSignal | undefined;
  }>({
    targetPreset: CAMERA_PRESETS.idle,
    currentPreset: CAMERA_PRESETS.idle,
    startedAt: 0,
    lastSignal: undefined,
  });

  // Initialize camera + OrbitControls to the idle preset on first mount.
  useEffect(() => {
    const preset = CAMERA_PRESETS.idle;
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(preset.position[0], preset.position[1], preset.position[2]);
    cam.lookAt(preset.target[0], preset.target[1], preset.target[2]);
    const orbit = (orbitRef.current ?? controls) as OrbitControlsImpl | null;
    if (orbit && "target" in orbit) {
      orbit.target.set(preset.target[0], preset.target[1], preset.target[2]);
      orbit.update?.();
    }
    stateRef.current.currentPreset = preset;
    stateRef.current.targetPreset = preset;
    stateRef.current.lastSignal = undefined;
    stateRef.current.startedAt = performance.now();
  }, [camera, controls, orbitRef]);

  // When the signal updates, claim a fresh target preset.
  useEffect(() => {
    if (!signal) return;
    if (signal === stateRef.current.lastSignal) return;

    const presetKey = presetForMode(signal.mode, signal.camera);
    const nextPreset = CAMERA_PRESETS[presetKey];

    stateRef.current.lastSignal = signal;
    stateRef.current.targetPreset = nextPreset;
    stateRef.current.startedAt = performance.now();
  }, [signal]);

  useFrame(() => {
    const { targetPreset, lastSignal } = stateRef.current;
    if (!lastSignal) return; // nothing to do before first signal

    const reducedMotion = lastSignal.reducedMotion;
    const elapsedMs = performance.now() - stateRef.current.startedAt;
    const durationMs = targetPreset.holdMs;
    const t = Math.max(0, Math.min(1, elapsedMs / durationMs));
    const eased = reducedMotion ? 1 : easeInOut(t);

    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(
      lerp(stateRef.current.currentPreset.position[0], targetPreset.position[0], eased),
      lerp(stateRef.current.currentPreset.position[1], targetPreset.position[1], eased),
      lerp(stateRef.current.currentPreset.position[2], targetPreset.position[2], eased),
    );

    const orbit = (orbitRef.current ?? controls) as OrbitControlsImpl | null;
    if (orbit && "target" in orbit) {
      orbit.target.set(
        lerp(stateRef.current.currentPreset.target[0], targetPreset.target[0], eased),
        lerp(stateRef.current.currentPreset.target[1], targetPreset.target[1], eased),
        lerp(stateRef.current.currentPreset.target[2], targetPreset.target[2], eased),
      );
      orbit.update?.();
    }

    // FOV interpolation lives on the camera object itself.
    const targetFov = targetPreset.fov;
    if (Math.abs(cam.fov - targetFov) > 0.01) {
      cam.fov = lerp(stateRef.current.currentPreset.fov, targetFov, eased);
      cam.updateProjectionMatrix();
    }

    // Disable orbit during the cut; re-enable once we hit the destination.
    if (orbit && "enabled" in orbit) {
      const shouldHold = t < 1 && !reducedMotion;
      orbit.enabled = !shouldHold;
    }

    // When the tween completes, freeze the "current preset" so subsequent
    // state changes start the next interpolation from there.
    if (t >= 1) {
      stateRef.current.currentPreset = targetPreset;
    }
  });

  return null;
}

function easeInOut(t: number): number {
  // Cubic ease-in-out — matches the OrbitControls damping feel.
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
