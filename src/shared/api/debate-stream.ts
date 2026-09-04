/**
 * NDJSON fetch-stream reader for the `/api/debate` endpoint.
 *
 * The server sends `application/x-ndjson` (one JSON object per line). We parse
 * each line into a typed {@link DebateStreamEvent} and surface it as an async
 * iterator so callers can drive UI state with `for await`.
 *
 * Aborting is supported by passing an {@link AbortSignal}; the underlying
 * `fetch` is cancelled and the iterator is closed cleanly.
 */

import type { DebateSide } from "@/entities/debate";

export type DebateStreamMode = "quick";

export interface DebateStreamAgentInput {
  readonly providerId: string;
  readonly model: string;
  readonly position: "FOR" | "AGAINST";
}

export interface DebateStreamRequest {
  readonly topic: string;
  readonly mode: DebateStreamMode;
  readonly agentA: DebateStreamAgentInput;
  readonly agentB: DebateStreamAgentInput;
}

/** Mirrors the server-side phase union (kept as strings to stay decoupled). */
export type DebateStreamPhase =
  | "CREATED"
  | "OPENING_A"
  | "OPENING_B"
  | "REBUTTAL_A"
  | "REBUTTAL_B"
  | "JUDGING"
  | "FINISHED";

export interface DebateStreamTurn {
  readonly id: string;
  readonly side: DebateSide;
  readonly phase: Exclude<DebateStreamPhase, "CREATED" | "FINISHED">;
  readonly content: string;
  readonly model: string;
  readonly createdAt?: string;
}

export interface DebateStreamVerdictCriteria {
  readonly argumentQualityA: number;
  readonly argumentQualityB: number;
  readonly rebuttalA: number;
  readonly rebuttalB: number;
  readonly consistencyA: number;
  readonly consistencyB: number;
  readonly relevanceA: number;
  readonly relevanceB: number;
}

export interface DebateStreamVerdict {
  readonly winner: DebateSide | "DRAW";
  readonly scoreA: number;
  readonly scoreB: number;
  readonly criteria: DebateStreamVerdictCriteria;
  readonly reasoning: string;
}

export type DebateStreamEvent =
  | { readonly type: "phase"; readonly phase: DebateStreamPhase; readonly side: DebateSide | null }
  | { readonly type: "token"; readonly side: DebateSide; readonly text: string }
  | { readonly type: "turn"; readonly turn: DebateStreamTurn }
  | { readonly type: "judge-start" }
  | { readonly type: "verdict"; readonly verdict: DebateStreamVerdict }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done" };

export class DebateStreamError extends Error {
  public readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "DebateStreamError";
    this.status = status;
  }
}

export interface DebateStreamHandle {
  /** Async iterator of typed events. Terminates when `done` is received or the connection drops. */
  readonly events: AsyncIterable<DebateStreamEvent>;
  /** Cancels the fetch + closes the iterator. Safe to call multiple times. */
  abort: () => void;
}

/**
 * Opens a streaming POST to `/api/debate` and yields typed NDJSON events.
 *
 * - Posts the request as JSON.
 * - Reads the response body as a UTF-8 stream of NDJSON lines.
 * - Throws {@link DebateStreamError} if the response status is not OK (the
 *   endpoint may not exist while the server side is built in parallel, so the
 *   caller should treat that case as a recoverable error state).
 */
export function openDebateStream(request: DebateStreamRequest, signal?: AbortSignal): DebateStreamHandle {
  const controller = new AbortController();
  const externalSignal = signal;
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }

  let aborted = false;
  const abort = () => {
    if (aborted) return;
    aborted = true;
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
    controller.abort();
  };

  const events: AsyncIterable<DebateStreamEvent> = {
    [Symbol.asyncIterator]() {
      return runStream(request, controller.signal, abort);
    },
  };

  return { events, abort };
}

async function* runStream(
  request: DebateStreamRequest,
  signal: AbortSignal,
  cleanup: () => void,
): AsyncGenerator<DebateStreamEvent, void, undefined> {
  let response: Response;
  try {
    response = await fetch("/api/debate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    cleanup();
    throw new DebateStreamError(toMessage(error));
  }

  if (!response.ok) {
    cleanup();
    throw new DebateStreamError(
      `Server responded ${response.status} ${response.statusText}`.trim(),
      response.status,
    );
  }
  if (!response.body) {
    cleanup();
    throw new DebateStreamError("Server returned no response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (rawLine.length > 0) {
          const event = parseLine(rawLine);
          if (event) {
            yield event;
            if (event.type === "done") {
              cleanup();
              return;
            }
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    // Flush any trailing partial line.
    const tail = buffer.trim();
    if (tail.length > 0) {
      const event = parseLine(tail);
      if (event) yield event;
    }
  } catch (error) {
    if (signal.aborted) return;
    throw new DebateStreamError(toMessage(error));
  } finally {
    cleanup();
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

// --- Internal helpers -------------------------------------------------------

const STREAM_PHASES: ReadonlySet<DebateStreamPhase> = new Set([
  "CREATED",
  "OPENING_A",
  "OPENING_B",
  "REBUTTAL_A",
  "REBUTTAL_B",
  "JUDGING",
  "FINISHED",
]);

function parseLine(line: string): DebateStreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return normalizeEvent(parsed as Record<string, unknown>);
}

function normalizeEvent(input: Record<string, unknown>): DebateStreamEvent | null {
  const type = input.type;
  switch (type) {
    case "phase": {
      const phase = typeof input.phase === "string" && STREAM_PHASES.has(input.phase as DebateStreamPhase)
        ? (input.phase as DebateStreamPhase)
        : "CREATED";
      const rawSide = input.side;
      const side: DebateSide | null = rawSide === "A" || rawSide === "B" ? rawSide : null;
      return { type: "phase", phase, side };
    }
    case "token":
      return {
        type: "token",
        side: input.side === "B" ? "B" : "A",
        text: typeof input.text === "string" ? input.text : "",
      };
    case "turn": {
      if (!input.turn || typeof input.turn !== "object") return null;
      return { type: "turn", turn: input.turn as DebateStreamTurn };
    }
    case "judge-start":
      return { type: "judge-start" };
    case "verdict": {
      if (!input.verdict || typeof input.verdict !== "object") return null;
      return { type: "verdict", verdict: input.verdict as DebateStreamVerdict };
    }
    case "error":
      return {
        type: "error",
        message: typeof input.message === "string" ? input.message : "Unknown server error",
      };
    case "done":
      return { type: "done" };
    default:
      return null;
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Network request failed";
}
