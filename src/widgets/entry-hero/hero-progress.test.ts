import { describe, expect, it } from "vitest";
import { clampHeroProgress, projectHeroScene } from "./hero-progress";
import { projectIntroOverlay } from "./hero-progress";

describe("hero progress projection", () => {
  it("clamps hostile or non-finite scroll values", () => {
    expect(clampHeroProgress(-2)).toBe(0);
    expect(clampHeroProgress(2)).toBe(1);
    expect(clampHeroProgress(Number.NaN)).toBe(0);
  });

  it("dissolves the title before revealing the product HUD", () => {
    const start = projectHeroScene(0, false);
    const end = projectHeroScene(1, true);
    expect(start.titleOpacity).toBe(1);
    expect(start.hudOpacity).toBe(0);
    expect(end.titleOpacity).toBe(0);
    expect(end.hudOpacity).toBe(1);
    expect(end.cameraLift).toBe(0);
  });

  it("hides the enter hint as soon as the user scrolls and never brings it back", () => {
    const resting = projectHeroScene(0, false);
    const hintThreshold = projectHeroScene(0.013, true);
    const later = projectHeroScene(0.75, true);
    const backUp = projectHeroScene(0.001, true);
    expect(resting.enterHintOpacity).toBe(1);
    expect(hintThreshold.enterHintOpacity).toBe(0);
    expect(later.enterHintOpacity).toBe(0);
    expect(backUp.enterHintOpacity).toBe(0);
  });
});

describe("projectIntroOverlay", () => {
  it("starts black with the title hidden before its reveal window", () => {
    const overlay = projectIntroOverlay(0, undefined, false);
    expect(overlay.overlayOpacity).toBe(1);
    expect(overlay.titleRevealOpacity).toBeLessThan(0.7);
  });

  it("dissolves the overlay after the canvas signals ready", () => {
    const overlay = projectIntroOverlay(2500, 1700, false);
    expect(overlay.overlayOpacity).toBe(0);
  });

  it("respects the sanity cap when the canvas never reports ready", () => {
    const overlay = projectIntroOverlay(2600, undefined, false);
    expect(overlay.overlayOpacity).toBe(0);
  });

  it("snaps to the settled state for reduced motion", () => {
    expect(projectIntroOverlay(0, undefined, true)).toEqual({
      overlayOpacity: 1,
      titleRevealOpacity: 1,
    });
  });

  it("progresses when canvasReadyAtMs is a large absolute timestamp (time-base mismatch guard)", () => {
    // Repro: the old implementation accepted a large absolute
    // performance.now() value for `canvasReadyAtMs`, making the title
    // appear stuck at the floor until the sanity cap path. The unified
    // time base (elapsed-since-mount) makes the title reach its full
    // reveal by elapsed = canvasReady + TITLE_REVEAL_MS regardless of how
    // large the canvas-ready timestamp itself is.
    const readyAbsolute = 9999; // large absolute value, no relation to elapsed
    const overlay = projectIntroOverlay(1100, readyAbsolute, false);
    // Title should reach its full cubic-ease value (≈1) once 1100ms of
    // title reveal have elapsed beyond whatever the start marker says.
    expect(overlay.titleRevealOpacity).toBeGreaterThan(0.95);
  });
});
