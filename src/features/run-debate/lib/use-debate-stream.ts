"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { openDebateStream, type DebateStreamRequest } from "@/shared/api/debate-stream";
import {
  initialRuntimeState,
  reduceDebateRuntime,
  type DebateRuntimeState,
} from "./reducer";

interface UseDebateStreamOptions {
  /** Optional override of the initial state (e.g. to reset). */
  readonly initial?: DebateRuntimeState;
}

export interface UseDebateStreamResult {
  readonly state: DebateRuntimeState;
  readonly start: (request: DebateStreamRequest) => void;
  /** Silent cleanup — drops back to `idle`. Used on unmount and when navigating away. */
  readonly reset: () => void;
  /**
   * User-initiated stop. Aborts the live stream and dispatches the `cancel`
   * action so the arena can show a calm "match ended" presentation. The
   * reducer preserves precedence: an existing error or verdict wins.
   */
  readonly cancel: () => void;
}

/**
 * Client-side hook that drives {@link DebateRuntimeState} from a live
 * `/api/debate` stream. Cleans up on unmount or when a new match starts.
 */
export function useDebateStream(options: UseDebateStreamOptions = {}): UseDebateStreamResult {
  const [state, dispatch] = useReducer(reduceDebateRuntime, options.initial ?? initialRuntimeState);
  const abortRef = useRef<(() => void) | null>(null);
  // Tracks whether the current stream was stopped by the user via `cancel`.
  // Used to suppress the `stream-error` dispatch that would otherwise fire
  // when `fetch().abort()` rejects with `AbortError` on user stop.
  const userCancelledRef = useRef(false);

  // Cancel any in-flight stream on unmount. This is an internal cleanup, not
  // a user action, so we do not dispatch `cancel` — the UI is going away.
  useEffect(() => {
    return () => {
      abortRef.current?.();
      abortRef.current = null;
    };
  }, []);

  const start = useCallback((request: DebateStreamRequest) => {
    // Cancel a previous stream before starting a new one. This is not a
    // user-initiated cancellation, so we don't flag it as such.
    abortRef.current?.();
    abortRef.current = null;
    userCancelledRef.current = false;

    dispatch({ type: "start", topic: request.topic });

    const handle = openDebateStream(request);
    abortRef.current = handle.abort;

    void (async () => {
      try {
        for await (const event of handle.events) {
          dispatch({ type: "stream-event", event });
          if (event.type === "done") break;
        }
      } catch (error) {
        // If the user already cancelled, the AbortError is expected — don't
        // surface it as a stream failure.
        if (userCancelledRef.current) return;
        const message = error instanceof Error ? error.message : "The match was interrupted.";
        dispatch({ type: "stream-error", message });
      }
    })();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    userCancelledRef.current = false;
    dispatch({ type: "reset" });
  }, []);

  const cancel = useCallback(() => {
    userCancelledRef.current = true;
    abortRef.current?.();
    abortRef.current = null;
    dispatch({ type: "cancel" });
  }, []);

  return { state, start, reset, cancel };
}
