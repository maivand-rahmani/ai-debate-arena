"use client";

import dynamic from "next/dynamic";
import {
  Component,
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { probeWebGLSupport, type WebGLSupport } from "./webgl-capabilities";
import type { SceneSignal } from "./scene-signal";

/**
 * Shared chunk loader for the client-only arena canvas. Kept at module
 * scope so every gate instance reuses the same chunk; per-instance loading
 * UI is attached via the `loading` option in {@link CanvasGate}.
 * This module stays three-free (R3F/three touch WebGL at module scope and
 * cannot render on the server) — the only `three` import in the Phase A
 * boundary lives inside `arena-canvas.client.tsx`, reachable solely
 * through this `ssr: false` dynamic import.
 */
const loadArenaCanvasClient = () => import("./arena-canvas.client");

/**
 * Carries a gate instance's `loadingFallback` to the module-scope loading
 * component below (component identity must stay module-scope per
 * `react-hooks/static-components`, so the per-instance node flows through
 * context instead of a render-created closure).
 */
const ArenaLoadingFallbackContext = createContext<ReactNode>(undefined);

function ArenaCanvasLoading(): ReactNode {
  return <>{useContext(ArenaLoadingFallbackContext)}</>;
}

const ArenaCanvasLazy = dynamic(loadArenaCanvasClient, {
  ssr: false,
  loading: ArenaCanvasLoading,
});

interface CanvasErrorBoundaryProps {
  readonly fallback: ReactNode;
  readonly children: ReactNode;
}

interface CanvasErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Catches render/WebGL failures from the lazy canvas and falls back to the
 * provided 2D content instead of crashing the broadcast page.
 */
export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): CanvasErrorBoundaryState {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export interface CanvasGateProps {
  /** 2D fallback rendered when WebGL is unavailable or the canvas errors. */
  readonly children?: ReactNode;
  /** Shown while the arena chunk loads (before the canvas can mount). */
  readonly loadingFallback?: ReactNode;
  /**
   * Serializable scene signal forwarded to the canvas client. Built by
   * `deriveSceneSignal` in {@link ./scene-signal}; the gate itself stays
   * three-free — it just hands the POJO through to the lazy canvas.
   */
  readonly canvasProps?: SceneSignal;
  /**
   * Fired once when the lazy canvas reports its first rendered frame.
   * Optional; omit it when nothing needs the signal.
   */
  readonly onFirstFrame?: () => void;
}

/**
 * SSR-safe gate for the 3D arena (wired into composition in Phase B).
 *
 * Render discipline: the server snapshot reports "unsupported", so SSR and
 * hydration both emit `children` with no mismatch; on the client the store
 * snapshot upgrades once to the real probe result (cached per session) and
 * capable browsers swap in the lazy R3F canvas. Anything else keeps the
 * fallback children.
 */
const UNSUPPORTED: WebGLSupport = { supported: false, version: null };

let cachedSupport: WebGLSupport | null = null;

function subscribeCapability(): () => void {
  return () => {};
}

function getCapabilitySnapshot(): WebGLSupport {
  if (cachedSupport === null) cachedSupport = probeWebGLSupport();
  return cachedSupport;
}

function getCapabilityServerSnapshot(): WebGLSupport {
  return UNSUPPORTED;
}

export function CanvasGate({ children, loadingFallback, canvasProps, onFirstFrame }: CanvasGateProps) {
  const support = useSyncExternalStore(
    subscribeCapability,
    getCapabilitySnapshot,
    getCapabilityServerSnapshot,
  );

  if (!support.supported) return <>{children}</>;

  return (
    <ArenaLoadingFallbackContext.Provider value={loadingFallback}>
      <CanvasErrorBoundary fallback={children}>
        <ArenaCanvasLazy
          {...(canvasProps ? { signal: canvasProps } : {})}
          {...(onFirstFrame ? { onFirstFrame } : {})}
        />
      </CanvasErrorBoundary>
    </ArenaLoadingFallbackContext.Provider>
  );
}
