import { describe, expect, it } from "vitest";
import {
  CAMERA_PRESETS,
  presetForMode,
  type CameraPreset,
} from "./camera-presets";
import type { StageCamera, StageMode } from "@/widgets/broadcast-stage/stage-state";

describe("CAMERA_PRESETS", () => {
  it("exposes one preset per StageCamera plus a neutral fallback", () => {
    const expectedKeys: (StageCamera | "neutral")[] = [
      "idle",
      "a",
      "b",
      "rebuttal",
      "judge",
      "verdict",
      "neutral",
    ];
    for (const key of expectedKeys) {
      expect(CAMERA_PRESETS[key]).toBeDefined();
    }
  });

  it("each preset has a positive position, finite target, finite FOV, and reasonable hold", () => {
    for (const [key, preset] of Object.entries(CAMERA_PRESETS)) {
      const p = preset as CameraPreset;
      expect(Number.isFinite(p.position[0])).toBe(true);
      expect(Number.isFinite(p.position[1])).toBe(true);
      expect(Number.isFinite(p.position[2])).toBe(true);
      expect(Number.isFinite(p.target[0])).toBe(true);
      expect(Number.isFinite(p.target[1])).toBe(true);
      expect(Number.isFinite(p.target[2])).toBe(true);
      expect(p.fov).toBeGreaterThan(0);
      expect(p.fov).toBeLessThan(120);
      expect(p.holdMs).toBeGreaterThan(0);
      expect(p.holdMs).toBeLessThan(5000);
      expect(typeof key).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("verdict holds longer than idle so the reveal beat stays put", () => {
    expect(CAMERA_PRESETS.verdict.holdMs).toBeGreaterThan(
      CAMERA_PRESETS.idle.holdMs,
    );
  });

  it("contender presets mirror across X (a is left, b is right)", () => {
    expect(CAMERA_PRESETS.a.position[0]).toBeLessThan(0);
    expect(CAMERA_PRESETS.b.position[0]).toBeGreaterThan(0);
    expect(Math.abs(CAMERA_PRESETS.a.position[0])).toBeCloseTo(
      Math.abs(CAMERA_PRESETS.b.position[0]),
      5,
    );
  });
});

describe("presetForMode", () => {
  it("returns neutral for cancelled / error modes", () => {
    const cancelledModes: StageMode[] = ["cancelled", "error"];
    for (const mode of cancelledModes) {
      expect(presetForMode(mode, "judge")).toBe("neutral");
    }
  });

  it("returns the camera mapping when mode is speaking/judging/verdict/idle", () => {
    expect(presetForMode("judging", "judge")).toBe("judge");
    expect(presetForMode("verdict", "verdict")).toBe("verdict");
    expect(presetForMode("idle", "idle")).toBe("idle");
  });

  it("propagates rebuttal through speaking mode", () => {
    expect(presetForMode("speaking", "rebuttal")).toBe("rebuttal");
  });
});
