import { describe, expect, it } from "vitest";
import {
  LIGHTING_PRESETS,
  lightingPresetFor,
  type LightingPreset,
} from "./lighting-presets";
import { LIGHTING_INTENSITY_DEFAULTS, type LightKey } from "./scene-layout";
import type { StageCamera, StageMode } from "@/widgets/broadcast-stage/stage-state";

describe("LIGHTING_PRESETS", () => {
  const KEYS: LightKey[] = [
    "ambient",
    "hemisphere",
    "key",
    "spotA",
    "spotB",
    "spotJudge",
    "rimHoneylight",
  ];

  it("exposes one preset per StageCamera plus neutral", () => {
    const expected: (StageCamera | "neutral")[] = [
      "idle",
      "a",
      "b",
      "rebuttal",
      "judge",
      "verdict",
      "neutral",
    ];
    for (const key of expected) {
      expect(LIGHTING_PRESETS[key]).toBeDefined();
    }
  });

  it("every preset sets every LightKey with a finite non-negative intensity", () => {
    for (const preset of Object.values(LIGHTING_PRESETS) as LightingPreset[]) {
      for (const key of KEYS) {
        const v = preset.intensities[key];
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(5);
      }
    }
  });

  it("active-side spot bumps above baseline + idle-side spot below baseline", () => {
    const a = LIGHTING_PRESETS.a.intensities;
    const b = LIGHTING_PRESETS.b.intensities;
    expect(a.spotA).toBeGreaterThan(LIGHTING_INTENSITY_DEFAULTS.spotA);
    expect(a.spotB).toBeLessThan(LIGHTING_INTENSITY_DEFAULTS.spotB);
    expect(b.spotB).toBeGreaterThan(LIGHTING_INTENSITY_DEFAULTS.spotB);
    expect(b.spotA).toBeLessThan(LIGHTING_INTENSITY_DEFAULTS.spotA);
  });

  it("judging floods the judge with honey (spotJudge significantly up)", () => {
    expect(LIGHTING_PRESETS.judge.intensities.spotJudge).toBeGreaterThan(
      LIGHTING_PRESETS.idle.intensities.spotJudge,
    );
  });

  it("verdict ring is brightest on spotJudge + rim", () => {
    const v = LIGHTING_PRESETS.verdict.intensities;
    const id = LIGHTING_PRESETS.idle.intensities;
    expect(v.spotJudge).toBeGreaterThan(id.spotJudge);
    expect(v.rimHoneylight).toBeGreaterThan(id.rimHoneylight);
  });

  it("neutral is calmer than idle (cancelled state stays lit but quieter)", () => {
    const n = LIGHTING_PRESETS.neutral.intensities;
    expect(n.spotA).toBeLessThan(LIGHTING_PRESETS.idle.intensities.spotA);
    expect(n.spotB).toBeLessThan(LIGHTING_PRESETS.idle.intensities.spotB);
  });
});

describe("lightingPresetFor", () => {
  it("returns neutral on cancelled / error", () => {
    const failed: StageMode[] = ["cancelled", "error"];
    for (const mode of failed) {
      expect(lightingPresetFor(mode, "judge")).toBe("neutral");
    }
  });

  it("returns the judge preset while judging", () => {
    expect(lightingPresetFor("judging", "a")).toBe("judge");
  });

  it("returns the verdict preset on the finished state", () => {
    expect(lightingPresetFor("verdict", "judge")).toBe("verdict");
  });

  it("falls back to camera mapping on idle / speaking", () => {
    expect(lightingPresetFor("idle", "idle")).toBe("idle");
    expect(lightingPresetFor("speaking", "a")).toBe("a");
  });
});
