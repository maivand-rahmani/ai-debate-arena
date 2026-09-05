"use client";

import { SeatedCharacter, type ArenaCharacterProps, type CharacterAnchorRefs } from "./arena-character";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";
import type { ContenderMood } from "@/widgets/broadcast-stage/mood";
import type { ReactionBurst } from "./character-poses";

/**
 * Contender B (Plum — "The Advocate").
 *
 * Rounder silhouette: rounder head, muted plum suit jacket, bowtie + curls,
 * round glasses silhouette. Seated behind desk B.
 */
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
    scale: 1.0,
    phaseOffset,
    suitColor: PALETTE.plum,
    suitDeepColor: PALETTE.plumDeep,
    visual: ContenderBVisual,
    mood,
    verdictBoost,
  };
  return <SeatedCharacter {...props} />;
}

function ContenderBVisual(refs: CharacterAnchorRefs) {
  const { headRef, mouthRef, leftBrowRef, rightBrowRef } = refs;
  return (
    <group>
      {/* Torso — softer + rounder jacket (slightly tapered via double-box). */}
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.58, 0.5, 0.32]} />
        <meshStandardMaterial
          color={PALETTE.plum}
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>
      {/* Lower torso — accent piece giving the jacket a curve */}
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.16, 0.28]} />
        <meshStandardMaterial color={PALETTE.plumDeep} roughness={0.6} />
      </mesh>

      {/* Bowtie (front) — cream + plum */}
      <mesh position={[0, 0.83, 0.165]}>
        <boxGeometry args={[0.22, 0.06, 0.04]} />
        <meshStandardMaterial color={PALETTE.plumDeep} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.83, 0.18]}>
        <boxGeometry args={[0.04, 0.04, 0.04]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.4} />
      </mesh>

      {/* Arms — rounder cuffs resting on desk */}
      <mesh position={[-0.3, 0.45, 0.18]} rotation-z={-0.1} castShadow>
        <sphereGeometry args={[0.08, 6, 4]} />
        <meshStandardMaterial color={PALETTE.plum} roughness={0.7} />
      </mesh>
      <mesh position={[0.3, 0.45, 0.18]} rotation-z={0.1} castShadow>
        <sphereGeometry args={[0.08, 6, 4]} />
        <meshStandardMaterial color={PALETTE.plum} roughness={0.7} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 0.92, 0]} castShadow>
        <boxGeometry args={[0.16, 0.14, 0.16]} />
        <meshStandardMaterial color={PALETTE.taupe} roughness={0.7} />
      </mesh>

      {/* Head — rounder (slightly larger), cream parchment-toned face. */}
      <group ref={headRef}>
        <mesh position={[0, 1.18, 0]} castShadow>
          <sphereGeometry args={[0.27, 12, 10]} />
          <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.55} />
        </mesh>
        {/* Curly hair — cluster of small spheres */}
        {[
          [-0.13, 0.07],
          [0.05, 0.1],
          [0.16, 0.05],
          [-0.16, -0.04],
          [0.0, 0.12],
        ].map(([dx, dy], i) => (
          <mesh
            key={`curl-${i}`}
            position={[dx, 1.34 + dy, -0.02]}
            castShadow
          >
            <sphereGeometry args={[0.11, 8, 6]} />
            <meshStandardMaterial color={PALETTE.walnutDeep} roughness={0.55} />
          </mesh>
        ))}
        {/* Round glasses */}
        <mesh position={[-0.09, 1.2, 0.235]}>
          <torusGeometry args={[0.07, 0.012, 8, 16]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh position={[0.09, 1.2, 0.235]}>
          <torusGeometry args={[0.07, 0.012, 8, 16]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh position={[0, 1.2, 0.235]}>
          <boxGeometry args={[0.07, 0.012, 0.012]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        {/* Brows */}
        <mesh ref={leftBrowRef} position={[-0.09, 1.28, 0.235]}>
          <boxGeometry args={[0.07, 0.018, 0.018]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh ref={rightBrowRef} position={[0.09, 1.28, 0.235]}>
          <boxGeometry args={[0.07, 0.018, 0.018]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
      </group>

      {/* Mouth (animated for blink). Rounder than contender A to match persona. */}
      <mesh ref={mouthRef} position={[0, 1.07, 0.245]}>
        <sphereGeometry args={[0.06, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={PALETTE.walnutDeep} />
      </mesh>
    </group>
  );
}