/**
 * Shared palette for the 3D arena world (and any consumers).
 *
 * This module is intentionally Three-free so it can be imported from server
 * code, vitest specs, and HTML components without dragging the R3F runtime
 * into the server tree. The hex values are stored as ordinary strings; consumers
 * pass them to `new Color(hex)` once on the client, where Three's
 * `ColorManagement` (enabled by default in r0.150+) treats them as sRGB.
 *
 * Hue families:
 *   - terracotta      → Contender A signature + warm accent glow
 *   - plum            → Contender B signature + cool accent glow
 *   - honey           → Judge signature + key spotlight
 *   - walnut          → wood, walls, deep trim
 *   - cream           → paper cyclorama, HUD text
 *   - ink             → shadow / void
 */

export const PALETTE = {
  // --- Terracotta (Contender A) ---------------------------------------------
  terracotta: "#c97a5d",
  terracottaDeep: "#8b4f3a",
  terracottaLight: "#e8b59b",
  terracottaGlow: "#d27f60", // emissive accent strip on desk front

  // --- Plum (Contender B) ---------------------------------------------------
  plum: "#8c6f8f",
  plumDeep: "#5e4862",
  plumLight: "#b89cbe",
  plumGlow: "#9c7ea0",

  // --- Honey (Judge) -------------------------------------------------------
  honey: "#c89b3d",
  honeyDeep: "#8a6823",
  honeyLight: "#d4a843",
  honeyGlow: "#e2b94a",

  // --- Walnut (wood, walls, deep trim) -------------------------------------
  walnut: "#3d2e22",
  walnutShadow: "#5c4a38",
  walnutDeep: "#1d150e",
  walnutBlackened: "#14110d",

  // --- Cream (cyclorama, HUD text) -----------------------------------------
  cream: "#f4ede1",
  creamWarm: "#e6dcc6",

  // --- Taupe (mid-tone trim, signage edges) --------------------------------
  taupe: "#b8a285",
  taupeMid: "#8a7a64",

  // --- Ink (shadow / void) -------------------------------------------------
  ink: "#0c0a07",
  inkDim: "#1d150e",

  // --- Wood tones (stage floor planks) -------------------------------------
  woodWarm: "#8d5a3a",
  woodMid: "#6f4327",
  woodShadow: "#3f2618",
  woodHighlight: "#b78057",
} as const satisfies Record<string, string>;
