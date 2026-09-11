"use client";

import { type ReactNode } from "react";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { PALETTE } from "./colors";
import type { DeskLayout } from "./scene-layout";

type Vec3 = readonly [number, number, number];

function BevelledBox({
  position,
  size,
  color,
  bevel = 0.04,
  castShadow = true,
  receiveShadow = true,
}: {
  readonly position: Vec3;
  readonly size: Vec3;
  readonly color: string;
  readonly bevel?: number;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}) {
  const inset = Math.min(bevel, size[0] / 8, size[1] / 3, size[2] / 8);
  return (
    <group>
      <mesh position={position} castShadow={castShadow} receiveShadow={receiveShadow}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.58} metalness={0.16} />
      </mesh>
      <mesh
        position={[position[0], position[1] + size[1] / 2 + inset * 0.18, position[2]]}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
      >
        <boxGeometry args={[size[0] - inset * 2, inset * 0.36, size[2] - inset * 2]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.42} metalness={0.22} />
      </mesh>
    </group>
  );
}

/** Premium broadcast workstation shell. The collider remains a thin desk-top
 * box so dynamic props never interact with decorative fascia geometry. */
export function ArenaDesk({ layout, children }: { readonly layout: DeskLayout; readonly children?: ReactNode }) {
  const { position, topSize, baseSize, accentColor, accentGlowColor, faceCameraRotationY } = layout;
  const topY = position[1];
  const baseY = position[1] - topSize[1] / 2 - baseSize[1] / 2;
  const frontZ = baseSize[2] / 2 + 0.025;
  const fasciaHeight = Math.max(0.34, baseSize[1] * 0.58);

  return (
    <group position={[position[0], 0, position[2]]} rotation={[0, faceCameraRotationY, 0]}>
      <BevelledBox position={[0, baseY, 0]} size={baseSize} color={PALETTE.walnut} bevel={0.08} />

      {/* Recessed front fascia: a dark panel, metal surround, and restrained identity light. */}
      <mesh position={[0, baseY + 0.02, frontZ]} castShadow>
        <boxGeometry args={[baseSize[0] * 0.78, fasciaHeight, 0.035]} />
        <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.46} metalness={0.42} />
      </mesh>
      <mesh position={[0, baseY + 0.02, frontZ + 0.022]}>
        <boxGeometry args={[baseSize[0] * 0.68, 0.035, 0.018]} />
        <meshStandardMaterial color={accentGlowColor} emissive={accentColor} emissiveIntensity={0.42} roughness={0.32} metalness={0.55} toneMapped={false} />
      </mesh>
      <mesh position={[-baseSize[0] * 0.39, baseY + 0.02, frontZ]}>
        <boxGeometry args={[0.025, fasciaHeight * 0.72, 0.055]} />
        <meshStandardMaterial color={PALETTE.taupeMid} roughness={0.34} metalness={0.65} />
      </mesh>
      <mesh position={[baseSize[0] * 0.39, baseY + 0.02, frontZ]}>
        <boxGeometry args={[0.025, fasciaHeight * 0.72, 0.055]} />
        <meshStandardMaterial color={PALETTE.taupeMid} roughness={0.34} metalness={0.65} />
      </mesh>

      {/* Heavy top with a thin contrasting work-surface insert. */}
      <BevelledBox position={[0, topY - topSize[1] * 0.08, 0]} size={topSize} color={PALETTE.walnutShadow} bevel={0.055} />
      <mesh position={[0, topY + topSize[1] / 2 + 0.012, 0]} receiveShadow>
        <boxGeometry args={[topSize[0] * 0.88, 0.026, topSize[2] * 0.76]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.42} metalness={0.18} />
      </mesh>
      <mesh position={[0, topY + topSize[1] / 2 + 0.029, topSize[2] * 0.39]}>
        <boxGeometry args={[topSize[0] * 0.74, 0.018, 0.018]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.32} roughness={0.3} metalness={0.55} toneMapped={false} />
      </mesh>

      {/* Feet and side reveals make the base read as furniture instead of a box. */}
      <mesh position={[-baseSize[0] * 0.35, baseY - baseSize[1] / 2 - 0.06, 0]} castShadow>
        <boxGeometry args={[0.14, 0.12, baseSize[2] * 0.74]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.38} metalness={0.62} />
      </mesh>
      <mesh position={[baseSize[0] * 0.35, baseY - baseSize[1] / 2 - 0.06, 0]} castShadow>
        <boxGeometry args={[0.14, 0.12, baseSize[2] * 0.74]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.38} metalness={0.62} />
      </mesh>

      {children ? <group>{children}</group> : null}
    </group>
  );
}

export function ArenaDeskCollider({ layout }: { readonly layout: DeskLayout }) {
  const { position, topSize, faceCameraRotationY } = layout;
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider
        args={[topSize[0] / 2, Math.max(0.02, topSize[1] / 2), topSize[2] / 2]}
        position={[position[0], position[1], position[2]]}
        rotation={[0, faceCameraRotationY, 0]}
      />
    </RigidBody>
  );
}

/** Padded studio chair visual. The original single-volume collider is retained
 * so props remain stable while the furniture gains a believable pedestal base. */
export function ArenaChair({
  position,
  backRest,
  floorY = 0,
  accentColor,
}: {
  readonly position: Vec3;
  readonly backRest: Vec3;
  readonly floorY?: number;
  readonly accentColor?: string;
}) {
  const seatSize: Vec3 = [0.82, 0.12, 0.82];
  const seatBottomY = position[1] - seatSize[1] / 2;
  const effectiveLegHeight = Math.max(0.02, seatBottomY - floorY);
  const legCenterY = (seatBottomY + floorY) / 2;
  const upholstery = accentColor ? PALETTE.walnutShadow : PALETTE.walnut;
  const hardware = accentColor ?? PALETTE.walnutBlackened;
  const casters = [
    [-0.22, -0.16],
    [0.22, -0.16],
    [-0.22, 0.16],
    [0.22, 0.16],
  ] as const;

  return (
    <group>
      <BevelledBox position={position} size={seatSize} color={upholstery} bevel={0.07} />
      <mesh position={[position[0], position[1] + seatSize[1] / 2 + 0.035, position[2]]}>
        <boxGeometry args={[seatSize[0] * 0.72, 0.035, seatSize[2] * 0.68]} />
        <meshStandardMaterial color={accentColor ? PALETTE.honeyDeep : PALETTE.walnutShadow} roughness={0.68} metalness={0.08} />
      </mesh>

      <BevelledBox
        position={[position[0], position[1] + backRest[1] / 2 + 0.04, position[2] - seatSize[2] / 2 + backRest[2] / 2]}
        size={[backRest[0], backRest[1], backRest[2]]}
        color={upholstery}
        bevel={0.08}
      />
      <mesh position={[position[0], position[1] + backRest[1] + 0.06, position[2] - seatSize[2] / 2 + backRest[2] / 2]}>
        <boxGeometry args={[backRest[0] * 0.62, 0.05, 0.035]} />
        <meshStandardMaterial color={accentColor ?? PALETTE.taupeMid} emissive={accentColor} emissiveIntensity={accentColor ? 0.2 : 0} roughness={0.4} metalness={0.58} />
      </mesh>

      {/* Arm caps and central gas-lift column. */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[position[0] + side * (seatSize[0] / 2 + 0.045), position[1] + 0.16, position[2] - 0.02]} castShadow>
            <boxGeometry args={[0.07, 0.07, 0.48]} />
            <meshStandardMaterial color={hardware} roughness={0.42} metalness={0.6} />
          </mesh>
          <mesh position={[position[0] + side * (seatSize[0] / 2 + 0.045), position[1] + 0.11, position[2] - 0.02]}>
            <boxGeometry args={[0.055, 0.025, 0.44]} />
            <meshStandardMaterial color={upholstery} roughness={0.62} metalness={0.1} />
          </mesh>
        </group>
      ))}
      <mesh position={[position[0], legCenterY, position[2]]} castShadow>
        <cylinderGeometry args={[0.065, 0.095, effectiveLegHeight, 12]} />
        <meshStandardMaterial color={hardware} roughness={0.28} metalness={0.76} />
      </mesh>
      <mesh position={[position[0], floorY + 0.035, position[2]]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.07, 16]} />
        <meshStandardMaterial color={hardware} roughness={0.3} metalness={0.72} />
      </mesh>
      {casters.map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[position[0] + x, floorY + 0.015, position[2] + z]} castShadow>
          <sphereGeometry args={[0.055, 8, 6]} />
          <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.3} metalness={0.55} />
        </mesh>
      ))}

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[backRest[0] / 2 + 0.05, position[1] / 2, seatSize[2] / 2]}
          position={[position[0], position[1] / 2, position[2]]}
        />
      </RigidBody>
    </group>
  );
}
