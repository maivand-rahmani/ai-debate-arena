/**
 * Confetti pool preset for the verdict reveal.
 *
 * The scene tree pre-instantiates a fixed pool of confetti rigid bodies
 * (single geometry, physics-driven). On a verdict event the
 * {@link ConfettiPool} walks the pool, poses-and-releases a subset over the
 * winner side, then lets Rapier settle them. Once a body has been at rest
 * for `settleAfterMs` the pool hides it (so the pool size stays bounded
 * and we never accumulate debris).
 *
 * This module is pure: it produces initial transforms + impulses. The
 * rendering side applies them onto a real Rapier body.
 */

import { PALETTE } from "./colors";
import type { Vec3 } from "./scene-layout";

export interface ConfettiColor {
  readonly color: string;
  readonly weight: number;
}

export const VERDICT_CONFETTI_COLORS: readonly ConfettiColor[] = [
  { color: PALETTE.terracotta, weight: 0.25 },
  { color: PALETTE.terracottaLight, weight: 0.12 },
  { color: PALETTE.honey, weight: 0.18 },
  { color: PALETTE.honeyLight, weight: 0.10 },
  { color: PALETTE.plum, weight: 0.10 },
  { color: PALETTE.cream, weight: 0.15 },
  { color: PALETTE.plumLight, weight: 0.10 },
];

export const CONFETTI_POOL_SIZE = 28;
export const CONFETTI_BURST_COUNT = 24;

export const CONFETTI_DEFAULT_SIZE: Vec3 = [0.07, 0.018, 0.07];

export interface ConfettiSpawn {
  readonly index: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly angularVelocity: Vec3;
  readonly color: string;
  readonly rotationEuler: Vec3;
}

/**
 * Pick a color from the weighted palette.
 */
export function pickConfettiColor(seed: number): string {
  const palette = VERDICT_CONFETTI_COLORS;
  const totalWeight = palette.reduce((acc, c) => acc + c.weight, 0);
  const target = ((seed % 1000) / 1000) * totalWeight;
  let cursor = 0;
  for (const entry of palette) {
    cursor += entry.weight;
    if (target <= cursor) return entry.color;
  }
  return palette[palette.length - 1].color;
}

/**
 * Build the burst spawn list for a given winner side ("A" | "B" | "DRAW").
 * Deterministic for a given seed so tests can pin a layout; the live scene
 * uses a fresh `Math.random` call when triggering.
 *
 * Origin sits over the winner's desk (or the judge's platform for a draw),
 * with a 1.5 m vertical lift so confetti visibly rains down. Initial
 * velocities fan outward at ~20-50° with modest upward kick (impulse feel).
 */
export function planConfettiBurst(
  winner: "A" | "B" | "DRAW",
  seed: number,
  count: number = CONFETTI_BURST_COUNT,
): readonly ConfettiSpawn[] {
  const xs: Record<typeof winner, number> = {
    A: -4.5,
    B: 4.5,
    DRAW: 0,
  };
  const centerX = xs[winner];
  const spawns: ConfettiSpawn[] = [];

  // Use a small deterministic-ish RNG so test fixture stays stable.
  let s = (seed * 2654435761) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + ((i - count / 2) / Math.max(1, count)) * Math.PI * 0.6;
    const upwardKick = 3.4 + rand() * 1.4;
    const outward = 1.6 + rand() * 1.2;
    const sideX = Math.cos(angle) * outward;
    const sideZ = Math.sin(angle) * outward;
    const position: Vec3 = [
      centerX + (rand() - 0.5) * 0.6,
      3.0 + rand() * 0.6,
      -1.6 + (rand() - 0.5) * 0.8,
    ];
    const velocity: Vec3 = [
      centerX === 0 ? sideX : (sideX + (centerX > 0 ? -outward * 0.4 : outward * 0.4)) * 0.5,
      upwardKick,
      sideZ,
    ];
    const angularVelocity: Vec3 = [
      (rand() - 0.5) * 6,
      (rand() - 0.5) * 6,
      (rand() - 0.5) * 6,
    ];
    spawns.push({
      index: i,
      position,
      velocity,
      angularVelocity,
      color: pickConfettiColor(i + seed),
      rotationEuler: [rand() * Math.PI, rand() * Math.PI, rand() * Math.PI],
    });
  }
  return spawns;
}

/**
 * Frame schedule for the verdict strike moment. Concrete: camera is
 * already cut to the verdict preset (camera-presets.ts). The first cue is
 * a downward impulse on the gavel at T=0; the confetti burst triggers
 * shortly after so the gavel lands, then the pieces fly.
 */
export const VERDICT_TIMING = {
  /** ms after verdict lands to apply the gavel strike impulse. */
  gavelStrikeMs: 120,
  /** ms after verdict lands to release the confetti burst. */
  confettiTriggerMs: 340,
  /** ms after which idle confetti pieces are hidden. */
  confettiSettleMs: 4500,
} as const;
