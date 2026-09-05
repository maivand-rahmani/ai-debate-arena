import { describe, expect, it } from "vitest";
import { ARENA_LAYOUT, PHYSICS_CONFIG, PROP_MASS } from "./scene-layout";

describe("ARENA_LAYOUT", () => {
  it("mirrors desk A/B positions across the X axis with identical dimensions", () => {
    const { A, B } = ARENA_LAYOUT.desks;
    // Equal magnitude, opposing sign on X.
    expect(Math.abs(A.position[0])).toBeCloseTo(Math.abs(B.position[0]), 5);
    expect(A.position[0]).toBeLessThan(0);
    expect(B.position[0]).toBeGreaterThan(0);
    // Top + base sizes match (symmetry by construction).
    expect(A.topSize).toEqual(B.topSize);
    expect(A.baseSize).toEqual(B.baseSize);
    // Vertical faces angle toward the audience symmetrically.
    expect(Math.abs(A.faceCameraRotationY)).toBeCloseTo(Math.abs(B.faceCameraRotationY), 5);
    expect(A.faceCameraRotationY).toBeGreaterThan(0);
    expect(B.faceCameraRotationY).toBeLessThan(0);
  });

  it("places the judge platform on the centerline", () => {
    expect(ARENA_LAYOUT.judge.platformPosition[0]).toBeCloseTo(0, 5);
  });

  it("positions the gavel above the judge platform so it settles on top", () => {
    const judgeTopY = ARENA_LAYOUT.judge.platformPosition[1] + ARENA_LAYOUT.judge.platformSize[1] / 2;
    const gavelY = ARENA_LAYOUT.props.gavel.initialPosition[1];
    // Gavel starts slightly above the platform so it has room to settle
    // and reads visually as "resting on the desk".
    expect(gavelY).toBeGreaterThan(judgeTopY);
    expect(gavelY).toBeLessThan(judgeTopY + 0.5);
    // Same X/Z footprint as the platform center so it won't roll off.
    expect(ARENA_LAYOUT.props.gavel.initialPosition[0]).toBeCloseTo(ARENA_LAYOUT.judge.platformPosition[0], 5);
  });

  it("avoids collider overlap between desks and the judge platform", () => {
    const { A, B } = ARENA_LAYOUT.desks;
    const judge = ARENA_LAYOUT.judge;
    const halfDepthA = A.topSize[2] / 2;
    const halfDepthJudge = judge.platformSize[2] / 2;
    // The desk Z range and judge Z range must not overlap.
    const deskA_z_max = A.position[2] + halfDepthA;
    const deskA_z_min = A.position[2] - halfDepthA;
    const judge_z_max = judge.platformPosition[2] + halfDepthJudge;
    const judge_z_min = judge.platformPosition[2] - halfDepthJudge;
    const overlap_A = Math.min(deskA_z_max, judge_z_max) - Math.max(deskA_z_min, judge_z_min);
    expect(overlap_A).toBeLessThan(0);

    const deskB_z_max = B.position[2] + B.topSize[2] / 2;
    const deskB_z_min = B.position[2] - B.topSize[2] / 2;
    const overlap_B = Math.min(deskB_z_max, judge_z_max) - Math.max(deskB_z_min, judge_z_min);
    expect(overlap_B).toBeLessThan(0);
  });

  it("opens the cyclorama safely outside the camera frame at default position", () => {
    // The cyclorama wall must sit behind the desks so the default spectator
    // camera (front-and-center) is never inside the wall.
    expect(ARENA_LAYOUT.walls.cycloramaPosition[2]).toBeLessThan(-3);
    // Signage panels live on the cyclorama plane (same Z, very small Z offset).
    for (const panel of ARENA_LAYOUT.signagePanels) {
      expect(Math.abs(panel.position[2] - ARENA_LAYOUT.walls.cycloramaPosition[2])).toBeLessThan(0.5);
    }
  });

  it("constrains the spectator camera so users cannot dip under the floor", () => {
    const { minPolarAngle, maxPolarAngle } = ARENA_LAYOUT.camera;
    expect(minPolarAngle).toBeGreaterThan(0);
    expect(maxPolarAngle).toBeLessThan(Math.PI / 2);
    expect(maxPolarAngle).toBeGreaterThan(minPolarAngle);
    expect(ARENA_LAYOUT.camera.minDistance).toBeGreaterThan(0);
    expect(ARENA_LAYOUT.camera.maxDistance).toBeGreaterThan(ARENA_LAYOUT.camera.minDistance);
  });

  it("places both desk mics just above their respective desk tops", () => {
    const { A, B } = ARENA_LAYOUT.desks;
    expect(ARENA_LAYOUT.props.micA.initialPosition[1]).toBeGreaterThan(A.position[1]);
    expect(ARENA_LAYOUT.props.micB.initialPosition[1]).toBeGreaterThan(B.position[1]);
    expect(ARENA_LAYOUT.props.micA.initialPosition[0]).toBeCloseTo(A.position[0], 5);
    expect(ARENA_LAYOUT.props.micB.initialPosition[0]).toBeCloseTo(B.position[0], 5);
  });
});

describe("PHYSICS_CONFIG", () => {
  it("uses Earth's gravity vector", () => {
    expect(PHYSICS_CONFIG.gravity[0]).toBe(0);
    expect(PHYSICS_CONFIG.gravity[1]).toBeCloseTo(-9.81, 5);
    expect(PHYSICS_CONFIG.gravity[2]).toBe(0);
  });

  it("keeps the gavel heavier than the mics (it should feel weighty)", () => {
    expect(PROP_MASS.gavel).toBeGreaterThan(PROP_MASS.mic);
  });
});
