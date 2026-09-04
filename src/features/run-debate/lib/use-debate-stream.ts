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
  readonly reset: () => void;
}

/**
 * Client-side hook that drives {@link DebateRuntimeState} from a live
 * `/api/debate` stream. Cleans up on unmount or when a new match starts.
 */
export function useDebateStream(options: UseDebateStreamOptions = {}): UseDebateStreamResult {
  const [state, dispatch] = useReducer(reduceDebateRuntime, options.initial ?? initialRuntimeState);
  const abortRef = useRef<(() => void) | null>(null);

  // Cancel any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.();
      abortRef.current = null;
    };
  }, []);

  const start = useCallback((request: DebateStreamRequest) => {
    // Cancel a previous stream before starting a new one.
    abortRef.current?.();
    abortRef.current = null;

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
        const message = error instanceof Error ? error.message : "The match was interrupted.";
        dispatch({ type: "stream-error", message });
      }
    })();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  return { state, start, reset };
}
