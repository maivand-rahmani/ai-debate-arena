"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { deriveMatchPlayback, type MatchPlaybackSnapshot } from "./match-playback";

export interface MatchPlayback extends MatchPlaybackSnapshot {
  readonly advance: () => void;
  readonly previous?: () => void;
  readonly catchUpToLive?: () => void;
}

export function shouldIgnorePlaybackShortcutTarget(
  target: Pick<HTMLElement, "closest"> | null,
): boolean {
  return Boolean(target?.closest("[role=\"dialog\"], input, textarea, select, [contenteditable=\"true\"]"));
}

/** Viewer controls for a stream that keeps generating independently. */
export function useMatchPlayback(state: DebateRuntimeState): MatchPlayback {
  const [requestedIndex, setRequestedIndex] = useState(0);
  const latestState = useRef(state);
  useEffect(() => {
    latestState.current = state;
  }, [state]);
  const snapshot = useMemo(
    () => deriveMatchPlayback(state, requestedIndex),
    [state, requestedIndex],
  );

  useEffect(() => {
    if (state.status !== "idle" && state.status !== "starting") return;
    // Reset after the terminal frame commits, rather than causing a second
    // render from inside this synchronization effect.
    const reset = window.setTimeout(() => setRequestedIndex(0), 0);
    return () => window.clearTimeout(reset);
  }, [state.status]);

  const advance = useCallback(() => {
    // Model events may land between render and the viewer's click. Calculate
    // the next visible turn from the latest stream state so a ready response
    // cannot be skipped for the judge surface.
    setRequestedIndex((index) => deriveMatchPlayback(latestState.current, index).nextIndex ?? index);
  }, []);

  const previous = useCallback(() => {
    setRequestedIndex((index) => Math.max(0, index - 1));
  }, []);

  const catchUpToLive = useCallback(() => {
    setRequestedIndex(() => {
      const current = latestState.current;
      if (current.status === "judging" || current.status === "finished") return current.panels.length;
      return Math.max(0, current.panels.length - 1);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (shouldIgnorePlaybackShortcutTarget(target)) return;
      if (event.key === "Escape" && snapshot.canAdvance) {
        event.preventDefault();
        advance();
      } else if (event.key === "ArrowLeft" && snapshot.canGoPrevious) {
        event.preventDefault();
        previous();
      } else if (event.key === "ArrowRight" && snapshot.canAdvance) {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, previous, snapshot.canAdvance, snapshot.canGoPrevious]);

  return { ...snapshot, advance, previous, catchUpToLive };
}
