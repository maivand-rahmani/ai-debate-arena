"use client";

import { Clone, useGLTF } from "@react-three/drei";
import { Component, Suspense, type ReactNode } from "react";
import {
  getArenaAssetFallbackCategory,
  getArenaAssetSpec,
  normalizeArenaAssetTransform,
  type ArenaAssetFallbackCategory,
  type ArenaAssetId,
  type ArenaAssetTransform,
} from "./arena-assets";

export type ArenaAssetLoadState = "loading" | "error";

export interface ArenaAssetFallbackContext {
  readonly asset: ArenaAssetId;
  readonly category: ArenaAssetFallbackCategory;
  readonly state: ArenaAssetLoadState;
}

export type ArenaAssetFallback =
  | ReactNode
  | ((context: ArenaAssetFallbackContext) => ReactNode);

export interface ArenaAssetLoaderProps {
  readonly asset: ArenaAssetId;
  readonly position?: ArenaAssetTransform["position"];
  readonly rotation?: ArenaAssetTransform["rotation"];
  readonly scale?: ArenaAssetTransform["scale"];
  /** Rendered while the GLB is suspended or when it fails to load. */
  readonly fallback?: ArenaAssetFallback;
  /** Optional loading-specific visual; otherwise `fallback` is reused. */
  readonly loadingFallback?: ArenaAssetFallback;
  /** Receives a failed request after the error boundary catches it. */
  readonly onError?: (error: unknown) => void;
}

interface ArenaAssetErrorBoundaryProps {
  readonly fallback: ReactNode;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly children: ReactNode;
}

interface ArenaAssetErrorBoundaryState {
  readonly hasError: boolean;
}

class ArenaAssetErrorBoundary extends Component<
  ArenaAssetErrorBoundaryProps,
  ArenaAssetErrorBoundaryState
> {
  state: ArenaAssetErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ArenaAssetErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError?.(error);
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function resolveFallback(
  fallback: ArenaAssetFallback | undefined,
  context: ArenaAssetFallbackContext,
): ReactNode {
  return typeof fallback === "function" ? fallback(context) : fallback ?? null;
}

function LoadedArenaAsset({
  asset,
  position,
  rotation,
  scale,
}: Pick<ArenaAssetLoaderProps, "asset" | "position" | "rotation" | "scale">) {
  const { scene } = useGLTF(getArenaAssetSpec(asset).url);
  const {
    position: normalizedPosition,
    rotation: normalizedRotation,
    scale: normalizedScale,
  } = normalizeArenaAssetTransform({ position, rotation, scale });

  return (
    <group
      position={normalizedPosition}
      rotation={normalizedRotation}
      scale={normalizedScale}
    >
      <Clone object={scene} />
    </group>
  );
}

/**
 * Client-only GLB boundary for replaceable arena assets.
 *
 * `useGLTF` suspends during loading and throws on a failed request. Suspense
 * renders the loading fallback, while the local error boundary converts a
 * missing/corrupt GLB into the same caller-controlled fallback path instead
 * of taking down the entire canvas.
 */
export function ArenaAssetLoader({
  asset,
  position,
  rotation,
  scale,
  fallback,
  loadingFallback,
  onError,
}: ArenaAssetLoaderProps) {
  const category = getArenaAssetFallbackCategory(asset);
  const errorFallback = resolveFallback(fallback, {
    asset,
    category,
    state: "error",
  });
  const loadingFallbackNode = resolveFallback(loadingFallback ?? fallback, {
    asset,
    category,
    state: "loading",
  });

  return (
    <ArenaAssetErrorBoundary fallback={errorFallback} onError={onError}>
      <Suspense fallback={loadingFallbackNode}>
        <LoadedArenaAsset
          asset={asset}
          position={position}
          rotation={rotation}
          scale={scale}
        />
      </Suspense>
    </ArenaAssetErrorBoundary>
  );
}
