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
  { color: PALETTE.terracotta, weight: 0.20 },
  { color: PALETTE.terracottaLight, weight: 0.10 },
  { color: PALETTE.terracottaGlow, weight: 0.08 },
  { color: PALETTE.honey, weight: 0.14 },
  { color: PALETTE.honeyLight, weight: 0.08 },
  { color: PALETTE.honeyGlow, weight: 0.06 },
  { color: PALETTE.plum, weight: 0.10 },
  { color: PALETTE.plumLight, weight: 0.10 },
  { color: PALETTE.cream, weight: 0.14 },
];

// Twenty cards reads as a deliberate broadcast cue, while keeping the fixed
// Rapier pool small enough that the reveal never competes with the verdict.
export const CONFETTI_POOL_SIZE = 20;
export const CONFETTI_BURST_COUNT = 20;

// A thin, slightly elongated card catches the light more elegantly than the
// old square chip. Rotation is varied per spawn to make the same geometry
// read as a mix of ribbons and cards in flight.
export const CONFETTI_DEFAULT_SIZE: Vec3 = [0.12, 0.018, 0.055];

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
  const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  const normalized = ((normalizedSeed % 1000) + 1000) % 1000;
  const target = (normalized / 1000) * totalWeight;
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

  // Use a small deterministic RNG so the reveal has authored variation while
  // remaining easy to replay and pin in tests.
  let s = (Math.trunc(seed) * 2654435761) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  for (let i = 0; i < count; i++) {
    const progress = count > 1 ? i / (count - 1) : 0.5;
    const fan = progress * 2 - 1;
    const sideBias = winner === "A" ? -0.75 : winner === "B" ? 0.75 : 0;
    const sourceSpread = winner === "DRAW" ? 0 : 0.38;
    // A draw keeps a small, symmetric gap over the judge so the verdict stays
    // legible through the celebration rather than sitting behind a cloud.
    const drawLane =
      winner === "DRAW"
        ? (i % 2 === 0 ? -1 : 1) * (0.18 + rand() * 0.1)
        : 0;
    const upwardKick = 3.15 + rand() * 1.2;
    const horizontalFan = fan * (winner === "DRAW" ? 1.2 : 0.95) + sideBias;
    const position: Vec3 = [
      centerX + drawLane + fan * sourceSpread + (rand() - 0.5) * 0.16,
      2.85 + rand() * 0.45,
      -1.75 + (rand() - 0.5) * 0.5,
    ];
    const velocity: Vec3 = [
      horizontalFan + (rand() - 0.5) * 0.3,
      upwardKick,
      -0.3 + (rand() - 0.5) * 0.45,
    ];
    const angularVelocity: Vec3 = [
      (rand() - 0.5) * 7,
      (rand() - 0.5) * 7,
      (i % 2 === 0 ? -1 : 1) * (2.5 + rand() * 4.5),
    ];
    spawns.push({
      index: i,
      position,
      velocity,
      angularVelocity,
      color: pickConfettiColor(i + seed),
      rotationEuler: [
        (rand() - 0.5) * 0.8,
        rand() * Math.PI * 2,
        (i % 2 === 0 ? -1 : 1) * (0.25 + rand() * 1.1),
      ],
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
