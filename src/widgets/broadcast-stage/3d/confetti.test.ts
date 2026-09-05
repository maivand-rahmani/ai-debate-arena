import { describe, expect, it } from "vitest";
import {
  CONFETTI_BURST_COUNT,
  CONFETTI_POOL_SIZE,
  VERDICT_TIMING,
  pickConfettiColor,
  planConfettiBurst,
} from "./confetti";

describe("CONFETTI constants", () => {
  it("burst count does not exceed pool size", () => {
    expect(CONFETTI_BURST_COUNT).toBeLessThanOrEqual(CONFETTI_POOL_SIZE);
    expect(CONFETTI_BURST_COUNT).toBeGreaterThanOrEqual(20);
    expect(CONFETTI_BURST_COUNT).toBeLessThanOrEqual(30);
  });

  it("verdict timing orders gavel strike before confetti", () => {
    expect(VERDICT_TIMING.gavelStrikeMs).toBeLessThan(
      VERDICT_TIMING.confettiTriggerMs,
    );
  });
});

describe("pickConfettiColor", () => {
  it("always returns a string in the palette", () => {
    for (let i = 0; i < 32; i++) {
      const color = pickConfettiColor(i * 7);
      expect(typeof color).toBe("string");
      expect(color.startsWith("#")).toBe(true);
    }
  });

  it("is deterministic for the same seed", () => {
    expect(pickConfettiColor(123)).toBe(pickConfettiColor(123));
    expect(pickConfettiColor(456)).toBe(pickConfettiColor(456));
    expect(pickConfettiColor(123)).not.toBe(pickConfettiColor(456));
  });
});

describe("planConfettiBurst", () => {
  it("produces the requested number of spawns", () => {
    expect(planConfettiBurst("A", 1, 24)).toHaveLength(24);
    expect(planConfettiBurst("DRAW", 9, 8)).toHaveLength(8);
  });

  it("originates above the winner's desk (left for A, right for B, center for DRAW)", () => {
    const a = planConfettiBurst("A", 1, 4);
    const b = planConfettiBurst("B", 1, 4);
    const d = planConfettiBurst("DRAW", 1, 4);
    for (const s of a) expect(s.position[0]).toBeLessThan(0);
    for (const s of b) expect(s.position[0]).toBeGreaterThan(0);
    for (const s of d) expect(Math.abs(s.position[0])).toBeLessThan(0.5);
  });

  it("every spawn has a meaningful upward velocity (≥2 m/s Y)", () => {
    for (const winner of ["A", "B", "DRAW"] as const) {
      const spawns = planConfettiBurst(winner, 99, 10);
      for (const s of spawns) {
        expect(s.velocity[1]).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("spawns stay inside the arena footprint (lateral spread ≤ 5m)", () => {
    for (const winner of ["A", "B", "DRAW"] as const) {
      const spawns = planConfettiBurst(winner, 99, 24);
      for (const s of spawns) {
        expect(s.position[0]).toBeGreaterThan(-8);
        expect(s.position[0]).toBeLessThan(8);
        expect(s.position[2]).toBeGreaterThan(-5);
        expect(s.position[2]).toBeLessThan(5);
      }
    }
  });

  it("is deterministic for a given seed", () => {
    const a = planConfettiBurst("A", 42, 12);
    const b = planConfettiBurst("A", 42, 12);
    expect(a).toEqual(b);
  });
});
