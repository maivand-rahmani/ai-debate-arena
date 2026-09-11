import { describe, expect, it } from "vitest";
import {
  ARENA_ASSETS,
  ARENA_ASSET_BASE_PATH,
  ARENA_ASSET_IDS,
  ARENA_CHARACTER_ANCHOR_NAMES,
  ARENA_CHARACTER_ASSET_IDS,
  getArenaAssetFallbackCategory,
  getArenaAssetRequiredAnchors,
  normalizeArenaAssetTransform,
} from "./arena-assets";

describe("arena asset manifest", () => {
  it("contains exactly the stable asset IDs", () => {
    expect(Object.keys(ARENA_ASSETS).sort()).toEqual([...ARENA_ASSET_IDS].sort());
    expect(ARENA_ASSET_IDS).toHaveLength(8);
  });

  it("uses stable local GLB URLs under the arena asset root", () => {
    for (const asset of ARENA_ASSET_IDS) {
      expect(ARENA_ASSETS[asset].url).toBe(`${ARENA_ASSET_BASE_PATH}/${asset}.glb`);
      expect(ARENA_ASSETS[asset].url).toMatch(/^\/assets\/arena\/[a-z-]+\.glb$/);
    }
  });

  it("maps each asset to the fallback category that can replace it", () => {
    expect(getArenaAssetFallbackCategory("set")).toBe("set");
    expect(getArenaAssetFallbackCategory("desk")).toBe("desk");
    expect(getArenaAssetFallbackCategory("monitor")).toBe("monitor");
    expect(getArenaAssetFallbackCategory("chair")).toBe("chair");
    expect(getArenaAssetFallbackCategory("props")).toBe("props");

    for (const character of ARENA_CHARACTER_ASSET_IDS) {
      expect(getArenaAssetFallbackCategory(character)).toBe("character");
    }
  });

  it("requires the shared animation anchors on every character asset", () => {
    for (const character of ARENA_CHARACTER_ASSET_IDS) {
      expect(getArenaAssetRequiredAnchors(character)).toEqual(
        ARENA_CHARACTER_ANCHOR_NAMES,
      );
    }
  });

  it("does not require character anchors on non-character assets", () => {
    for (const asset of ["set", "desk", "monitor", "chair", "props"] as const) {
      expect(getArenaAssetRequiredAnchors(asset)).toEqual([]);
    }
  });

  it("normalizes readonly transforms into R3F tuple props", () => {
    expect(
      normalizeArenaAssetTransform({
        position: [1, 2, 3],
        rotation: [0.1, 0.2, 0.3],
        scale: [1.2, 1.3, 1.4],
      }),
    ).toEqual({
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [1.2, 1.3, 1.4],
    });
    expect(normalizeArenaAssetTransform({ scale: 0.8 })).toEqual({
      position: undefined,
      rotation: undefined,
      scale: 0.8,
    });
  });
});
