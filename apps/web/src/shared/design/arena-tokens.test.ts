import { describe, expect, it } from "vitest";
import { ARENA_TOKENS } from "./arena-tokens";

describe("arena design tokens", () => {
  it("keeps the three broadcast identities distinct", () => {
    const { ember, vesper, judge } = ARENA_TOKENS.colors.identity;

    expect(new Set([ember.base, vesper.base, judge.base]).size).toBe(3);
    expect(ember.base).toBe("#EF7F67");
    expect(vesper.base).toBe("#9B8CFF");
    expect(judge.base).toBe("#E4B95B");
  });

  it("keeps alpha values and motion durations within usable ranges", () => {
    expect(Object.values(ARENA_TOKENS.alpha).every((value) => value > 0 && value <= 1)).toBe(true);
    expect(ARENA_TOKENS.motion.cameraMs).toBeGreaterThan(ARENA_TOKENS.motion.revealMs);
    expect(ARENA_TOKENS.shape.cardRadiusPx).toBeGreaterThan(ARENA_TOKENS.shape.softRadiusPx);
  });
});
