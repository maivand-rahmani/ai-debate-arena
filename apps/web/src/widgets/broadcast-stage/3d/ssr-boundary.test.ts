import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * SSR boundary tests (Gate B, oracle fix #2 — static variant).
 *
 * The whole R3F/three/Rapier world must stay behind the client-only
 * CanvasGate dynamic boundary:
 *   1. No non-test source outside `3d/` may import three/@react-three.
 *   2. Inside `3d/`, the module `arena-canvas.client.tsx` is the ONLY place
 *      reachable from a static `next/dynamic(..., { ssr: false })` call in
 *      canvas-gate.tsx — no other file may import it.
 *   3. Pure modules (colors.ts, scene-layout.ts, webgl-capabilities.ts) must
 *      not import three-family packages at all, so vitest/node stays safe.
 *   4. canvas-gate.tsx must keep `ssr: false` on the dynamic import.
 */

const THREE_IMPORT = /from\s+["'](?:three|@react-three\/[^"']+)["']/;
const CANVAS_CLIENT_REF = /["']@\/widgets\/broadcast-stage\/3d\/arena-canvas\.client["']|["']\.\/arena-canvas\.client["']/;

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

const SRC = join(process.cwd(), "src");
const allFiles = walk(SRC).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

describe("ssr boundary — three-family imports confined to 3d/ client files", () => {
  const offenders: string[] = [];
  for (const file of allFiles) {
    const rel = relative(SRC, file).replaceAll("\\", "/");
    if (rel.startsWith("widgets/broadcast-stage/3d/")) continue;
    if (THREE_IMPORT.test(readFileSync(file, "utf8"))) offenders.push(rel);
  }

  it("nothing outside widgets/broadcast-stage/3d imports three/@react-three", () => {
    expect(offenders).toEqual([]);
  });
});

describe("ssr boundary — pure 3d data modules stay three-free", () => {
  for (const pure of ["colors.ts", "scene-layout.ts", "webgl-capabilities.ts"]) {
    it(`${pure} does not import three-family packages`, () => {
      const src = readFileSync(
        join(SRC, "widgets", "broadcast-stage", "3d", pure),
        "utf8",
      );
      expect(THREE_IMPORT.test(src)).toBe(false);
    });
  }
});

describe("ssr boundary — canvas client reachable only via the ssr:false dynamic gate", () => {
  it("canvas-gate.tsx dynamic-imports the client with ssr:false", () => {
    const gate = readFileSync(
      join(SRC, "widgets", "broadcast-stage", "3d", "canvas-gate.tsx"),
      "utf8",
    );
    expect(CANVAS_CLIENT_REF.test(gate)).toBe(true);
    expect(/ssr:\s*false/.test(gate)).toBe(true);
  });

  it("no other file statically imports arena-canvas.client", () => {
    const importers: string[] = [];
    for (const file of allFiles) {
      const rel = relative(SRC, file).replaceAll("\\", "/");
      if (rel.endsWith("3d/canvas-gate.tsx")) continue;
      if (rel.endsWith("3d/arena-canvas.client.tsx")) continue;
      if (CANVAS_CLIENT_REF.test(readFileSync(file, "utf8"))) importers.push(rel);
    }
    expect(importers).toEqual([]);
  });
});
