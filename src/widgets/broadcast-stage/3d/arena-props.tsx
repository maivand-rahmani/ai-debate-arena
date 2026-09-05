"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { RigidBody, CuboidCollider, type RapierRigidBody } from "@react-three/rapier";
import { PALETTE } from "./colors";
import { ARENA_LAYOUT, PROP_MASS } from "./scene-layout";
import {
  CONFETTI_BURST_COUNT,
  CONFETTI_POOL_SIZE,
  CONFETTI_DEFAULT_SIZE,
  VERDICT_TIMING,
  planConfettiBurst,
  type ConfettiSpawn,
} from "./confetti";

/**
 * Imperative handles for in-scene props that the VerdictDirector drives
 * when a fresh verdict lands. Both interfaces are pure (no React) so the
 * scene-tree side can pass them around as refs cleanly.
 */
export interface GavelHandle {
  /** Apply the verdict strike impulse + spin on the gavel rigid body. */
  strike(): void;
}

export interface ConfettiHandle {
  /**
   * Release a confetti burst over the given winner's side. If `reducedMotion`
   * is true the burst is suppressed — pieces stay hidden under the stage.
   */
  burst(winner: "A" | "B" | "DRAW", reducedMotion: boolean): void;
  /** Hide all currently-flying pieces immediately. */
  reset(): void;
}

/**
 * The opaque bundle the scene tree gets once {@link ArenaProps} has wired
 * up its leaf handles. Scene tree reads `gavel` / `confetti` to drive them.
 */
export interface VerdictPropHandles {
  readonly gavel: GavelHandle | null;
  readonly confetti: ConfettiHandle | null;
}

interface ArenaPropsProps {
  /** Sink receiving the leaf gavel + confetti handles once mounted. */
  readonly handlesRef: React.MutableRefObject<VerdictPropHandles>;
}

/**
 * In-set dressing props that have physics: the judge's gavel and a mic
 * per contender desk. Mic bodies settle to rest at boot. The gavel and
 * confetti are exposed via the imperative handles exposed in this module's
 * {@link VerdictPropHandles}.
 *
 * Reduced motion: confetti is suppressed entirely. The gavel strike still
 * fires because at reduced-motion the camera cut is the focal moment; the
 * impulse is a 1-frame snap if it lands within view.
 */
export function ArenaProps({ handlesRef }: ArenaPropsProps) {
  const gavelRef = useRef<RapierRigidBody | null>(null);
  const confettiRef = useRef<ConfettiHandle | null>(null);
  const gavelHandleRef = useRef<GavelHandle | null>(null);

  useImperativeHandle(
    gavelHandleRef,
    () => ({
      strike() {
        const body = gavelRef.current;
        if (!body) return;
        body.wakeUp();
        body.applyImpulse({ x: 0, y: -0.35, z: 0 }, true);
        body.applyTorqueImpulse({ x: 0, y: 0, z: -0.12 }, true);
      },
    }),
    [],
  );

  // Bridge the leaf refs into the parent-bound `handlesRef`.
  useEffect(() => {
    handlesRef.current = {
      get gavel() {
        return gavelHandleRef.current;
      },
      get confetti() {
        return confettiRef.current;
      },
    };
    return () => {
      if (handlesRef.current) {
        handlesRef.current = { gavel: null, confetti: null };
      }
    };
  }, [handlesRef]);

  return (
    <group>
      <Gavel bodyRef={gavelRef} />
      <Mic
        color={PALETTE.terracotta}
        accentColor={PALETTE.terracottaLight}
        initialPosition={ARENA_LAYOUT.props.micA.initialPosition}
        size={ARENA_LAYOUT.props.micA.size}
      />
      <Mic
        color={PALETTE.plum}
        accentColor={PALETTE.plumLight}
        initialPosition={ARENA_LAYOUT.props.micB.initialPosition}
        size={ARENA_LAYOUT.props.micB.size}
      />
      <ConfettiPool ref={confettiRef} />
    </group>
  );
}

/* --- gavel --------------------------------------------------------------- */

interface GavelProps {
  readonly bodyRef: React.MutableRefObject<RapierRigidBody | null>;
}

function Gavel({ bodyRef }: GavelProps) {
  const { initialPosition, size } = ARENA_LAYOUT.props.gavel;
  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      mass={PROP_MASS.gavel}
      colliders={false}
      position={[initialPosition[0], initialPosition[1], initialPosition[2]]}
      linearDamping={0.6}
      angularDamping={0.6}
    >
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
      {/* Mallet head */}
      <mesh castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.18, 12]} />
        <meshStandardMaterial
          color={PALETTE.woodWarm}
          roughness={0.55}
          metalness={0.1}
        />
      </mesh>
      {/* Mallet head top — slightly deeper wood tone. */}
      <mesh position={[0.06, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.08, 12]} />
        <meshStandardMaterial
          color={PALETTE.woodMid}
          roughness={0.55}
          metalness={0.1}
        />
      </mesh>
      {/* Metal band wrapping the mallet head */}
      <mesh position={[-0.02, 0, 0]}>
        <cylinderGeometry args={[0.052, 0.052, 0.03, 12]} />
        <meshStandardMaterial
          color={PALETTE.honeyGlow}
          emissive={PALETTE.honeyGlow}
          emissiveIntensity={0.7}
          roughness={0.3}
          metalness={0.8}
        />
      </mesh>
    </RigidBody>
  );
}

/* --- mic ----------------------------------------------------------------- */

function Mic({
  color,
  accentColor,
  initialPosition,
  size,
}: {
  readonly color: string;
  readonly accentColor: string;
  readonly initialPosition: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}) {
  return (
    <RigidBody
      type="dynamic"
      mass={PROP_MASS.mic}
      colliders={false}
      position={[initialPosition[0], initialPosition[1], initialPosition[2]]}
      linearDamping={0.5}
      angularDamping={0.5}
    >
      <CuboidCollider
        args={[
          Math.max(0.025, size[0] / 2),
          Math.max(0.05, size[1] / 2),
          Math.max(0.025, size[2] / 2),
        ]}
      />
      <mesh position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.04, 12]} />
        <meshStandardMaterial color={PALETTE.walnutBlackened} roughness={0.6} />
      </mesh>
      <mesh castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.12, 12]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <torusGeometry args={[0.045, 0.008, 8, 16]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.5}
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>
      <mesh position={[0, 0.08, 0]}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color={accentColor} roughness={0.85} />
      </mesh>
    </RigidBody>
  );
}

/* --- confetti pool ------------------------------------------------------- */

const CONFETTI_HIDDEN_Y = -8;

const ConfettiPool = forwardRef<ConfettiHandle>(function ConfettiPool(_, ref) {
  const bodiesRef = useRef<Array<RapierRigidBody | null>>([]);
  const aliveRef = useRef<boolean[]>(
    Array.from({ length: CONFETTI_POOL_SIZE }, () => false),
  );
  const settleAtRef = useRef<number | null>(null);
  // capture the cycle number so we don't double-fire intervals.
  const cycleRef = useRef(0);

  const burst = useCallback((winner: "A" | "B" | "DRAW", reducedMotion: boolean) => {
    if (reducedMotion) return;
    const seed = Math.floor(performance.now() * 1000);
    const spawns: readonly ConfettiSpawn[] = planConfettiBurst(
      winner,
      seed,
      CONFETTI_BURST_COUNT,
    );
    for (let i = 0; i < CONFETTI_POOL_SIZE; i++) {
      const body = bodiesRef.current[i];
      if (!body) continue;
      const spawn = spawns[i % spawns.length];
      body.setTranslation(
        { x: spawn.position[0], y: spawn.position[1], z: spawn.position[2] },
        true,
      );
      body.setLinvel(
        { x: spawn.velocity[0], y: spawn.velocity[1], z: spawn.velocity[2] },
        true,
      );
      body.setAngvel(
        {
          x: spawn.angularVelocity[0],
          y: spawn.angularVelocity[1],
          z: spawn.angularVelocity[2],
        },
        true,
      );
      body.setRotation(
        {
          x: Math.sin(spawn.rotationEuler[0] / 2),
          y: Math.sin(spawn.rotationEuler[1] / 2),
          z: Math.sin(spawn.rotationEuler[2] / 2),
          w: Math.cos(
            (spawn.rotationEuler[0] +
              spawn.rotationEuler[1] +
              spawn.rotationEuler[2]) /
              6,
          ),
        },
        true,
      );
      body.wakeUp();
      aliveRef.current[i] = true;
    }
    settleAtRef.current = performance.now() + VERDICT_TIMING.confettiSettleMs;
    cycleRef.current += 1;
  }, []);

  const reset = useCallback(() => {
    for (let i = 0; i < CONFETTI_POOL_SIZE; i++) {
      const body = bodiesRef.current[i];
      if (!body) continue;
      hidePiece(body);
      aliveRef.current[i] = false;
    }
    settleAtRef.current = null;
  }, []);

  useImperativeHandle(ref, () => ({ burst, reset }), [burst, reset]);

  // Mount-frame settle ticker: polls until the settle deadline elapses,
  // then resets the pool. Cleanup handled by returning clearInterval.
  useEffect(() => {
    if (settleAtRef.current === null) return;
    const myCycle = cycleRef.current;
    const id = window.setInterval(() => {
      if (settleAtRef.current === null) return;
      if (myCycle !== cycleRef.current) {
        window.clearInterval(id);
        return;
      }
      if (performance.now() >= settleAtRef.current) {
        for (let i = 0; i < CONFETTI_POOL_SIZE; i++) {
          const body = bodiesRef.current[i];
          if (!body) continue;
          hidePiece(body);
          aliveRef.current[i] = false;
        }
        settleAtRef.current = null;
        window.clearInterval(id);
      }
    }, 220);
    return () => window.clearInterval(id);
  });

  const COLOR_INDEX = (i: number) =>
    [
      PALETTE.terracotta,
      PALETTE.terracottaLight,
      PALETTE.honey,
      PALETTE.honeyLight,
      PALETTE.plum,
      PALETTE.plumLight,
      PALETTE.cream,
    ][i % 7];

  return (
    <group>
      {Array.from({ length: CONFETTI_POOL_SIZE }, (_, i) => (
        <RigidBody
          key={i}
          ref={(b: RapierRigidBody | null) => {
            bodiesRef.current[i] = b;
          }}
          type="dynamic"
          mass={0.02}
          colliders={false}
          position={[0, CONFETTI_HIDDEN_Y, 0]}
          linearDamping={0.4}
          angularDamping={0.4}
          canSleep={true}
        >
          <CuboidCollider
            args={[
              CONFETTI_DEFAULT_SIZE[0] / 2,
              CONFETTI_DEFAULT_SIZE[1] / 2,
              CONFETTI_DEFAULT_SIZE[2] / 2,
            ]}
          />
          <mesh castShadow>
            <boxGeometry args={CONFETTI_DEFAULT_SIZE} />
            <meshStandardMaterial
              color={COLOR_INDEX(i)}
              emissive={COLOR_INDEX(i)}
              emissiveIntensity={0.18}
              roughness={0.55}
              metalness={0.0}
            />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
});

function hidePiece(body: RapierRigidBody) {
  body.setTranslation({ x: 0, y: CONFETTI_HIDDEN_Y, z: 0 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.sleep();
}
