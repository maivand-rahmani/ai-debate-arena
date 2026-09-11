"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { deriveMatchPlayback, type MatchPlaybackSnapshot } from "./match-playback";

export interface MatchPlayback extends MatchPlaybackSnapshot {
  readonly advance: () => void;
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !snapshot.canAdvance) return;
      event.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, snapshot.canAdvance]);

  return { ...snapshot, advance };
}
