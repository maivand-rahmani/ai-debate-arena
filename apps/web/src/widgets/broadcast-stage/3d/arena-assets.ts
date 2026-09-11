/**
 * Pure, server-safe contract for the arena's replaceable GLB assets.
 *
 * Keep this module free of React, R3F, and Three imports. The manifest is
 * intentionally usable by tests and server-rendered composition code; the
 * loader that consumes it lives in `arena-asset-loader.client.tsx`.
 */

import type { Vec3 } from "./scene-layout";

export const ARENA_ASSET_BASE_PATH = "/assets/arena" as const;

export const ARENA_ASSET_IDS = [
  "set",
  "desk",
  "monitor",
  "chair",
  "character-a",
  "character-b",
  "character-judge",
  "props",
] as const;

export type ArenaAssetId = (typeof ARENA_ASSET_IDS)[number];

export const ARENA_ASSET_FALLBACK_CATEGORIES = [
  "set",
  "desk",
  "monitor",
  "chair",
  "character",
  "props",
] as const;

export type ArenaAssetFallbackCategory =
  (typeof ARENA_ASSET_FALLBACK_CATEGORIES)[number];

export const ARENA_CHARACTER_ASSET_IDS = [
  "character-a",
  "character-b",
  "character-judge",
] as const satisfies readonly ArenaAssetId[];

export type ArenaCharacterAssetId = (typeof ARENA_CHARACTER_ASSET_IDS)[number];

/** Names authored into character GLBs for future mood/speech animation. */
export const ARENA_CHARACTER_ANCHOR_NAMES = [
  "Head",
  "Mouth",
  "Brow.L",
  "Brow.R",
] as const;

export type ArenaCharacterAnchorName =
  (typeof ARENA_CHARACTER_ANCHOR_NAMES)[number];

export interface ArenaAssetSpec {
  readonly id: ArenaAssetId;
  readonly url: string;
  readonly fallbackCategory: ArenaAssetFallbackCategory;
  readonly requiredAnchors: readonly ArenaCharacterAnchorName[];
}

export interface ArenaAssetTransform {
  readonly position?: Vec3;
  readonly rotation?: Vec3;
  readonly scale?: number | Vec3;
}

export interface NormalizedArenaAssetTransform {
  readonly position?: [number, number, number];
  readonly rotation?: [number, number, number];
  readonly scale?: number | [number, number, number];
}

function normalizeVec3(value: Vec3 | undefined): [number, number, number] | undefined {
  return value ? [value[0], value[1], value[2]] : undefined;
}

/** Converts readonly scene tuples to the mutable tuple shape expected by R3F. */
export function normalizeArenaAssetTransform(
  transform: ArenaAssetTransform,
): NormalizedArenaAssetTransform {
  return {
    position: normalizeVec3(transform.position),
    rotation: normalizeVec3(transform.rotation),
    scale:
      typeof transform.scale === "number"
        ? transform.scale
        : normalizeVec3(transform.scale),
  };
}

const CHARACTER_ANCHORS: readonly ArenaCharacterAnchorName[] =
  ARENA_CHARACTER_ANCHOR_NAMES;
const NO_ANCHORS: readonly ArenaCharacterAnchorName[] = [];

/**
 * Stable asset registry. Do not derive these URLs from component names: asset
 * files are an integration boundary for the art pipeline and should remain
 * unchanged when React components are renamed or reorganized.
 */
export const ARENA_ASSETS: Readonly<Record<ArenaAssetId, ArenaAssetSpec>> = {
  set: {
    id: "set",
    url: `${ARENA_ASSET_BASE_PATH}/set.glb`,
    fallbackCategory: "set",
    requiredAnchors: NO_ANCHORS,
  },
  desk: {
    id: "desk",
    url: `${ARENA_ASSET_BASE_PATH}/desk.glb`,
    fallbackCategory: "desk",
    requiredAnchors: NO_ANCHORS,
  },
  monitor: {
    id: "monitor",
    url: `${ARENA_ASSET_BASE_PATH}/monitor.glb`,
    fallbackCategory: "monitor",
    requiredAnchors: NO_ANCHORS,
  },
  chair: {
    id: "chair",
    url: `${ARENA_ASSET_BASE_PATH}/chair.glb`,
    fallbackCategory: "chair",
    requiredAnchors: NO_ANCHORS,
  },
  "character-a": {
    id: "character-a",
    url: `${ARENA_ASSET_BASE_PATH}/character-a.glb`,
    fallbackCategory: "character",
    requiredAnchors: CHARACTER_ANCHORS,
  },
  "character-b": {
    id: "character-b",
    url: `${ARENA_ASSET_BASE_PATH}/character-b.glb`,
    fallbackCategory: "character",
    requiredAnchors: CHARACTER_ANCHORS,
  },
  "character-judge": {
    id: "character-judge",
    url: `${ARENA_ASSET_BASE_PATH}/character-judge.glb`,
    fallbackCategory: "character",
    requiredAnchors: CHARACTER_ANCHORS,
  },
  props: {
    id: "props",
    url: `${ARENA_ASSET_BASE_PATH}/props.glb`,
    fallbackCategory: "props",
    requiredAnchors: NO_ANCHORS,
  },
};

export function getArenaAssetSpec(asset: ArenaAssetId): ArenaAssetSpec {
  return ARENA_ASSETS[asset];
}

export function getArenaAssetFallbackCategory(
  asset: ArenaAssetId,
): ArenaAssetFallbackCategory {
  return getArenaAssetSpec(asset).fallbackCategory;
}

export function getArenaAssetRequiredAnchors(
  asset: ArenaAssetId,
): readonly ArenaCharacterAnchorName[] {
  return getArenaAssetSpec(asset).requiredAnchors;
}
