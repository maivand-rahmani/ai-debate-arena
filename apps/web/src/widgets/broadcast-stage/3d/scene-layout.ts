/**
 * Pure scene layout for the 3D arena world.
 *
 * World units are meters. The arena is a small stage (~12 units wide) with
 * surrounding negative space so the spectator camera always sees the full
 * composition. All positions/sizes are immutable literals so the layout is
 * unit-testable without standing up Three.js; the rendering side reads them
 * and constructs meshes + colliders against these same numbers.
 *
 * Symmetry: the broadcaster desks are mirrored across X. Desks A and B sit at
 * equal +/−X offsets with the same depth and height; the judge plinth is
 * dead-center and slightly forward of the cyclorama.
 *
 * PROP CLEARANCE INVARIANT (Gate B): dynamic props (gavel, mics) must START
 * at least 0.10 m radially clear of the nearest character capsule surface —
 * contender capsules: radius 0.315 centered at z=-0.2; judge capsule: radius
 * 0.385 at z=-3.0. A spawn inside a fixed collider makes Rapier pop the body
 * on frame 0. Re-check this math before editing any prop initialPosition.
 */

import { PALETTE } from "./colors";

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];
export type Box3 = readonly [Vec2, Vec2, Vec2]; // half-extents for cuboid colliders

export interface DeskLayout {
  readonly id: "A" | "B";
  readonly position: Vec3;
  readonly topSize: Vec3; // width, height (slab thickness), depth
  readonly baseSize: Vec3;
  readonly accentColor: string;
  readonly accentGlowColor: string;
  readonly faceCameraRotationY: number;
}

export interface ChairLayout {
  readonly seatPosition: Vec3;
  readonly backRest: Vec3;
}

export interface MonitorLayout {
  /** Desk-relative position of the monitor base on top of the desk. */
  readonly basePosition: Vec3;
  /** Visual size of the monitor screen (width, height, depth). */
  readonly screenSize: Vec3;
  /** Desk-relative position of the screen center. */
  readonly screenPosition: Vec3;
  /** Tilt of the screen around the X axis (radians, screen tilts toward talent). */
  readonly screenTiltX: number;
  /** Spin around Y so the screen faces the talent (radians). */
  readonly screenRotationY: number;
  /** Accent glow color (matches the contender signature). */
  readonly accentColor: string;
}

export interface JudgeLayout {
  readonly platformPosition: Vec3;
  readonly platformSize: Vec3;
  readonly accentColor: string;
  readonly characterPosition: Vec3;
  /** Position of the judge's chair on the raised platform. */
  readonly chairSeatPosition: Vec3;
  readonly chairBackRest: Vec3;
}

export interface ArenaLayout {
  readonly arenaFloor: {
    readonly size: Vec2; // width, depth
  };
  readonly stage: {
    readonly position: Vec3;
    readonly size: Vec3;
    readonly trimThickness: number;
  };
  readonly walls: {
    readonly thickness: number;
    readonly height: number;
    readonly span: number; // horizontal length of side walls
    readonly leftPosition: Vec3;
    readonly rightPosition: Vec3;
    readonly cycloramaRadius: number;
    readonly cycloramaSegments: number;
    readonly cycloramaPosition: Vec3;
  };
  readonly truss: {
    readonly position: Vec3;
    readonly size: Vec3;
    readonly barCount: number;
  };
  readonly signagePanels: ReadonlyArray<{
    readonly position: Vec3;
    readonly size: Vec3;
    readonly text: string;
    readonly tone: "title" | "side";
  }>;
  readonly desks: { readonly A: DeskLayout; readonly B: DeskLayout };
  readonly monitors: { readonly A: MonitorLayout; readonly B: MonitorLayout };
  readonly chairs: { readonly A: ChairLayout; readonly B: ChairLayout };
  readonly judge: JudgeLayout;
  readonly characters: {
    readonly A: { readonly position: Vec3; readonly headOffset: Vec3 };
    readonly B: { readonly position: Vec3; readonly headOffset: Vec3 };
    readonly judge: { readonly position: Vec3; readonly headOffset: Vec3 };
  };
  readonly props: {
    readonly gavel: { readonly initialPosition: Vec3; readonly size: Vec3 };
    readonly micA: { readonly initialPosition: Vec3; readonly size: Vec3 };
    readonly micB: { readonly initialPosition: Vec3; readonly size: Vec3 };
  };
  readonly camera: {
    readonly initialPosition: Vec3;
    readonly initialTarget: Vec3;
    readonly minDistance: number;
    readonly maxDistance: number;
    readonly minPolarAngle: number;
    readonly maxPolarAngle: number;
    readonly fov: number;
  };
  readonly fog: {
    readonly color: string;
    readonly near: number;
    readonly far: number;
  };
}

const arenaWidth = 24;
const arenaDepth = 24;
const stageWidth = 12;
const stageDepth = 6;
const stageThickness = 0.4;
const deskHalfWidth = 1.25;
const deskDepth = 1.0;
const deskSlabThickness = 0.08;
const deskTopHeight = 1.0;
const deskForward = 0.5;
/** Y of the seat surface for a standard desk chair. */
const chairSeatY = 0.55;
/** Y of the seat surface for the elevated judge chair on the platform. */
const judgeSeatY = 1.25;

export const ARENA_LAYOUT: ArenaLayout = {
  arenaFloor: {
    size: [arenaWidth, arenaDepth],
  },
  stage: {
    position: [0, stageThickness / 2, 0],
    size: [stageWidth, stageThickness, stageDepth],
    trimThickness: 0.05,
  },
  walls: {
    thickness: 0.3,
    height: 5.6,
    span: arenaWidth,
    leftPosition: [-arenaWidth / 2, 5.6 / 2, 0],
    rightPosition: [arenaWidth / 2, 5.6 / 2, 0],
    cycloramaRadius: arenaWidth / 2 - 1,
    cycloramaSegments: 16,
    cycloramaPosition: [0, 0, -7.0],
  },
  truss: {
    position: [0, 5.4, 0],
    size: [arenaWidth - 2, 0.18, 0.18],
    barCount: 4,
  },
  signagePanels: [
    {
      // Wide title banner across the cyclorama
      position: [0, 3.4, -6.94],
      size: [8.0, 1.6, 0.06],
      text: "AI DEBATE ARENA",
      tone: "title",
    },
    {
      // Honey accent strip below the title
      position: [0, 2.4, -6.94],
      size: [6.0, 0.3, 0.06],
      text: "TONIGHT'S MOTION",
      tone: "side",
    },
    {
      // Smaller "ON AIR" placard over the judge area
      position: [0, 4.5, -6.94],
      size: [1.8, 0.6, 0.06],
      text: "ON AIR",
      tone: "side",
    },
  ],
  desks: {
    A: {
      id: "A",
      position: [-4.5, deskTopHeight, deskForward],
      topSize: [deskHalfWidth * 2, deskSlabThickness, deskDepth],
      baseSize: [deskHalfWidth * 2 - 0.15, deskTopHeight - deskSlabThickness, deskDepth - 0.15],
      accentColor: PALETTE.terracotta,
      accentGlowColor: PALETTE.terracottaGlow,
      faceCameraRotationY: Math.PI / 8,
    },
    B: {
      id: "B",
      position: [4.5, deskTopHeight, deskForward],
      topSize: [deskHalfWidth * 2, deskSlabThickness, deskDepth],
      baseSize: [deskHalfWidth * 2 - 0.15, deskTopHeight - deskSlabThickness, deskDepth - 0.15],
      accentColor: PALETTE.plum,
      accentGlowColor: PALETTE.plumGlow,
      faceCameraRotationY: -Math.PI / 8,
    },
  },
  monitors: {
    // Monitors sit centered on each desk in front of the talent. The screen
    // tilts back ~10° and turns toward the camera so it reads as a broadcast
    // workstation monitor (partially visible to the audience).
    A: {
      basePosition: [-4.5, deskTopHeight + deskSlabThickness, deskForward - 0.15],
      screenSize: [0.62, 0.42, 0.04],
      screenPosition: [-4.5, deskTopHeight + deskSlabThickness + 0.34, deskForward - 0.15],
      screenTiltX: -0.12,
      screenRotationY: -Math.PI / 10,
      accentColor: PALETTE.terracottaLight,
    },
    B: {
      basePosition: [4.5, deskTopHeight + deskSlabThickness, deskForward - 0.15],
      screenSize: [0.62, 0.42, 0.04],
      screenPosition: [4.5, deskTopHeight + deskSlabThickness + 0.34, deskForward - 0.15],
      screenTiltX: -0.12,
      screenRotationY: Math.PI / 10,
      accentColor: PALETTE.plumLight,
    },
  },
  chairs: {
    // Chairs are tucked right up against the back of each desk so the
    // contender visibly sits at their workstation instead of standing
    // a metre or more away from it. Seat Z sits just inside the desk
    // back edge; the character sits centered on the chair seat.
    A: {
      seatPosition: [-4.5, chairSeatY, -0.15],
      backRest: [0.7, 0.85, 0.12],
    },
    B: {
      seatPosition: [4.5, chairSeatY, -0.15],
      backRest: [0.7, 0.85, 0.12],
    },
  },
  judge: {
    platformPosition: [0, 0.35, -3.0],
    platformSize: [3.0, 0.7, 1.4],
    accentColor: PALETTE.honey,
    characterPosition: [0, judgeSeatY, -3.0],
    // The judge's throne sits centered on the raised platform, tucked just
    // behind the character so the seat + backrest stay visible above the
    // platform trim from a wide spectator camera.
    chairSeatPosition: [0, judgeSeatY, -3.0 - 0.55],
    chairBackRest: [0.95, 1.05, 0.14],
  },
  characters: {
    A: {
      position: [-4.5, deskTopHeight, -0.2],
      headOffset: [0, 1.1, 0],
    },
    B: {
      position: [4.5, deskTopHeight, -0.2],
      headOffset: [0, 1.1, 0],
    },
    // The judge sits on the elevated throne on top of the platform: base at
    // chair-seat height so the legs (rendered by the judge visual) drop
    // visibly from the torso to the platform top.
    judge: {
      position: [0, judgeSeatY, -3.0],
      headOffset: [0, 1.3, 0],
    },
  },
  props: {
    gavel: {
      // Judge platform top; z=-2.4 keeps it on the platform (z range -3.7..-2.3)
      // with 0.215 m radial clearance from the judge capsule (Gate B fix).
      initialPosition: [0, 0.7 + 0.06, -2.4],
      size: [0.18, 0.07, 0.06],
    },
    micA: {
      // Near the desk front edge so the spawn clears the character capsule by
      // ≥0.10 m radially (capsule edge at z=0.115; mic at z=0.45 → 0.335 m).
      initialPosition: [-4.5, deskTopHeight + deskSlabThickness + 0.12, deskForward - 0.05],
      size: [0.07, 0.18, 0.07],
    },
    micB: {
      initialPosition: [4.5, deskTopHeight + deskSlabThickness + 0.12, deskForward - 0.05],
      size: [0.07, 0.18, 0.07],
    },
  },
  camera: {
    initialPosition: [0, 4.4, 11.5],
    initialTarget: [0, 1.2, -1.0],
    minDistance: 6,
    maxDistance: 18,
    // Lock polar so users cannot orbit under the floor or above the truss.
    minPolarAngle: Math.PI * 0.18, // ~32°
    maxPolarAngle: Math.PI * 0.46, // ~83° (just shy of horizontal)
    fov: 50,
  },
  fog: {
    color: PALETTE.ink,
    near: 12,
    far: 30,
  },
};

/**
 * Rapier physics configuration. Cuboid colliders sized to wrap each set piece
 * with a small skin so dynamic props (gavel, mics) settle cleanly without
 * visual leakage. Gravity is "real-world" Earth — small props make for a
 * nicely theatrical initial settle.
 */
export const PHYSICS_CONFIG = {
  gravity: [0, -9.81, 0] as Vec3,
  // Bedtime ratio so we don't blow through multiple updates per visual frame.
  timeStep: 1 / 60,
} as const;

/**
 * Lighting rig defaults (intensities are static for Phase B; the
 * {@link ./arena-lighting} component exposes a mutable ref handle for
 * Phase C to drive them from debate state). Numbers are tuned for a warm
 * studio with a strong key, two colored desk fills, and a honey judge key.
 */
export const LIGHTING_DEFAULTS = {
  ambient: 0.32,
  hemisphereSky: PALETTE.honeyLight,
  hemisphereGround: PALETTE.walnutDeep,
  hemisphere: 0.55,
  key: 1.15,
  keyColor: PALETTE.creamWarm,
  spotA: 1.4,
  spotB: 1.4,
  spotJudge: 1.6,
  rimHoneylight: 0.45,
} as const;

/** The subset of lighting values that Phase C can drive as numbers. */
export type LightKey =
  | "ambient"
  | "hemisphere"
  | "key"
  | "spotA"
  | "spotB"
  | "spotJudge"
  | "rimHoneylight";

/** Numeric defaults for the intensity-controllable subset. */
export const LIGHTING_INTENSITY_DEFAULTS: Readonly<Record<LightKey, number>> = {
  ambient: LIGHTING_DEFAULTS.ambient,
  hemisphere: LIGHTING_DEFAULTS.hemisphere,
  key: LIGHTING_DEFAULTS.key,
  spotA: LIGHTING_DEFAULTS.spotA,
  spotB: LIGHTING_DEFAULTS.spotB,
  spotJudge: LIGHTING_DEFAULTS.spotJudge,
  rimHoneylight: LIGHTING_DEFAULTS.rimHoneylight,
};

/** Telemetry-only: dynamic prop mass. Higher = faster fall, more momentum. */
export const PROP_MASS = {
  gavel: 0.4,
  mic: 0.08,
} as const;
