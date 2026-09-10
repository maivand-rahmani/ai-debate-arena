"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { deriveMatchPlayback, type MatchPlaybackSnapshot } from "./match-playback";

export interface MatchPlayback extends MatchPlaybackSnapshot {
  readonly advance: () => void;
}

/** Viewer controls for a stream that keeps generating independently. */
export function useMatchPlayback(state: DebateRuntimeState): MatchPlayback {
  const [requestedIndex, setRequestedIndex] = useState(0);
  const snapshot = useMemo(
    () => deriveMatchPlayback(state, requestedIndex),
    [state, requestedIndex],
  );

  useEffect(() => {
    if (state.status === "idle" || state.status === "starting") setRequestedIndex(0);
  }, [state.status]);

  const advance = useCallback(() => {
    setRequestedIndex((index) => (snapshot.canAdvance ? index + 1 : index));
  }, [snapshot.canAdvance]);

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
