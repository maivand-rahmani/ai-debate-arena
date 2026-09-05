/**
 * Phase B 3D boundary (client-only arena scene).
 *
 * This barrel is intentionally three-free: the R3F canvas
 * (`arena-canvas.client.tsx`) is reachable only through the `ssr: false`
 * dynamic import inside `canvas-gate.tsx`, so importing this barrel from
 * server components never pulls `three` into the server tree. Consumers
 * get the gate + the WebGL probe + lightweight handle types so Phase C can
 * wire lighting/character state without leaking three imports upward.
 */
export { CanvasGate, type CanvasGateProps } from "./canvas-gate";
export {
  probeWebGLSupport,
  type CanvasFactory,
  type ProbeCanvas,
  type WebGLSupport,
} from "./webgl-capabilities";
export { useWebGLSupport } from "./use-webgl-support";
// Pure-data exports stay importable from server/test code paths.
export { PALETTE, SIGNAGE_TEXT, type PaletteKey } from "./colors";
export {
  ARENA_LAYOUT,
  PHYSICS_CONFIG,
  PROP_MASS,
  LIGHTING_DEFAULTS,
  LIGHTING_INTENSITY_DEFAULTS,
  type ArenaLayout,
  type DeskLayout,
  type JudgeLayout,
  type ChairLayout,
  type Vec2,
  type Vec3,
  type Box3,
  type LightKey,
} from "./scene-layout";
// Type-only exports for the lighting rig controls (the runtime lives in
// arena-canvas.client.tsx; Phase C will read its shape to drive lights).
export type {
  ArenaLightingControls,
  ArenaLightingHandles,
} from "./arena-lighting";
