/**
 * Shared palette for the 3D arena world (and any consumers).
 *
 * This module is intentionally Three-free so it can be imported from server
 * code, vitest specs, and HTML components without dragging the R3F runtime
 * into the server tree. The hex values are stored as ordinary strings; consumers
 * pass them to `new Color(hex)` once on the client, where Three's
 * `ColorManagement` (enabled by default in r0.150+) treats them as sRGB.
 *
 * The public PALETTE names are kept for the existing 3D callers. Values come
 * from the canonical design token source rather than being duplicated here.
 * The legacy hue names intentionally map to the new identity names:
 *   - terracotta → Ember
 *   - plum       → Vesper
 *   - honey      → Judge
 */

import { ARENA_TOKENS } from "@/shared/design/arena-tokens";

const { stage, material, identity, utility } = ARENA_TOKENS.colors;

/** Three material colors are opaque; canonical glow tokens carry UI alpha. */
function opaqueColor(value: string): string {
  return value.length === 9 ? value.slice(0, 7) : value;
}

export const PALETTE = {
  // --- Ember (Contender A; legacy names retained) ---------------------------
  terracotta: identity.ember.base,
  terracottaDeep: identity.ember.deep,
  terracottaLight: identity.ember.bright,
  terracottaGlow: opaqueColor(identity.ember.glow),

  // --- Vesper (Contender B; legacy names retained) -------------------------
  plum: identity.vesper.base,
  plumDeep: identity.vesper.deep,
  plumLight: identity.vesper.bright,
  plumGlow: opaqueColor(identity.vesper.glow),

  // --- Judge (legacy names retained) ---------------------------------------
  honey: identity.judge.base,
  honeyDeep: identity.judge.deep,
  honeyLight: identity.judge.bright,
  honeyGlow: opaqueColor(identity.judge.glow),

  // --- Studio materials -----------------------------------------------------
  walnut: material.walnut,
  walnutShadow: material.walnutShadow,
  walnutDeep: material.walnutDeep,
  /** Kept dark for hair/eyes and older prop callers. */
  walnutBlackened: material.walnutDeep,
  blackenedMetal: material.blackenedMetal,

  cream: material.cream,
  creamWarm: material.creamWarm,

  taupe: material.taupe,
  taupeMid: material.taupeMid,

  // --- Stage / shadow -------------------------------------------------------
  stageBackground: stage.background,
  stageSkyTop: stage.skyTop,
  stageSkyMid: stage.skyMid,
  stageFloor: stage.floor,
  stageCyclorama: stage.cyclorama,
  ink: stage.cyclorama,
  inkDim: stage.background,

  // --- Neutral evidence cue ------------------------------------------------
  evidence: utility.evidence,

  woodWarm: material.woodWarm,
  woodMid: material.woodMid,
  woodShadow: material.woodShadow,
  woodHighlight: material.woodHighlight,
} as const satisfies Record<string, string>;
