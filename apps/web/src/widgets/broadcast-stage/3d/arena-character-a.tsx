"use client";

import { SeatedCharacter, type ArenaCharacterProps, type CharacterAnchorRefs } from "./arena-character";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";
import type { ContenderMood } from "@/widgets/broadcast-stage/mood";
import type { ReactionBurst } from "./character-poses";

/** Contender A: an angular, warm-toned Challenger. */
export function CharacterContenderA({ phaseOffset, mood, verdictBoost }: {
  readonly phaseOffset: number;
  readonly mood?: ContenderMood | undefined;
  readonly verdictBoost?: ReactionBurst | undefined;
}) {
  const props: ArenaCharacterProps = {
    position: ARENA_LAYOUT.characters.A.position,
    headOffset: ARENA_LAYOUT.characters.A.headOffset,
    capsuleHalfHeight: 0.45,
    scale: 1,
    phaseOffset,
    suitColor: PALETTE.terracotta,
    suitDeepColor: PALETTE.terracottaDeep,
    visual: ContenderAVisual,
    mood,
    verdictBoost,
  };
  return <SeatedCharacter {...props} />;
}

function ContenderAVisual({ headRef, mouthRef, leftBrowRef, rightBrowRef }: CharacterAnchorRefs) {
  return (
    <group>
      {/* Tailored torso with jacket, shirt bib, lapels and tie. */}
      <mesh position={[0, 0.54, 0.02]} scale={[1.08, 1, 0.78]} castShadow receiveShadow>
        <sphereGeometry args={[0.34, 12, 8]} />
        <meshStandardMaterial color={PALETTE.terracotta} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.43, 0.17]} scale={[0.72, 0.62, 0.28]} castShadow>
        <sphereGeometry args={[0.34, 12, 8]} />
        <meshStandardMaterial color={PALETTE.terracottaDeep} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.72, 0.24]} scale={[0.42, 0.72, 0.12]}>
        <sphereGeometry args={[0.22, 10, 6]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.55} />
      </mesh>
      <mesh position={[-0.13, 0.68, 0.275]} rotation-z={-0.34} rotation-y={-0.12}>
        <boxGeometry args={[0.09, 0.38, 0.035]} />
        <meshStandardMaterial color={PALETTE.terracottaLight} roughness={0.55} />
      </mesh>
      <mesh position={[0.13, 0.68, 0.275]} rotation-z={0.34} rotation-y={0.12}>
        <boxGeometry args={[0.09, 0.38, 0.035]} />
        <meshStandardMaterial color={PALETTE.terracottaLight} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.64, 0.31]}>
        <coneGeometry args={[0.065, 0.3, 5]} />
        <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.45} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.79, 0.29]}>
        <boxGeometry args={[0.06, 0.06, 0.04]} />
        <meshStandardMaterial color={PALETTE.taupe} roughness={0.35} metalness={0.6} />
      </mesh>

      {/* Sleeves point toward the desk; cuffs and palms establish a seated pose. */}
      <mesh position={[-0.31, 0.53, 0.13]} rotation={[0.72, 0, -0.18]} castShadow>
        <capsuleGeometry args={[0.09, 0.25, 5, 10]} />
        <meshStandardMaterial color={PALETTE.terracotta} roughness={0.72} />
      </mesh>
      <mesh position={[0.31, 0.53, 0.13]} rotation={[0.72, 0, 0.18]} castShadow>
        <capsuleGeometry args={[0.09, 0.25, 5, 10]} />
        <meshStandardMaterial color={PALETTE.terracotta} roughness={0.72} />
      </mesh>
      <mesh position={[-0.29, 0.39, 0.29]} rotation={[0.72, 0, -0.18]}>
        <capsuleGeometry args={[0.052, 0.12, 4, 8]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.58} />
      </mesh>
      <mesh position={[0.29, 0.39, 0.29]} rotation={[0.72, 0, 0.18]}>
        <capsuleGeometry args={[0.052, 0.12, 4, 8]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.58} />
      </mesh>
      <mesh position={[-0.28, 0.32, 0.34]} scale={[1, 0.8, 0.78]} castShadow>
        <sphereGeometry args={[0.085, 10, 7]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.65} />
      </mesh>
      <mesh position={[0.28, 0.32, 0.34]} scale={[1, 0.8, 0.78]} castShadow>
        <sphereGeometry args={[0.085, 10, 7]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.91, 0]}>
        <cylinderGeometry args={[0.095, 0.11, 0.18, 10]} />
        <meshStandardMaterial color={PALETTE.taupe} roughness={0.72} />
      </mesh>

      <group ref={headRef}>
        {/* Angular face, ears, swept hair and sideburns. */}
        <mesh position={[0, 1.19, 0.015]} scale={[0.83, 1, 0.82]} castShadow receiveShadow>
          <sphereGeometry args={[0.27, 16, 12]} />
          <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.58} />
        </mesh>
        <mesh position={[0, 1.08, 0.03]} scale={[0.75, 0.54, 0.76]}>
          <sphereGeometry args={[0.24, 12, 8]} />
          <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.6} />
        </mesh>
        <mesh position={[-0.245, 1.19, 0]} scale={[0.5, 0.8, 0.72]}>
          <sphereGeometry args={[0.075, 10, 7]} />
          <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.62} />
        </mesh>
        <mesh position={[0.245, 1.19, 0]} scale={[0.5, 0.8, 0.72]}>
          <sphereGeometry args={[0.075, 10, 7]} />
          <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.62} />
        </mesh>
        <mesh position={[0.02, 1.4, -0.015]} scale={[1.02, 0.55, 0.9]} castShadow>
          <sphereGeometry args={[0.27, 14, 8]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.48} />
        </mesh>
        <mesh position={[0.18, 1.48, 0.015]} rotation-z={-0.25} castShadow>
          <coneGeometry args={[0.12, 0.27, 5]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.45} />
        </mesh>
        <mesh position={[-0.21, 1.3, 0.05]} scale={[0.42, 0.9, 0.6]}>
          <sphereGeometry args={[0.09, 8, 6]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.5} />
        </mesh>
        <mesh position={[0.21, 1.3, 0.05]} scale={[0.42, 0.9, 0.6]}>
          <sphereGeometry args={[0.09, 8, 6]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.5} />
        </mesh>
        {/* Eyes, pupils, nose, animated brows and animated mouth. */}
        <mesh position={[-0.095, 1.22, 0.245]} scale={[1, 0.8, 0.55]}>
          <sphereGeometry args={[0.043, 10, 7]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.35} />
        </mesh>
        <mesh position={[0.095, 1.22, 0.245]} scale={[1, 0.8, 0.55]}>
          <sphereGeometry args={[0.043, 10, 7]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.35} />
        </mesh>
        <mesh position={[-0.095, 1.22, 0.267]}><sphereGeometry args={[0.018, 8, 6]} /><meshStandardMaterial color={PALETTE.walnutDeep} /></mesh>
        <mesh position={[0.095, 1.22, 0.267]}><sphereGeometry args={[0.018, 8, 6]} /><meshStandardMaterial color={PALETTE.walnutDeep} /></mesh>
        <mesh position={[0, 1.155, 0.255]} rotation-x={-0.18}><coneGeometry args={[0.035, 0.11, 6]} /><meshStandardMaterial color={PALETTE.taupeMid} roughness={0.65} /></mesh>
        <mesh ref={leftBrowRef} position={[-0.095, 1.28, 0.25]} rotation-z={-0.08}><capsuleGeometry args={[0.014, 0.075, 4, 7]} /><meshStandardMaterial color={PALETTE.walnutDeep} /></mesh>
        <mesh ref={rightBrowRef} position={[0.095, 1.28, 0.25]} rotation-z={0.08}><capsuleGeometry args={[0.014, 0.075, 4, 7]} /><meshStandardMaterial color={PALETTE.walnutDeep} /></mesh>
        <mesh ref={mouthRef} position={[0, 1.085, 0.255]} scale={[1, 0.65, 0.5]}><torusGeometry args={[0.052, 0.012, 6, 12, Math.PI]} /><meshStandardMaterial color={PALETTE.walnutDeep} /></mesh>
      </group>
    </group>
  );
}
