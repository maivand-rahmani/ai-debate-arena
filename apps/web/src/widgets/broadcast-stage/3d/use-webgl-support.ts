"use client";

import { useSyncExternalStore } from "react";
import {
  probeWebGLSupport,
  type WebGLSupport,
} from "./webgl-capabilities";

/**
 * Server snapshot — always "unsupported" so SSR markup and the first client
 * render hydrate identically. The cached probe only runs on the client after
 * hydration, at which point React swaps the snapshot.
 */
const UNSUPPORTED: WebGLSupport = { supported: false, version: null };

let cachedSupport: WebGLSupport | null = null;

function subscribeNoop(): () => void {
  return () => {};
}

function getCapabilitySnapshot(): WebGLSupport {
  if (cachedSupport === null) cachedSupport = probeWebGLSupport();
  return cachedSupport;
}

function getCapabilityServerSnapshot(): WebGLSupport {
  return UNSUPPORTED;
}

/**
 * Lightweight hook returning whether the client actually has WebGL. Mirrors
 * `CanvasGate`'s internal logic so HUD overlays can render conditionally
 * without duplicating the probe. The same cached singleton is used so this
 * hook and `CanvasGate` always agree.
 */
export function useWebGLSupport(): WebGLSupport {
  return useSyncExternalStore(
    subscribeNoop,
    getCapabilitySnapshot,
    getCapabilityServerSnapshot,
  );
}
