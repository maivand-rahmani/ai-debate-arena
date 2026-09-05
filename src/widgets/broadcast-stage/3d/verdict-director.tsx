"use client";

import { useEffect, useRef } from "react";
import { VERDICT_TIMING } from "./confetti";
import type { SceneSignal } from "./scene-signal";
import type { VerdictPropHandles } from "./arena-props";

/**
 * Verdict director — watches the scene signal for verdict transitions and
 * schedules the gavel strike + confetti burst cues with the offsets
 * defined in {@link ./confetti}.
 *
 * Behavior:
 *   - First poll of a NEW verdict (stamp differs from the last seen)
 *     schedules gavel strike at T=120ms, confetti burst at T=340ms.
 *   - Reduced motion: confetti suppressed (per spec); gavel still ticks.
 *   - Cancelled/error transitions: nothing (no props get touched).
 *   - Unmount clears pending timers so a hot-reload doesn't leak.
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
  const lastStampRef = useRef<string | null>(null);

  useEffect(() => {
    if (!signal) return;
    if (signal.status !== "finished") return;
    if (!signal.verdictWinner) return;
    if (signal.verdictStamp === lastStampRef.current) return;
    lastStampRef.current = signal.verdictStamp;

    const handles = handlesRef.current;
    if (!handles) return;

    const winner = signal.verdictWinner;

    // Schedule per the VERDICT_TIMING offsets. Cleanup clears both.
    const gavelTimer = window.setTimeout(() => {
      handles.gavel?.strike();
    }, VERDICT_TIMING.gavelStrikeMs);

    const confettiTimer = window.setTimeout(() => {
      handles.confetti?.burst(winner, signal.reducedMotion);
    }, VERDICT_TIMING.confettiTriggerMs);

    return () => {
      window.clearTimeout(gavelTimer);
      window.clearTimeout(confettiTimer);
    };
  }, [signal, handlesRef]);

  return null;
}
