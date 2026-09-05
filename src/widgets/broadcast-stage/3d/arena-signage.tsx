"use client";

import { useMemo } from "react";
import { CanvasTexture, DoubleSide } from "three";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";

const SIGNAGE_TONES: Record<
  "title" | "side",
  { readonly background: string; readonly text: string; readonly accent: string; readonly fontScale: number }
> = {
  title: {
    background: PALETTE.walnutDeep,
    text: PALETTE.cream,
    accent: PALETTE.honey,
    fontScale: 1.0,
  },
  side: {
    background: PALETTE.walnut,
    text: PALETTE.creamWarm,
    accent: PALETTE.honeyLight,
    fontScale: 0.5,
  },
};

/**
 * One emissive broadcast panel: a textured canvas reads as a backlit
 * title-card / "ON AIR" placard. The text is rasterized at module load via
 * a CanvasTexture so the panel reads as a sign without an extra image asset.
 */
function BroadcastPanel({
  text,
  tone,
  size,
  position,
}: {
  readonly text: string;
  readonly tone: "title" | "side";
  readonly size: readonly [number, number, number];
  readonly position: readonly [number, number, number];
}) {
  const texture = useMemo(() => buildPanelTexture(text, tone, size), [
    text,
    tone,
    size,
  ]);

  return (
    <mesh position={position} rotation-y={Math.PI}>
      <planeGeometry args={[size[0], size[1]]} />
      <meshStandardMaterial
        map={texture}
        emissiveMap={texture}
        emissive={PALETTE.creamWarm}
        emissiveIntensity={tone === "title" ? 0.95 : 0.7}
        toneMapped={false}
        roughness={0.4}
        metalness={0.0}
        side={DoubleSide}
      />
    </mesh>
  );
}

function buildPanelTexture(
  text: string,
  tone: "title" | "side",
  size: readonly [number, number, number],
): CanvasTexture {
  const palette = SIGNAGE_TONES[tone];
  // Canvas-pixel resolution: 4px per world unit gives crisp text without
  // ballooning texture memory.
  const pxW = Math.max(256, Math.round(size[0] * 80));
  const pxH = Math.max(64, Math.round(size[1] * 80));
  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // Backing fill
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, pxW, pxH);

    // Honey accent rail along the top
    ctx.fillStyle = palette.accent;
    const railH = tone === "title" ? pxH * 0.08 : pxH * 0.16;
    ctx.fillRect(0, 0, pxW, railH);

    // Honey accent rail along the bottom
    ctx.fillRect(0, pxH - railH, pxW, railH);

    // Centered text — heavy display face, generous tracking.
    const fontSize = palette.fontScale * (tone === "title" ? pxH * 0.55 : pxH * 0.5);
    ctx.fillStyle = palette.text;
    ctx.font = `800 ${fontSize}px "Syne", "DM Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = tone === "title" ? pxH * 0.08 : pxH * 0.04;
    ctx.fillText(text, pxW / 2, pxH / 2);
    ctx.shadowBlur = 0;
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = "srgb";
  texture.needsUpdate = true;
  return texture;
}

/**
 * All the broadcast signage panels from the layout, mounted on the
 * cyclorama wall. Tone-specific sizes/textures handled internally.
 */
export function ArenaSignage() {
  return (
    <group>
      {ARENA_LAYOUT.signagePanels.map((panel, i) => (
        <BroadcastPanel
          key={`panel-${i}-${panel.text}`}
          text={panel.text}
          tone={panel.tone}
          size={panel.size}
          position={panel.position}
        />
      ))}
    </group>
  );
}
