import { describe, expect, it } from "vitest";
import { CAMERA_PRESETS } from "./camera-presets";
import { projectHeroCamera } from "./hero-camera";

describe("projectHeroCamera", () => {
  it("settles exactly on the active preset", () => {
    const preset = CAMERA_PRESETS.idle;
    expect(projectHeroCamera(preset, 1, false)).toEqual({
      position: preset.position,
      target: preset.target,
      fov: preset.fov,
    });
  });

  it("adds a restrained wide establishing move during entry", () => {
    const projection = projectHeroCamera(CAMERA_PRESETS.idle, 0, false);
    expect(projection.position[1]).toBeGreaterThan(CAMERA_PRESETS.idle.position[1]);
    expect(projection.position[2]).toBeGreaterThan(CAMERA_PRESETS.idle.position[2]);
    expect(projection.fov).toBeGreaterThan(CAMERA_PRESETS.idle.fov);
  });

  it("snaps to settled state when motion is reduced", () => {
    expect(projectHeroCamera(CAMERA_PRESETS.idle, 0, true)).toEqual(
      projectHeroCamera(CAMERA_PRESETS.idle, 1, false),
    );
  });
});
