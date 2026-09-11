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
    <group position={position}>
      <mesh position={[0, 0, -0.045]} castShadow receiveShadow>
        <boxGeometry args={[size[0] + 0.16, size[1] + 0.14, 0.08]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.38} metalness={0.58} />
      </mesh>
      <mesh>
        {/* The panel faces +Z toward the spectator camera. The old π rotation
            mirrored the CanvasTexture text on the live set. */}
        <planeGeometry args={[size[0], size[1]]} />
        <meshStandardMaterial
          map={texture}
          emissiveMap={texture}
          emissive={PALETTE.creamWarm}
          emissiveIntensity={tone === "title" ? 0.72 : 0.54}
          toneMapped={false}
          roughness={0.34}
          metalness={0.05}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

function BannerStructure({
  position,
  size,
}: {
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}) {
  const bar = 0.07;
  const frameDepth = 0.11;
  const frameZ = position[2] + size[2] / 2 + 0.02;
  const sideX = size[0] / 2 + bar / 2;
  const frameHeight = size[1] + bar * 2;

  return (
    <group position={[position[0], position[1], frameZ]}>
      <mesh position={[0, frameHeight / 2 - bar / 2, 0]} castShadow>
        <boxGeometry args={[size[0] + bar * 2, bar, frameDepth]} />
        <meshStandardMaterial color={PALETTE.honeyLight} roughness={0.32} metalness={0.72} />
      </mesh>
      <mesh position={[0, -frameHeight / 2 + bar / 2, 0]} castShadow>
        <boxGeometry args={[size[0] + bar * 2, bar, frameDepth]} />
        <meshStandardMaterial color={PALETTE.honeyLight} roughness={0.32} metalness={0.72} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * sideX, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[bar, frameHeight, frameDepth]} />
            <meshStandardMaterial color={PALETTE.honeyLight} roughness={0.32} metalness={0.72} />
          </mesh>
          <mesh position={[0, -frameHeight / 2 - 0.08, 0]} castShadow>
            <boxGeometry args={[bar * 2.4, 0.08, frameDepth * 1.8]} />
            <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.36} metalness={0.68} />
          </mesh>
        </group>
      ))}
    </group>
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
  const titlePanel = ARENA_LAYOUT.signagePanels[0];
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
      <BannerStructure position={titlePanel.position} size={titlePanel.size} />
    </group>
  );
}
