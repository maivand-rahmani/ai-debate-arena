"use client";

import { SeatedCharacter, type ArenaCharacterProps, type CharacterAnchorRefs } from "./arena-character";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";
import type { JudgeMood } from "@/widgets/broadcast-stage/mood";
import type { ReactionBurst } from "./character-poses";

/**
 * Judge — "The Magistrate".
 *
 * 1.2× larger presence (vertical scale), honey robe, sugar-wig wedge,
 * sterner brow set. Seated behind the central platform. Uses an extra
 * `gavelArm` ref hook through Phase C; for Phase B the arm is static.
 */
export function CharacterJudge({
  phaseOffset,
  mood,
  verdictBoost,
}: {
  readonly phaseOffset: number;
  readonly mood?: JudgeMood | undefined;
  readonly verdictBoost?: ReactionBurst | undefined;
}) {
  const props: ArenaCharacterProps = {
    position: ARENA_LAYOUT.characters.judge.position,
    headOffset: ARENA_LAYOUT.characters.judge.headOffset,
    capsuleHalfHeight: 0.55,
    scale: 1.2,
    phaseOffset,
    suitColor: PALETTE.honey,
    suitDeepColor: PALETTE.honeyDeep,
    visual: JudgeVisual,
    mood,
    verdictBoost,
  };
  return <SeatedCharacter {...props} />;
}

function JudgeVisual(refs: CharacterAnchorRefs) {
  const { headRef, mouthRef, leftBrowRef, rightBrowRef } = refs;
  return (
    <group>
      {/* Robe base — broad, sleeveless robe (honey). */}
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.78, 0.7, 0.42]} />
        <meshStandardMaterial
          color={PALETTE.honey}
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>
      {/* Robe drape front (lighter tone) */}
      <mesh position={[0, 0.42, 0.21]} rotation-x={0.04}>
        <boxGeometry args={[0.62, 0.5, 0.04]} />
        <meshStandardMaterial
          color={PALETTE.honeyLight}
          roughness={0.65}
        />
      </mesh>
      {/* Collar stripe (deep walnut) */}
      <mesh position={[0, 0.9, 0.18]}>
        <boxGeometry args={[0.5, 0.06, 0.04]} />
        <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.4} />
      </mesh>

      {/* Arms — sleeves */}
      <mesh position={[-0.4, 0.5, 0.2]} rotation-z={-0.05} castShadow>
        <boxGeometry args={[0.12, 0.4, 0.12]} />
        <meshStandardMaterial color={PALETTE.honey} roughness={0.7} />
      </mesh>
      <mesh position={[0.4, 0.5, 0.2]} rotation-z={0.05} castShadow>
        <boxGeometry args={[0.12, 0.4, 0.12]} />
        <meshStandardMaterial color={PALETTE.honey} roughness={0.7} />
      </mesh>

      {/* Hands (small cubes on top of sleeves) */}
      <mesh position={[-0.4, 0.32, 0.24]} castShadow>
        <boxGeometry args={[0.13, 0.12, 0.13]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.55} />
      </mesh>
      <mesh position={[0.4, 0.32, 0.24]} castShadow>
        <boxGeometry args={[0.13, 0.12, 0.13]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.55} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 0.98, 0]} castShadow>
        <boxGeometry args={[0.18, 0.12, 0.18]} />
        <meshStandardMaterial color={PALETTE.taupe} roughness={0.7} />
      </mesh>

      {/* Head — wider, deeper face for gravitas. */}
      <group ref={headRef}>
        <mesh position={[0, 1.28, 0]} castShadow>
          <boxGeometry args={[0.42, 0.44, 0.42]} />
          <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.55} />
        </mesh>
        {/* Sugar-wig wedge — back hair bump + crown */}
        <mesh position={[0, 1.31, -0.18]} castShadow>
          <sphereGeometry args={[0.26, 12, 8]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.5} />
        </mesh>
        {/* Crown crest */}
        <mesh position={[0, 1.55, 0]} rotation-z={0} castShadow>
          <coneGeometry args={[0.18, 0.18, 6]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.5} />
        </mesh>
        {/* Eye ridges */}
        <mesh position={[-0.085, 1.32, 0.215]}>
          <boxGeometry args={[0.07, 0.05, 0.02]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh position={[0.085, 1.32, 0.215]}>
          <boxGeometry args={[0.07, 0.05, 0.02]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        {/* Brows — stern (angled down toward center) */}
        <mesh ref={leftBrowRef} position={[-0.085, 1.39, 0.215]} rotation-z={-0.1}>
          <boxGeometry args={[0.1, 0.022, 0.022]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh ref={rightBrowRef} position={[0.085, 1.39, 0.215]} rotation-z={0.1}>
          <boxGeometry args={[0.1, 0.022, 0.022]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
      </group>

      {/* Mouth — narrower, stern */}
      <mesh ref={mouthRef} position={[0, 1.18, 0.215]}>
        <boxGeometry args={[0.14, 0.025, 0.02]} />
        <meshStandardMaterial color={PALETTE.walnutDeep} />
      </mesh>
    </group>
  );
}
