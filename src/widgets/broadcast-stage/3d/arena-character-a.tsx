"use client";

import { SeatedCharacter, type ArenaCharacterProps, type CharacterAnchorRefs } from "./arena-character";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";
import type { ContenderMood } from "@/widgets/broadcast-stage/mood";
import type { ReactionBurst } from "./character-poses";

/**
 * Contender A (Terracotta — "The Challenger").
 *
 * Angular silhouette: square jaw, sharp wedge hair, terracotta suit
 * jacket, terracotta tie. Seated behind desk A.
 */
export function CharacterContenderA({
  phaseOffset,
  mood,
  verdictBoost,
}: {
  readonly phaseOffset: number;
  readonly mood?: ContenderMood | undefined;
  readonly verdictBoost?: ReactionBurst | undefined;
}) {
  const props: ArenaCharacterProps = {
    position: ARENA_LAYOUT.characters.A.position,
    headOffset: ARENA_LAYOUT.characters.A.headOffset,
    capsuleHalfHeight: 0.45,
    scale: 1.0,
    phaseOffset,
    suitColor: PALETTE.terracotta,
    suitDeepColor: PALETTE.terracottaDeep,
    visual: ContenderAVisual,
    mood,
    verdictBoost,
  };
  return <SeatedCharacter {...props} />;
}

function ContenderAVisual(refs: CharacterAnchorRefs) {
  const { headRef, mouthRef, leftBrowRef, rightBrowRef } = refs;
  // Local coords; Y=0 at seat, Y≈1.4 at top of head.
  return (
    <group>
      {/* Torso — angular suit jacket */}
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.55, 0.35]} />
        <meshStandardMaterial
          color={PALETTE.terracotta}
          roughness={0.65}
          metalness={0.05}
        />
      </mesh>
      {/* Lapel block (deeper tone for contrast) */}
      <mesh position={[0, 0.6, 0.18]} rotation-x={0.05}>
        <boxGeometry args={[0.5, 0.5, 0.04]} />
        <meshStandardMaterial color={PALETTE.terracottaDeep} roughness={0.6} />
      </mesh>
      {/* Collar / white shirt strip */}
      <mesh position={[0, 0.83, 0.155]}>
        <boxGeometry args={[0.18, 0.08, 0.04]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.5} />
      </mesh>
      {/* Tie — long wedge, terracotta accent */}
      <mesh position={[0, 0.65, 0.2]}>
        <coneGeometry args={[0.05, 0.4, 4]} />
        <meshStandardMaterial
          color={PALETTE.terracottaDeep}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>

      {/* Arms — cuffs resting on desk */}
      <mesh position={[-0.32, 0.45, 0.18]} rotation-z={-0.1} castShadow>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color={PALETTE.terracotta} roughness={0.65} />
      </mesh>
      <mesh position={[0.32, 0.45, 0.18]} rotation-z={0.1} castShadow>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color={PALETTE.terracotta} roughness={0.65} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 0.92, 0]} castShadow>
        <boxGeometry args={[0.16, 0.14, 0.16]} />
        <meshStandardMaterial color={PALETTE.taupe} roughness={0.7} />
      </mesh>

      {/* Head — angular jaw, square cuboid head, sharp wedge hair */}
      <group ref={headRef}>
        <mesh position={[0, 1.18, 0]} castShadow>
          <boxGeometry args={[0.4, 0.42, 0.4]} />
          <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.55} />
        </mesh>
        <mesh position={[0.05, 1.42, 0]} rotation-z={-0.05} castShadow>
          <coneGeometry args={[0.18, 0.3, 4]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.5} />
        </mesh>
        {/* Eye ridges */}
        <mesh position={[-0.075, 1.22, 0.205]}>
          <boxGeometry args={[0.06, 0.04, 0.02]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh position={[0.075, 1.22, 0.205]}>
          <boxGeometry args={[0.06, 0.04, 0.02]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        {/* Brows (animated for idle sway) */}
        <mesh ref={leftBrowRef} position={[-0.075, 1.28, 0.205]}>
          <boxGeometry args={[0.08, 0.02, 0.02]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh ref={rightBrowRef} position={[0.075, 1.28, 0.205]}>
          <boxGeometry args={[0.08, 0.02, 0.02]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
      </group>

      {/* Mouth (animated for blink) */}
      <mesh ref={mouthRef} position={[0, 1.08, 0.205]}>
        <boxGeometry args={[0.16, 0.04, 0.02]} />
        <meshStandardMaterial color={PALETTE.walnutDeep} />
      </mesh>
    </group>
  );
}
