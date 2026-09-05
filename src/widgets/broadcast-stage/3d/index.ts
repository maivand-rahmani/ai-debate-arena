/**
 * Phase A 3D boundary (client-only arena shell).
 *
 * This barrel is intentionally three-free: the R3F canvas
 * (`arena-canvas.client.tsx`) is reachable only through the `ssr: false`
 * dynamic import inside `canvas-gate.tsx`, so importing this barrel from
 * server components never pulls `three` into the server tree. Phase B
 * wires {@link CanvasGate} into the broadcast composition.
 */
export { CanvasGate, type CanvasGateProps } from "./canvas-gate";
export {
  probeWebGLSupport,
  type CanvasFactory,
  type ProbeCanvas,
  type WebGLSupport,
} from "./webgl-capabilities";
