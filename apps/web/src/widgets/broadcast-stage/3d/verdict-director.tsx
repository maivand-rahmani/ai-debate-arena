"use client";

import { useEffect, useRef } from "react";
import { VERDICT_TIMING } from "./confetti";
import { isVerdictCueEligible, type SceneSignal } from "./scene-signal";
import type { VerdictPropHandles } from "./arena-props";

/**
 * Verdict director — watches the scene signal for verdict transitions and
 * schedules the gavel strike + confetti burst cues with the offsets
 * defined in {@link ./confetti}.
 *
 * Behavior:
 *   - First poll of a NEW verdict (stamp never scheduled before) fires the
 *     gavel strike at T=120ms, confetti burst at T=340ms.
 *   - DRAW gets a centered confetti burst over the judge platform — the
 *     celebration moment still reads, minus the winner-side framing
 *     (accepted at Gate C; matches confetti.test.ts).
 *   - Reduced motion: confetti suppressed (per spec); gavel still ticks.
 *   - Cancelled/error transitions: nothing (no props get touched).
 *
 * StrictMode note (Gate C fix #1): deliberately NO effect cleanup here.
 * React 19 dev double-mount would clear a pending timer while the stamp
 * guard had already consumed it — silently killing the verdict moment in
 * dev. Instead we keep a set of scheduled stamps so the second mount is a
 * no-op while the first mount's timers run. A debate session's verdict
 * count is tiny, so the set needs no pruning.
 *
 * The director is rendered inside the canvas tree so it sits under
 * `<Physics>` (Rapier bodies need to exist) but reads from the bridge
 * ref attached to {@link ArenaProps}.
 */
export function VerdictDirector({
  signal,
  handlesRef,
}: {
  readonly signal: SceneSignal | undefined;
  readonly handlesRef: React.MutableRefObject<VerdictPropHandles>;
}) {
  const scheduledStampsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Winner-specific cues only fire on a fresh terminal-frame verdict. While
    // the viewer still holds the final speech the runtime may already be
    // finished, but the gavel/confetti moment waits for the terminal frame.
    if (!signal) return;
    if (!isVerdictCueEligible(signal)) return;
    const stamp = signal.verdictStamp;
    if (stamp === null || scheduledStampsRef.current.has(stamp)) return;

    const handles = handlesRef.current;
    if (!handles) return;
    scheduledStampsRef.current.add(stamp);

    const winner = signal.verdictWinner;
    if (!winner) return;
    const reducedMotion = signal.reducedMotion;

    // Fire-and-forget: no cleanup — StrictMode must not cancel the moment.
    window.setTimeout(() => {
      handles.gavel?.strike();
    }, VERDICT_TIMING.gavelStrikeMs);

    window.setTimeout(() => {
      handles.confetti?.burst(winner, reducedMotion);
    }, VERDICT_TIMING.confettiTriggerMs);
  }, [signal, handlesRef]);

  return null;
}
