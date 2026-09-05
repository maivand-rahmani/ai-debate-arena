"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { PALETTE } from "./colors";
import type { MonitorLayout } from "./scene-layout";

/**
 * The 3D broadcast-monitor workstation that sits centered on each contender's
 * desk. Reads as a small flat-screen display + post + base, with a honey or
 * accent emissive glow on the screen so it reads as "switched on" without
 * needing a live texture. The screen tilts back and rotates slightly toward
 * the camera so it's partially visible to the audience.
 *
 * Visual breakdown (all meshes rendered in desk-local coords):
 *   - Base plate (rests on desk top)
 *   - Vertical post
 *   - Screen frame (slightly oversized slab)
 *   - Screen face (emissive panel)
 *   - Honey LED dot
 */
export function MonitorStation({ layout }: { readonly layout: MonitorLayout }) {
  const {
    basePosition,
    screenPosition,
    screenSize,
    screenTiltX,
    screenRotationY,
    accentColor,
  } = layout;

  // Screen texture: a procedural pattern of subtle scanlines + a center
  // accent rectangle, so the screen reads as "displaying content" without
  // pulling a live network signal.
  const texture = useMemo(() => buildScreenTexture(accentColor), [accentColor]);

  return (
    <group>
      {/* Base plate on the desk */}
      <mesh position={basePosition} castShadow receiveShadow>
        <boxGeometry args={[0.26, 0.04, 0.18]} />
        <meshStandardMaterial
          color={PALETTE.walnutDeep}
          roughness={0.55}
          metalness={0.2}
        />
      </mesh>

      {/* Vertical post */}
      <mesh
        position={[
          basePosition[0],
          basePosition[1] + 0.04 + (screenPosition[1] - basePosition[1] - screenSize[1] / 2) / 2,
          basePosition[2],
        ]}
        castShadow
      >
        <boxGeometry
          args={[
            0.06,
            Math.max(0.05, screenPosition[1] - basePosition[1] - screenSize[1] / 2),
            0.06,
          ]}
        />
        <meshStandardMaterial
          color={PALETTE.walnutShadow}
          roughness={0.5}
          metalness={0.3}
        />
      </mesh>

      {/* Screen assembly (frame + emissive face). Group tilt + spin so the
          screen faces the talent and reads as a workstation monitor. */}
      <group
        position={screenPosition}
        rotation={[screenTiltX, screenRotationY, 0]}
      >
        {/* Outer bezel */}
        <mesh castShadow>
          <boxGeometry args={[screenSize[0], screenSize[1], screenSize[2]]} />
          <meshStandardMaterial
            color={PALETTE.walnutShadow}
            roughness={0.4}
            metalness={0.3}
          />
        </mesh>
        {/* Emissive face inset just in front of the bezel */}
        <mesh position={[0, 0, screenSize[2] / 2 + 0.005]}>
          <planeGeometry args={[screenSize[0] * 0.92, screenSize[1] * 0.85]} />
          <meshStandardMaterial
            map={texture}
            emissiveMap={texture}
            emissive={PALETTE.creamWarm}
            emissiveIntensity={0.85}
            roughness={0.3}
            metalness={0.0}
            toneMapped={false}
            side={THREE.FrontSide}
          />
        </mesh>
        {/* Honey LED dot at the bottom edge of the bezel */}
        <mesh position={[0, -screenSize[1] / 2 + 0.03, screenSize[2] / 2 + 0.006]}>
          <sphereGeometry args={[0.012, 8, 6]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={1.4}
            roughness={0.3}
            metalness={0.2}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Build a small canvas-backed texture for the monitor screen so each desk has
 * a "lit" display without external image assets. Renders scanlines, a thin
 * header strip, and a stack of dimmed bars that read as text rows.
 */
function buildScreenTexture(accent: string): THREE.CanvasTexture {
  const w = 256;
  const h = 168;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // Backdrop — deep ink with a faint warm tint so the screen reads "on".
    ctx.fillStyle = "#0c0a07";
    ctx.fillRect(0, 0, w, h);

    // Accent header strip across the top.
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(0, 0, w, 14);
    ctx.globalAlpha = 1;

    // Horizontal scanlines for the warm CRT vibe.
    ctx.fillStyle = "rgba(255, 220, 180, 0.06)";
    for (let y = 14; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }

    // Faux "content" rows — dimmed warm bars of varying width.
    ctx.fillStyle = "rgba(244, 237, 225, 0.55)";
    const rowHeights = [8, 6, 6, 6, 6, 6, 6, 6, 6, 6];
    const widths = [180, 150, 200, 130, 170, 160, 140, 190, 120, 110];
    let cy = 28;
    for (let i = 0; i < rowHeights.length; i++) {
      ctx.fillRect(14, cy, widths[i], rowHeights[i]);
      cy += rowHeights[i] + 6;
      if (cy > h - 12) break;
    }

    // Faint vignette
    const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = "srgb";
  texture.needsUpdate = true;
  return texture;
}
