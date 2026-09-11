"use client";

import { SeatedCharacter, type ArenaCharacterProps, type CharacterAnchorRefs } from "./arena-character";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";
import type { ContenderMood } from "@/widgets/broadcast-stage/mood";
import type { ReactionBurst } from "./character-poses";

/** Contender B: a softer, rounder plum-clad advocate. */
export function CharacterContenderB({
  phaseOffset,
  mood,
  verdictBoost,
}: {
  readonly phaseOffset: number;
  readonly mood?: ContenderMood | undefined;
  readonly verdictBoost?: ReactionBurst | undefined;
}) {
  const props: ArenaCharacterProps = {
    position: ARENA_LAYOUT.characters.B.position,
    headOffset: ARENA_LAYOUT.characters.B.headOffset,
    capsuleHalfHeight: 0.45,
    scale: 1,
    phaseOffset,
    suitColor: PALETTE.plum,
    suitDeepColor: PALETTE.plumDeep,
    visual: ContenderBVisual,
    mood,
    verdictBoost,
  };
  return <SeatedCharacter {...props} />;
}

function ContenderBVisual({ headRef, mouthRef, leftBrowRef, rightBrowRef }: CharacterAnchorRefs) {
  return (
    <group>
      <mesh position={[0, 0.54, 0.02]} scale={[1.04, 1, 0.82]} castShadow receiveShadow>
        <sphereGeometry args={[0.34, 14, 10]} />
        <meshStandardMaterial color={PALETTE.plum} roughness={0.66} />
      </mesh>
      <mesh position={[0, 0.4, 0.16]} scale={[0.8, 0.42, 0.52]} castShadow>
        <sphereGeometry args={[0.3, 12, 8]} />
        <meshStandardMaterial color={PALETTE.plumDeep} roughness={0.72} />
      </mesh>

      {/* Soft shirt front and bow tie establish the host wardrobe. */}
      <mesh position={[0, 0.71, 0.25]} scale={[0.42, 0.7, 0.14]}>
        <sphereGeometry args={[0.2, 10, 8]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.54} />
      </mesh>
      <mesh position={[-0.12, 0.79, 0.31]} rotation-z={-0.28}>
        <boxGeometry args={[0.12, 0.2, 0.035]} />
        <meshStandardMaterial color={PALETTE.plumLight} roughness={0.5} />
      </mesh>
      <mesh position={[0.12, 0.79, 0.31]} rotation-z={0.28}>
        <boxGeometry args={[0.12, 0.2, 0.035]} />
        <meshStandardMaterial color={PALETTE.plumLight} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.79, 0.33]}>
        <sphereGeometry args={[0.055, 10, 8]} />
        <meshStandardMaterial color={PALETTE.honeyLight} roughness={0.34} metalness={0.52} />
      </mesh>

      <mesh position={[-0.3, 0.52, 0.14]} rotation={[0.72, 0, -0.16]} castShadow>
        <capsuleGeometry args={[0.09, 0.25, 5, 10]} />
        <meshStandardMaterial color={PALETTE.plum} roughness={0.68} />
      </mesh>
      <mesh position={[0.3, 0.52, 0.14]} rotation={[0.72, 0, 0.16]} castShadow>
        <capsuleGeometry args={[0.09, 0.25, 5, 10]} />
        <meshStandardMaterial color={PALETTE.plum} roughness={0.68} />
      </mesh>
      <mesh position={[-0.29, 0.36, 0.3]} rotation={[0.72, 0, -0.16]}>
        <capsuleGeometry args={[0.05, 0.13, 4, 8]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.58} />
      </mesh>
      <mesh position={[0.29, 0.36, 0.3]} rotation={[0.72, 0, 0.16]}>
        <capsuleGeometry args={[0.05, 0.13, 4, 8]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.58} />
      </mesh>

      <mesh position={[0, 0.91, 0]}>
        <cylinderGeometry args={[0.095, 0.11, 0.18, 10]} />
        <meshStandardMaterial color={PALETTE.taupe} roughness={0.7} />
      </mesh>
      <group ref={headRef}>
        <mesh position={[0, 1.19, 0.02]} scale={[0.98, 1, 0.9]} castShadow receiveShadow>
          <sphereGeometry args={[0.275, 16, 12]} />
          <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.56} />
        </mesh>
        {/* Curly silhouette, kept as a single visual cluster rather than a box cap. */}
        {[
          [-0.16, 1.38, -0.02],
          [0, 1.45, -0.05],
          [0.16, 1.39, -0.02],
          [-0.22, 1.29, 0.02],
          [0.22, 1.29, 0.02],
        ].map(([x, y, z], index) => (
          <mesh key={`curl-${index}`} position={[x, y, z]} castShadow>
            <sphereGeometry args={[0.115, 10, 8]} />
            <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.48} />
          </mesh>
        ))}
        <mesh position={[-0.1, 1.22, 0.255]}>
          <sphereGeometry args={[0.05, 10, 8]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.3} />
        </mesh>
        <mesh position={[0.1, 1.22, 0.255]}>
          <sphereGeometry args={[0.05, 10, 8]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.3} />
        </mesh>
        <mesh position={[-0.1, 1.22, 0.28]}>
          <sphereGeometry args={[0.018, 8, 6]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh position={[0.1, 1.22, 0.28]}>
          <sphereGeometry args={[0.018, 8, 6]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh position={[-0.1, 1.22, 0.3]}>
          <torusGeometry args={[0.07, 0.012, 8, 18]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} metalness={0.45} roughness={0.32} />
        </mesh>
        <mesh position={[0.1, 1.22, 0.3]}>
          <torusGeometry args={[0.07, 0.012, 8, 18]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} metalness={0.45} roughness={0.32} />
        </mesh>
        <mesh position={[0, 1.22, 0.3]}>
          <boxGeometry args={[0.08, 0.012, 0.012]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh ref={leftBrowRef} position={[-0.1, 1.29, 0.29]} rotation-z={-0.06}>
          <capsuleGeometry args={[0.014, 0.075, 4, 7]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh ref={rightBrowRef} position={[0.1, 1.29, 0.29]} rotation-z={0.06}>
          <capsuleGeometry args={[0.014, 0.075, 4, 7]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh position={[0, 1.14, 0.275]} rotation-x={-0.18}>
          <coneGeometry args={[0.035, 0.11, 6]} />
          <meshStandardMaterial color={PALETTE.taupeMid} roughness={0.62} />
        </mesh>
      </group>
      <mesh ref={mouthRef} position={[0, 1.08, 0.29]} scale={[1, 0.7, 0.6]}>
        <torusGeometry args={[0.052, 0.012, 6, 14, Math.PI]} />
        <meshStandardMaterial color={PALETTE.walnutDeep} />
      </mesh>
    </group>
  );
}
