"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { openDebateStream, type DebateStreamEvent, type DebateStreamRequest } from "@/shared/api/debate-stream";
import {
  initialRuntimeState,
  reduceDebateRuntime,
  type DebateRuntimeAction,
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
  /** True when a complete next Standard response block is buffered and ready. */
  readonly canAdvanceNextResponse: boolean;
  /** True while Standard is paused at a sealed public turn. */
  readonly isWaitingForNextResponse: boolean;
  /** Releases exactly one buffered Standard response block. */
  readonly nextResponse: () => void;
  /**
   * Direct dispatch into the runtime reducer. Used by the v0.2 re-judge flow
   * to replace the live verdict in-place once the server returns the new
   * decision. Prefer the higher-level helpers when they fit.
   */
  readonly dispatch: (action: DebateRuntimeAction) => void;
}

export interface StandardRevealGate {
  readonly paused: boolean;
  readonly buffered: readonly DebateStreamEvent[];
}

export interface StandardRevealDecision {
  readonly gate: StandardRevealGate;
  readonly visible: readonly DebateStreamEvent[];
}

export const initialStandardRevealGate: StandardRevealGate = {
  paused: false,
  buffered: [],
};

/**
 * Applies one ordered Standard stream event to the client-side reveal gate.
 * Terminal events bypass the spectator hold so a completed/erroring match
 * cannot remain hidden behind a response button.
 */
export function acceptStandardRevealEvent(
  gate: StandardRevealGate,
  event: DebateStreamEvent,
): StandardRevealDecision {
  if (!gate.paused) {
    if (event.type === "turn") {
      return { gate: { paused: true, buffered: [] }, visible: [event] };
    }
    return { gate, visible: [event] };
  }

  const buffered = [...gate.buffered, event];
  if (isRevealTerminalEvent(event)) {
    return { gate: initialStandardRevealGate, visible: buffered };
  }
  // Speech pacing belongs to the response block, not to public operational
  // activity. Let phases, tool calls/results, and authoritative resource
  // snapshots through while the next speech remains buffered. This keeps the
  // rails truthful when a tool runs after a sealed turn but before the viewer
  // presses Next response.
  if (isPublicStandardActivity(event)) {
    return { gate, visible: [event] };
  }
  return { gate: { paused: true, buffered }, visible: [] };
}

/** Release the next complete response, stopping at its sealed public turn. */
export function releaseNextStandardResponse(gate: StandardRevealGate): StandardRevealDecision {
  if (!gate.paused) return { gate, visible: [] };
  const turnIndex = gate.buffered.findIndex((event) => event.type === "turn");
  if (turnIndex === -1) return { gate, visible: [] };
  return {
    gate: { paused: true, buffered: gate.buffered.slice(turnIndex + 1) },
    visible: gate.buffered.slice(0, turnIndex + 1),
  };
}

function isRevealTerminalEvent(event: DebateStreamEvent): boolean {
  return event.type === "judge-start" || event.type === "verdict" || event.type === "error" || event.type === "done";
}

function isPublicStandardActivity(event: DebateStreamEvent): boolean {
  return event.type === "phase" || event.type === "tool-start" || event.type === "tool-result" || event.type === "standard-state";
}

function revealStatus(gate: StandardRevealGate): {
  readonly canAdvance: boolean;
  readonly waiting: boolean;
} {
  const canAdvance = gate.paused && gate.buffered.some((event) => event.type === "turn");
  return { canAdvance, waiting: gate.paused && !canAdvance };
}

/**
 * Client-side hook that drives {@link DebateRuntimeState} from a live
 * `/api/debate` stream. Cleans up on unmount or when a new match starts.
 */
export function useDebateStream(options: UseDebateStreamOptions = {}): UseDebateStreamResult {
  const [state, dispatch] = useReducer(reduceDebateRuntime, options.initial ?? initialRuntimeState);
  const abortRef = useRef<(() => void) | null>(null);
  const revealGateRef = useRef<StandardRevealGate>(initialStandardRevealGate);
  const [revealStatus, setRevealStatus] = useState(() => revealStatusFor(initialStandardRevealGate));
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
    revealGateRef.current = initialStandardRevealGate;
    setRevealStatus(revealStatusFor(initialStandardRevealGate));

    dispatch({ type: "start", topic: request.topic, mode: request.mode });

    const handle = openDebateStream(request);
    abortRef.current = handle.abort;

    void (async () => {
      try {
        for await (const event of handle.events) {
          if (request.mode !== "standard") {
            dispatch({ type: "stream-event", event });
          } else {
            const decision = acceptStandardRevealEvent(revealGateRef.current, event);
            revealGateRef.current = decision.gate;
            for (const visibleEvent of decision.visible) {
              dispatch({ type: "stream-event", event: visibleEvent });
            }
            setRevealStatus(revealStatusFor(decision.gate));
          }
          if (event.type === "done") break;
        }
      } catch (error) {
        // If the user already cancelled, the AbortError is expected — don't
        // surface it as a stream failure.
        if (userCancelledRef.current) return;
        if (request.mode === "standard") {
          const pending = revealGateRef.current.buffered;
          revealGateRef.current = initialStandardRevealGate;
          for (const event of pending) dispatch({ type: "stream-event", event });
          setRevealStatus(revealStatusFor(initialStandardRevealGate));
        }
        const message = error instanceof Error ? error.message : "The match was interrupted.";
        dispatch({ type: "stream-error", message });
      }
    })();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    userCancelledRef.current = false;
    revealGateRef.current = initialStandardRevealGate;
    setRevealStatus(revealStatusFor(initialStandardRevealGate));
    dispatch({ type: "reset" });
  }, []);

  const cancel = useCallback(() => {
    userCancelledRef.current = true;
    abortRef.current?.();
    abortRef.current = null;
    revealGateRef.current = initialStandardRevealGate;
    setRevealStatus(revealStatusFor(initialStandardRevealGate));
    dispatch({ type: "cancel" });
  }, []);

  const nextResponse = useCallback(() => {
    const decision = releaseNextStandardResponse(revealGateRef.current);
    if (decision.visible.length === 0) return;
    revealGateRef.current = decision.gate;
    for (const event of decision.visible) {
      dispatch({ type: "stream-event", event });
    }
    setRevealStatus(revealStatusFor(decision.gate));
  }, []);

  return {
    state,
    start,
    reset,
    cancel,
    canAdvanceNextResponse: revealStatus.canAdvance,
    isWaitingForNextResponse: revealStatus.waiting,
    nextResponse,
    dispatch,
  };
}

function revealStatusFor(gate: StandardRevealGate): {
  readonly canAdvance: boolean;
  readonly waiting: boolean;
} {
  return revealStatus(gate);
}
