"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { PALETTE } from "./colors";
import type { MonitorLayout } from "./scene-layout";

/** A slim, widescreen broadcast display with a weighted stand and rear shell. */
export function MonitorStation({ layout }: { readonly layout: MonitorLayout }) {
  const { basePosition, screenPosition, screenSize, screenTiltX, screenRotationY, accentColor } = layout;
  const width = Math.max(screenSize[0] * 1.34, 0.78);
  const height = Math.max(screenSize[1] * 1.1, 0.44);
  const depth = Math.max(screenSize[2] * 2.2, 0.09);
  const postHeight = Math.max(0.06, screenPosition[1] - basePosition[1] - height / 2);
  const cableSide = basePosition[0] < 0 ? -1 : 1;
  const texture = useMemo(() => buildScreenTexture(accentColor), [accentColor]);
  const powerCable = useMemo(
    () => buildPowerCable(basePosition, screenPosition, depth, cableSide),
    [basePosition, cableSide, depth, screenPosition],
  );
  const signalCable = useMemo(
    () => buildSignalCable(basePosition, screenPosition, depth, cableSide),
    [basePosition, cableSide, depth, screenPosition],
  );
  const keyboardPosition: [number, number, number] = [
    basePosition[0],
    basePosition[1] + 0.065,
    basePosition[2] - 0.22,
  ];
  const grommetPosition: [number, number, number] = [
    basePosition[0] + cableSide * 0.4,
    basePosition[1] + 0.032,
    basePosition[2] + 0.24,
  ];
  const powerBrickPosition: [number, number, number] = [
    basePosition[0] + cableSide * 0.34,
    basePosition[1] + 0.055,
    basePosition[2] + 0.3,
  ];

  return (
    <group>
      <mesh position={basePosition} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.045, 0.28]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.32} metalness={0.72} />
      </mesh>
      <mesh position={[basePosition[0], basePosition[1] + 0.035 + postHeight / 2, basePosition[2]]} castShadow>
        <boxGeometry args={[0.075, postHeight, 0.075]} />
        <meshStandardMaterial color={PALETTE.walnutShadow} roughness={0.28} metalness={0.76} />
      </mesh>
      <mesh position={[basePosition[0], basePosition[1] + 0.08 + postHeight, basePosition[2] + 0.015]} castShadow>
        <boxGeometry args={[0.28, 0.045, 0.12]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.3} metalness={0.7} />
      </mesh>

      {/* The player-facing control surface: a compact keyboard and mouse pad. */}
      <group position={keyboardPosition} rotation-y={screenRotationY}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.68, 0.035, 0.25]} />
          <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.34} metalness={0.42} />
        </mesh>
        {Array.from({ length: 4 }, (_, row) => (
          <mesh key={`key-row-${row}`} position={[0, 0.021, -0.075 + row * 0.045]}>
            <boxGeometry args={[0.52 - row * 0.035, 0.012, 0.024]} />
            <meshStandardMaterial color={PALETTE.taupeMid} roughness={0.52} metalness={0.12} />
          </mesh>
        ))}
        <mesh position={[0.47, 0.018, 0.015]} castShadow>
          <boxGeometry args={[0.1, 0.028, 0.14]} />
          <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.38} metalness={0.28} />
        </mesh>
        <mesh position={[0.47, 0.034, 0.015]}>
          <boxGeometry args={[0.018, 0.008, 0.06]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.42} toneMapped={false} />
        </mesh>
      </group>

      {/* A recessed desk grommet, power adapter, and two routed cables ground
          the monitor in the furniture instead of leaving it visually floated. */}
      <mesh position={grommetPosition} rotation-x={Math.PI / 2} receiveShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.012, 12]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.48} metalness={0.3} />
      </mesh>
      <mesh position={powerBrickPosition} castShadow>
        <boxGeometry args={[0.18, 0.035, 0.07]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.6} metalness={0.12} />
      </mesh>
      <mesh geometry={powerCable} castShadow>
        <meshStandardMaterial color={PALETTE.ink} roughness={0.72} metalness={0.08} />
      </mesh>
      <mesh geometry={signalCable}>
        <meshStandardMaterial color={PALETTE.taupeMid} roughness={0.62} metalness={0.18} />
      </mesh>

      <group position={screenPosition} rotation={[screenTiltX, screenRotationY, 0]}>
        {/* Rear housing is deeper than the glass and softly inset from the bezel. */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.28} metalness={0.58} />
        </mesh>
        <mesh position={[0, 0, depth / 2 + 0.006]}>
          <boxGeometry args={[width * 0.92, height * 0.86, 0.018]} />
          <meshStandardMaterial
            map={texture}
            emissiveMap={texture}
            emissive={PALETTE.creamWarm}
            emissiveIntensity={0.42}
            roughness={0.22}
            metalness={0.05}
            toneMapped={false}
          />
        </mesh>
        {/* Thin lower bezel and status light establish a real display edge. */}
        <mesh position={[0, -height / 2 + 0.035, depth / 2 + 0.018]}>
          <boxGeometry args={[width * 0.92, 0.035, 0.025]} />
          <meshStandardMaterial color={PALETTE.walnutShadow} roughness={0.3} metalness={0.52} />
        </mesh>
        <mesh position={[width * 0.37, -height / 2 + 0.035, depth / 2 + 0.034]}>
          <sphereGeometry args={[0.012, 8, 6]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, -depth / 2 - 0.008]}>
          <boxGeometry args={[width * 0.42, height * 0.22, 0.018]} />
          <meshStandardMaterial color={PALETTE.walnut} roughness={0.56} metalness={0.34} />
        </mesh>
        {/* Rear ventilation and VESA hardware are visible in wide shots. */}
        {Array.from({ length: 5 }, (_, index) => (
          <mesh key={`vent-${index}`} position={[0, -height * 0.22 + index * 0.065, -depth / 2 - 0.02]}>
            <boxGeometry args={[width * 0.34, 0.012, 0.012]} />
            <meshStandardMaterial color={PALETTE.ink} roughness={0.7} metalness={0.18} />
          </mesh>
        ))}
        <mesh position={[0, height * 0.31, depth / 2 + 0.032]} castShadow>
          <boxGeometry args={[0.15, 0.04, 0.035]} />
          <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.3} metalness={0.62} />
        </mesh>
        <mesh position={[0, height * 0.31, depth / 2 + 0.052]}>
          <sphereGeometry args={[0.012, 8, 6]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.4} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function buildPowerCable(
  basePosition: readonly [number, number, number],
  screenPosition: readonly [number, number, number],
  depth: number,
  side: number,
): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(screenPosition[0], screenPosition[1] - 0.08, screenPosition[2] + depth / 2 + 0.02),
    new THREE.Vector3(basePosition[0] + side * 0.08, basePosition[1] + 0.08, basePosition[2] + 0.16),
    new THREE.Vector3(basePosition[0] + side * 0.28, basePosition[1] + 0.04, basePosition[2] + 0.25),
    new THREE.Vector3(basePosition[0] + side * 0.34, basePosition[1] + 0.055, basePosition[2] + 0.3),
  ]);
  return new THREE.TubeGeometry(curve, 14, 0.016, 6, false);
}

function buildSignalCable(
  basePosition: readonly [number, number, number],
  screenPosition: readonly [number, number, number],
  depth: number,
  side: number,
): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(screenPosition[0] - side * 0.18, screenPosition[1] - 0.14, screenPosition[2] + depth / 2 + 0.018),
    new THREE.Vector3(basePosition[0] - side * 0.1, basePosition[1] + 0.05, basePosition[2] + 0.19),
    new THREE.Vector3(basePosition[0] - side * 0.22, basePosition[1] + 0.025, basePosition[2] + 0.24),
  ]);
  return new THREE.TubeGeometry(curve, 12, 0.009, 5, false);
}

function buildScreenTexture(accent: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#101116";
    context.fillRect(0, 0, 320, 180);
    context.fillStyle = accent;
    context.globalAlpha = 0.82;
    context.fillRect(0, 0, 320, 12);
    context.globalAlpha = 1;
    context.fillStyle = "rgba(244, 237, 225, 0.72)";
    context.fillRect(18, 28, 112, 7);
    context.fillStyle = "rgba(244, 237, 225, 0.22)";
    for (let index = 0; index < 6; index += 1) {
      context.fillRect(18, 48 + index * 18, 168 - (index % 3) * 24, 5);
    }
    context.strokeStyle = "rgba(255,255,255,0.14)";
    context.strokeRect(214, 36, 80, 104);
    context.fillStyle = accent;
    context.globalAlpha = 0.55;
    context.fillRect(228, 58, 52, 24);
    context.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = "srgb";
  texture.needsUpdate = true;
  return texture;
}
