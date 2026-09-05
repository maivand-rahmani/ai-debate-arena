"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  lightingPresetFor,
  LIGHTING_PRESETS,
  type LightingPreset,
} from "./lighting-presets";
import { LIGHTING_INTENSITY_DEFAULTS, type LightKey } from "./scene-layout";
import type {
  ArenaLightingControls,
} from "./arena-lighting";
import type { SceneSignal } from "./scene-signal";

/**
 * Lighting director — smooth-lerps per-light intensities toward the active
 * preset every frame. The underlying {@link ArenaLighting} component already
 * copies `controls.values.<key>` into the Three.js light each frame; this
 * director sets those targets from the scene signal.
 *
 * Reduced-motion handling: instead of easing each frame, the values jump
 * directly to the target preset so the lighting still tracks state but
 * without flicker/animated transitions.
 */
interface LightingDirectorProps {
  readonly signal: SceneSignal | undefined;
  readonly controls: ArenaLightingControls;
}

export function LightingDirector({ signal, controls }: LightingDirectorProps) {
  // Snapshot the target preset per signal change. The per-frame loop
  // moves `values` toward `currentTarget` so phase crossings can't
  // jitter the rig mid-cut.
  const currentTargetRef = useRef<LightingPreset>(presetFor(LIGHTING_INTENSITY_DEFAULTS_BASELINE));
  const lastSignalRef = useRef<SceneSignal | undefined>(undefined);
  const inFlightRef = useRef<{
    from: Record<LightKey, number>;
    to: Record<LightKey, number>;
    startedAt: number;
    durationMs: number;
  } | null>(null);
  // We feed the controls' mutable values object directly; doing so on every
  // frame would be wasteful for unchanged presets, but a single assignment
  // per frame is a small constant cost we accept (matches the existing
  // ArenaLighting dispatcher).
  useFrame(() => {
    const reducedMotion = lastSignalRef.current?.reducedMotion ?? false;

    const inFlight = inFlightRef.current;
    if (!inFlight) return;

    const elapsedMs = performance.now() - inFlight.startedAt;
    const t = Math.min(1, Math.max(0, elapsedMs / inFlight.durationMs));
    const eased = reducedMotion ? 1 : t;
    for (const key of LIGHTING_KEYS) {
      const value =
        inFlight.from[key] + (inFlight.to[key] - inFlight.from[key]) * eased;
      controls.set(key, value);
    }
    if (t >= 1 || reducedMotion) {
      inFlightRef.current = null;
    }
  });

  useEffect(() => {
    if (!signal) return;
    if (signal === lastSignalRef.current) return;
    lastSignalRef.current = signal;

    const presetKey = lightingPresetFor(signal.mode, signal.camera);
    const next = LIGHTING_PRESETS[presetKey];

    const currentValues: Record<LightKey, number> = {
      ambient: controls.values.ambient,
      hemisphere: controls.values.hemisphere,
      key: controls.values.key,
      spotA: controls.values.spotA,
      spotB: controls.values.spotB,
      spotJudge: controls.values.spotJudge,
      rimHoneylight: controls.values.rimHoneylight,
    };

    currentTargetRef.current = next;
    inFlightRef.current = {
      from: currentValues,
      to: { ...next.intensities },
      startedAt: performance.now(),
      durationMs: signal.reducedMotion ? 1 : 700,
    };
    if (signal.reducedMotion) {
      for (const key of LIGHTING_KEYS) controls.set(key, next.intensities[key]);
      inFlightRef.current = null;
    }
  }, [signal, controls]);

  return null;
}

const LIGHTING_KEYS: LightKey[] = [
  "ambient",
  "hemisphere",
  "key",
  "spotA",
  "spotB",
  "spotJudge",
  "rimHoneylight",
];

const LIGHTING_INTENSITY_DEFAULTS_BASELINE: Readonly<Record<LightKey, number>> =
  LIGHTING_INTENSITY_DEFAULTS;

function presetFor(baseline: Readonly<Record<LightKey, number>>): LightingPreset {
  return {
    intensities: {
      ambient: baseline.ambient,
      hemisphere: baseline.hemisphere,
      key: baseline.key,
      spotA: baseline.spotA,
      spotB: baseline.spotB,
      spotJudge: baseline.spotJudge,
      rimHoneylight: baseline.rimHoneylight,
    },
    label: "baseline",
  };
}
