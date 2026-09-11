/**
 * Phase C 3D boundary (client-only arena scene).
 *
 * This barrel is intentionally three-free for everything except TYPE
 * exports of the runtime values — the R3F canvas
 * (`arena-canvas.client.tsx`) is reachable only through the `ssr: false`
 * dynamic import inside `canvas-gate.tsx`, so importing this barrel from
 * server components never pulls `three` into the server tree.
 *
 * Consumers get:
 *   - the gate + the WebGL probe + the shared `useWebGLSupport` hook
 *   - pure-data constants (palette, scene-layout, scene-signal)
 *   - pure preset modules (camera, lighting, character pose, confetti)
 *   - types so the canvas side can coordinate with directors
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
export { PALETTE } from "./colors";
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
  type MonitorLayout,
  type Vec2,
  type Vec3,
  type Box3,
  type LightKey,
} from "./scene-layout";
export { deriveSceneSignal, type SceneSignal } from "./scene-signal";
export {
  ARENA_ASSETS,
  ARENA_ASSET_BASE_PATH,
  ARENA_ASSET_FALLBACK_CATEGORIES,
  ARENA_ASSET_IDS,
  ARENA_CHARACTER_ANCHOR_NAMES,
  ARENA_CHARACTER_ASSET_IDS,
  getArenaAssetFallbackCategory,
  getArenaAssetRequiredAnchors,
  getArenaAssetSpec,
  normalizeArenaAssetTransform,
  type ArenaAssetFallbackCategory,
  type ArenaAssetId,
  type ArenaAssetSpec,
  type ArenaAssetTransform,
  type ArenaCharacterAnchorName,
  type ArenaCharacterAssetId,
  type NormalizedArenaAssetTransform,
} from "./arena-assets";
export {
  CAMERA_PRESETS,
  presetForMode,
  type CameraPreset,
} from "./camera-presets";
export {
  LIGHTING_PRESETS,
  lightingPresetFor,
  type LightingPreset,
} from "./lighting-presets";
export {
  CONTENDER_POSES,
  JUDGE_POSES,
  VERDICT_REACTIONS,
  blendPoseOffsets,
  type ContenderPose,
  type JudgePose,
  type ReactionBurst,
} from "./character-poses";
export {
  CONFETTI_BURST_COUNT,
  CONFETTI_POOL_SIZE,
  CONFETTI_DEFAULT_SIZE,
  VERDICT_CONFETTI_COLORS,
  VERDICT_TIMING,
  pickConfettiColor,
  planConfettiBurst,
  type ConfettiColor,
  type ConfettiSpawn,
} from "./confetti";
// Type-only exports for the lighting rig controls (the runtime lives in
// arena-canvas.client.tsx; the scene-tree reads its shape to drive lights).
export type {
  ArenaLightingControls,
  ArenaLightingHandles,
} from "./arena-lighting";
export type { ArenaOrbitCameraHandle } from "./arena-orbit-camera";
export type { GavelHandle, ConfettiHandle, VerdictPropHandles } from "./arena-props";
