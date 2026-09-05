/**
 * WebGL capability probe for the 3D arena boundary.
 *
 * This module is intentionally pure: no `three`, no React, no direct DOM
 * access. The canvas factory is injectable so unit tests can run in the
 * `node` vitest environment, and the production default falls back to
 * `document.createElement("canvas")` only when a DOM exists.
 */

/** Minimal canvas surface the probe needs. Matches `HTMLCanvasElement`. */
export interface ProbeCanvas {
  getContext(kind: string): unknown | null;
}

/** Creates a probe canvas, or returns nullish when no DOM is available. */
export type CanvasFactory = () => ProbeCanvas | null | undefined;

export type WebGLSupport =
  | { readonly supported: true; readonly version: "webgl2" | "webgl" }
  | { readonly supported: false; readonly version: null };

function tryContext(
  canvas: ProbeCanvas,
  kind: "webgl2" | "webgl",
): boolean {
  try {
    return canvas.getContext(kind) != null;
  } catch {
    // Some browsers throw instead of returning null for unsupported kinds.
    return false;
  }
}

function defaultFactory(): ProbeCanvas | null {
  if (typeof document === "undefined") return null;
  return document.createElement("canvas");
}

/**
 * Probe WebGL support. Prefers `webgl2`, falls back to `webgl`.
 * Never throws; returns `{ supported: false }` when there is no canvas.
 */
export function probeWebGLSupport(
  createCanvas: CanvasFactory = defaultFactory,
): WebGLSupport {
  const canvas = createCanvas();
  if (canvas == null) return { supported: false, version: null };
  if (tryContext(canvas, "webgl2")) return { supported: true, version: "webgl2" };
  if (tryContext(canvas, "webgl")) return { supported: true, version: "webgl" };
  return { supported: false, version: null };
}
