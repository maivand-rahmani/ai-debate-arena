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

import type { DebateSide } from "@arena/types";
import type {
  DebateStreamPhase,
  DebateStreamTerminal,
  DebateStreamVerdict,
} from "@arena/types";

// Canonical wire primitives (structurally identical to `@arena/types`).
// The remaining client shapes below (Turn/EventBody/Event/Envelope) stay
// local on purpose: they tolerate partial payloads (optional `createdAt`,
// narrowed turn phases, optional `terminal`, partial envelope) so the UI
// degrades gracefully instead of crashing.
export type {
  DebateStreamPhase,
  DebateStreamTerminal,
  DebateStreamVerdict,
  DebateStreamVerdictCriteria,
} from "@arena/types";

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

/**
 * Stream contract v1 envelope. The server attaches it to every event;
 * clients accept events with or without it (unknown extras are ignored).
 */
export interface DebateStreamEnvelope {
  readonly v: 1;
  readonly matchId: string;
  readonly seq: number;
}

export interface DebateStreamTurn {
  readonly id: string;
  readonly side: DebateSide;
  readonly phase: Exclude<DebateStreamPhase, "CREATED" | "FINISHED">;
  readonly content: string;
  readonly model: string;
  readonly createdAt?: string;
}

export type DebateStreamEventBody =
  | { readonly type: "phase"; readonly phase: DebateStreamPhase; readonly side: DebateSide | null }
  | { readonly type: "token"; readonly side: DebateSide; readonly text: string }
  | { readonly type: "turn"; readonly turn: DebateStreamTurn }
  | { readonly type: "judge-start" }
  | { readonly type: "verdict"; readonly verdict: DebateStreamVerdict }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done"; readonly terminal?: DebateStreamTerminal };

/** Client-side event: payload plus the optional v1 envelope extras. */
export type DebateStreamEvent = DebateStreamEventBody & Partial<DebateStreamEnvelope>;

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
  const envelope = readEnvelope(input);
  switch (type) {
    case "phase": {
      const phase = typeof input.phase === "string" && STREAM_PHASES.has(input.phase as DebateStreamPhase)
        ? (input.phase as DebateStreamPhase)
        : "CREATED";
      const rawSide = input.side;
      const side: DebateSide | null = rawSide === "A" || rawSide === "B" ? rawSide : null;
      return { type: "phase", phase, side, ...envelope };
    }
    case "token":
      return {
        type: "token",
        side: input.side === "B" ? "B" : "A",
        text: typeof input.text === "string" ? input.text : "",
        ...envelope,
      };
    case "turn": {
      if (!input.turn || typeof input.turn !== "object") return null;
      return { type: "turn", turn: input.turn as DebateStreamTurn, ...envelope };
    }
    case "judge-start":
      return { type: "judge-start", ...envelope };
    case "verdict": {
      if (!input.verdict || typeof input.verdict !== "object") return null;
      return { type: "verdict", verdict: input.verdict as DebateStreamVerdict, ...envelope };
    }
    case "error":
      return {
        type: "error",
        message: typeof input.message === "string" ? input.message : "Unknown server error",
        ...envelope,
      };
    case "done":
      return { type: "done", ...readTerminal(input), ...envelope };
    default:
      return null;
  }
}

const STREAM_TERMINALS: ReadonlySet<DebateStreamTerminal> = new Set(["completed", "error", "cancelled"]);

function readTerminal(input: Record<string, unknown>): { readonly terminal?: DebateStreamTerminal } {
  const terminal = input.terminal;
  return typeof terminal === "string" && STREAM_TERMINALS.has(terminal as DebateStreamTerminal)
    ? { terminal: terminal as DebateStreamTerminal }
    : {};
}

/** Preserve the v1 envelope when present; ignore malformed extras. */
function readEnvelope(input: Record<string, unknown>): Partial<DebateStreamEnvelope> {
  const envelope: { v?: 1; matchId?: string; seq?: number } = {};
  if (input.v === 1) envelope.v = 1;
  if (typeof input.matchId === "string" && input.matchId.length > 0) envelope.matchId = input.matchId;
  if (typeof input.seq === "number" && Number.isInteger(input.seq) && input.seq >= 1) envelope.seq = input.seq;
  return envelope;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Network request failed";
}

