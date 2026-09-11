"use client";

import { SeatedCharacter, type ArenaCharacterProps, type CharacterAnchorRefs } from "./arena-character";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT } from "./scene-layout";
import type { JudgeMood } from "@/widgets/broadcast-stage/mood";
import type { ReactionBurst } from "./character-poses";

/** The Judge: a broad, seated magistrate silhouette with a honey robe. */
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

function JudgeVisual({ headRef, mouthRef, leftBrowRef, rightBrowRef }: CharacterAnchorRefs) {
  return (
    <group>
      {/* Layered robe and stole give the Judge a strong central silhouette. */}
      <mesh position={[0, 0.55, 0.02]} scale={[1.1, 1, 0.78]} castShadow receiveShadow>
        <sphereGeometry args={[0.4, 16, 10]} />
        <meshStandardMaterial color={PALETTE.honeyDeep} roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.58, 0.22]} scale={[0.72, 0.92, 0.18]} castShadow>
        <sphereGeometry args={[0.32, 14, 10]} />
        <meshStandardMaterial color={PALETTE.honey} roughness={0.62} />
      </mesh>
      <mesh position={[0, 0.73, 0.32]} rotation-x={0.06}>
        <boxGeometry args={[0.13, 0.55, 0.035]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.93, 0.34]}>
        <torusGeometry args={[0.19, 0.035, 8, 20]} />
        <meshStandardMaterial color={PALETTE.honeyLight} emissive={PALETTE.honeyGlow} emissiveIntensity={0.18} metalness={0.45} roughness={0.34} />
      </mesh>

      <mesh position={[-0.4, 0.52, 0.17]} rotation={[0.65, 0, -0.12]} castShadow>
        <capsuleGeometry args={[0.11, 0.3, 5, 10]} />
        <meshStandardMaterial color={PALETTE.honey} roughness={0.68} />
      </mesh>
      <mesh position={[0.4, 0.52, 0.17]} rotation={[0.65, 0, 0.12]} castShadow>
        <capsuleGeometry args={[0.11, 0.3, 5, 10]} />
        <meshStandardMaterial color={PALETTE.honey} roughness={0.68} />
      </mesh>
      <mesh position={[-0.39, 0.33, 0.31]} rotation={[0.65, 0, -0.12]} castShadow>
        <sphereGeometry args={[0.085, 10, 8]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.56} />
      </mesh>
      <mesh position={[0.39, 0.33, 0.31]} rotation={[0.65, 0, 0.12]} castShadow>
        <sphereGeometry args={[0.085, 10, 8]} />
        <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.56} />
      </mesh>
      <mesh position={[0, 0.98, 0]}>
        <cylinderGeometry args={[0.12, 0.14, 0.18, 12]} />
        <meshStandardMaterial color={PALETTE.taupe} roughness={0.68} />
      </mesh>

      <group ref={headRef}>
        <mesh position={[0, 1.28, 0.02]} scale={[1.02, 1.04, 0.94]} castShadow receiveShadow>
          <sphereGeometry args={[0.31, 18, 14]} />
          <meshStandardMaterial color={PALETTE.creamWarm} roughness={0.54} />
        </mesh>
        {/* Hair and powdered side curls make the Judge immediately distinct. */}
        <mesh position={[0, 1.49, -0.02]} scale={[1.1, 0.5, 0.9]} castShadow>
          <sphereGeometry args={[0.28, 16, 10]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.42} />
        </mesh>
        {[-0.24, 0.24].map((x) => (
          <mesh key={x} position={[x, 1.35, 0.02]} castShadow>
            <sphereGeometry args={[0.105, 10, 8]} />
            <meshStandardMaterial color={PALETTE.cream} roughness={0.42} />
          </mesh>
        ))}
        <mesh position={[-0.11, 1.3, 0.28]}>
          <sphereGeometry args={[0.05, 10, 8]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.28} />
        </mesh>
        <mesh position={[0.11, 1.3, 0.28]}>
          <sphereGeometry args={[0.05, 10, 8]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.28} />
        </mesh>
        <mesh position={[-0.11, 1.3, 0.31]}>
          <sphereGeometry args={[0.018, 8, 6]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh position={[0.11, 1.3, 0.31]}>
          <sphereGeometry args={[0.018, 8, 6]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh ref={leftBrowRef} position={[-0.11, 1.39, 0.3]} rotation-z={-0.16}>
          <capsuleGeometry args={[0.016, 0.09, 4, 8]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh ref={rightBrowRef} position={[0.11, 1.39, 0.3]} rotation-z={0.16}>
          <capsuleGeometry args={[0.016, 0.09, 4, 8]} />
          <meshStandardMaterial color={PALETTE.walnutDeep} />
        </mesh>
        <mesh position={[0, 1.22, 0.285]} rotation-x={-0.18}>
          <coneGeometry args={[0.04, 0.12, 6]} />
          <meshStandardMaterial color={PALETTE.taupeMid} roughness={0.6} />
        </mesh>
      </group>
      <mesh ref={mouthRef} position={[0, 1.17, 0.3]} scale={[1, 0.5, 0.5]}>
        <boxGeometry args={[0.15, 0.028, 0.022]} />
        <meshStandardMaterial color={PALETTE.walnutDeep} />
      </mesh>

      {/* Visible lower robe and shoes anchor the seated pose on the platform. */}
      <mesh position={[0, -0.1, 0.04]} scale={[1.02, 1, 0.7]} castShadow receiveShadow>
        <sphereGeometry args={[0.38, 14, 10]} />
        <meshStandardMaterial color={PALETTE.honeyDeep} roughness={0.76} />
      </mesh>
      <mesh position={[0, -0.12, 0.27]} rotation-x={0.05}>
        <boxGeometry args={[0.64, 0.64, 0.045]} />
        <meshStandardMaterial color={PALETTE.honey} roughness={0.68} />
      </mesh>
      {[-0.18, 0.18].map((x) => (
        <mesh key={x} position={[x, -0.44, 0.2]} castShadow>
          <capsuleGeometry args={[0.09, 0.18, 5, 8]} />
          <meshStandardMaterial color={PALETTE.walnutShadow} roughness={0.45} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}
