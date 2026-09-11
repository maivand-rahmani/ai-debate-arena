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

  it("tucks each contender chair directly behind its desk (close to desk, not far)", () => {
    // The user-visible fix: chairs were 1+ m behind the desk front. Now the
    // chair seat sits within ~0.3 m of the desk back edge so the contender
    // visibly sits at their workstation.
    const { A, B } = ARENA_LAYOUT.desks;
    const { A: chairA, B: chairB } = ARENA_LAYOUT.chairs;
    const deskBackZ = (desk: typeof A) => desk.position[2] - desk.topSize[2] / 2;
    const distanceA = deskBackZ(A) - chairA.seatPosition[2];
    const distanceB = deskBackZ(B) - chairB.seatPosition[2];
    // Chairs should sit close to the desk back edge (≤0.3 m behind it),
    // never "standing a metre away from it" the way the original layout did.
    expect(distanceA).toBeLessThanOrEqual(0.3);
    expect(distanceA).toBeGreaterThan(-0.3);
    expect(distanceB).toBeLessThanOrEqual(0.3);
    expect(distanceB).toBeGreaterThan(-0.3);
    // X must match the desk center (no off-axis chairs).
    expect(chairA.seatPosition[0]).toBeCloseTo(A.position[0], 5);
    expect(chairB.seatPosition[0]).toBeCloseTo(B.position[0], 5);
    // Seat Y is the standard 0.55 m desk-chair seat height.
    expect(chairA.seatPosition[1]).toBeCloseTo(0.55, 5);
    expect(chairB.seatPosition[1]).toBeCloseTo(0.55, 5);
  });

  it("puts a workstation monitor on each contender desk at the right height", () => {
    const { A, B } = ARENA_LAYOUT.desks;
    const { A: monA, B: monB } = ARENA_LAYOUT.monitors;
    const deskTopY = A.position[1] + A.topSize[1] / 2;
    // Monitor base sits on the desk top (small skin tolerance).
    expect(monA.basePosition[1]).toBeGreaterThanOrEqual(deskTopY);
    expect(monB.basePosition[1]).toBeGreaterThanOrEqual(deskTopY);
    // Base is centered on the desk's X (within 0.1 m).
    expect(monA.basePosition[0]).toBeCloseTo(A.position[0], 1);
    expect(monB.basePosition[0]).toBeCloseTo(B.position[0], 1);
    // Screen sits above the desk top — never below it.
    expect(monA.screenPosition[1]).toBeGreaterThan(deskTopY);
    expect(monB.screenPosition[1]).toBeGreaterThan(deskTopY);
    // The local +Z glass normal is rotated around to negative Z, toward the
    // seated talent rather than toward the spectator camera.
    expect(Math.abs(monA.screenRotationY)).toBeGreaterThan(Math.PI / 2);
    expect(Math.abs(monB.screenRotationY)).toBeGreaterThan(Math.PI / 2);
    expect(monA.screenRotationY).toBeCloseTo(Math.PI + Math.PI / 14, 5);
    expect(monB.screenRotationY).toBeCloseTo(Math.PI - Math.PI / 14, 5);
    // Leave a deliberate working distance between the contender and the
    // display so it reads as equipment on the desk, not a face shield.
    expect(monA.screenPosition[2] - ARENA_LAYOUT.characters.A.position[2]).toBeGreaterThan(0.8);
    expect(monB.screenPosition[2] - ARENA_LAYOUT.characters.B.position[2]).toBeGreaterThan(0.8);
  });

  it("places the judge's throne on the platform, behind the character", () => {
    const { judge, characters } = ARENA_LAYOUT;
    const platformTopY = judge.platformPosition[1] + judge.platformSize[1] / 2;
    // Chair seat is on top of the platform (elevated, not floor-mounted).
    expect(judge.chairSeatPosition[1]).toBeGreaterThan(platformTopY);
    // Chair sits behind the character (more negative Z).
    expect(judge.chairSeatPosition[2]).toBeLessThan(characters.judge.position[2]);
    // X stays on the centerline.
    expect(judge.chairSeatPosition[0]).toBeCloseTo(0, 5);
    // Chair also fits inside the platform's depth footprint.
    const chairZ = judge.chairSeatPosition[2];
    expect(chairZ).toBeGreaterThanOrEqual(
      judge.platformPosition[2] - judge.platformSize[2] / 2,
    );
    expect(chairZ).toBeLessThanOrEqual(
      judge.platformPosition[2] + judge.platformSize[2] / 2,
    );
  });

  it("keeps the gavel clear of the relocated judge capsule", () => {
    // After dropping the judge onto the elevated throne, the new capsule sits
    // at (0, 1.25, -3.0) with radius ≈ 0.385. The gavel spawns at (0, 0.76, -2.4)
    // — distance ≥ 0.10 m radially so it doesn't pop on frame 0.
    const judge = ARENA_LAYOUT.characters.judge.position;
    const judgeRadius = 0.55 * 0.7; // matches arena-character.tsx capsule math
    const gavel = ARENA_LAYOUT.props.gavel.initialPosition;
    const dx = gavel[0] - judge[0];
    const dy = gavel[1] - judge[1];
    const dz = gavel[2] - judge[2];
    const radial = Math.sqrt(dx * dx + dy * dy + dz * dz) - judgeRadius;
    expect(radial).toBeGreaterThanOrEqual(0.1);
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
