/**
 * Allow-listed deterministic worker protocol (F10-19/F10-24).
 *
 * The worker spawned by the local sandbox host is SERVER-OWNED code shipped
 * inside this package. There is exactly one worker executable (the current
 * Node runtime) and exactly one worker script (bundled here); clients can
 * never choose executables, arguments, environment, stdio, or working
 * directories. The protocol below is the ONLY surface between host and
 * worker:
 *
 * - One bounded JSON request on stdin, one bounded JSON response line on
 *   stdout, then the worker exits (or is killed by the host's watchdog).
 * - Every operation is deterministic and side-effect free except the
 *   diagnostic `tree` operation, which only exists so tests can prove that
 *   Job Object termination reaches the whole process tree.
 * - No filesystem, network, or provider access. No secrets cross the
 *   boundary in either direction.
 */
import { z } from "zod";

export const WORKER_PROTOCOL_VERSION = 1 as const;

/** Hard cap on the serialized request the host may write to the worker stdin. */
export const WORKER_PROTOCOL_MAX_STDIN_BYTES = 256 * 1024;
/** Hard cap on bytes the worker itself will read from stdin. */
export const WORKER_PROTOCOL_WORKER_INPUT_CAP_BYTES = 256 * 1024;
/** Hard cap on bytes the worker will ever write to stdout. */
export const WORKER_PROTOCOL_MAX_STDOUT_BYTES = 1024 * 1024;

export const WORKER_PROTOCOL_OPS = Object.freeze(["sha256", "sleep", "flood", "malformed", "tree"] as const);
export type WorkerProtocolOp = (typeof WORKER_PROTOCOL_OPS)[number];

const base64 = z
  .string()
  .max(WORKER_PROTOCOL_MAX_STDIN_BYTES)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, "content must be base64");

/** Request written by the host to the worker's stdin (one JSON value). */
export const workerRequestSchema = z.strictObject({
  v: z.literal(WORKER_PROTOCOL_VERSION),
  op: z.enum(WORKER_PROTOCOL_OPS),
  /** sha256: UTF-8 bytes of the content, base64-encoded. */
  contentB64: base64.optional(),
  /** sleep: wall-clock milliseconds (bounded). */
  ms: z.number().int().finite().min(0).max(120_000).optional(),
  /** flood: number of junk stdout bytes to emit before the response line. */
  bytes: z.number().int().finite().min(0).max(4 * 1024 * 1024).optional(),
});
export type WorkerRequest = z.infer<typeof workerRequestSchema>;

/** Response the worker writes to stdout (one JSON value + newline). */
export const workerResponseSchema = z.strictObject({
  ok: z.boolean(),
  /** sha256 success: lowercase hex digest of the decoded UTF-8 bytes. */
  sha256Hex: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** sha256 success: decoded UTF-8 byte count. */
  contentBytes: z.number().int().finite().min(0).optional(),
  /** sleep success: milliseconds actually slept (bounded above by request). */
  sleptMs: z.number().int().finite().min(0).optional(),
  /** tree success: number of child processes the worker started. */
  spawnedChildren: z.number().int().finite().min(0).optional(),
  /** failure: bounded safe token, never raw exception text. */
  error: z
    .string()
    .max(64)
    .regex(/^[a-z0-9_]+$/)
    .optional(),
});
export type WorkerResponse = z.infer<typeof workerResponseSchema>;

export type ProtocolParseResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

export function parseWorkerRequest(raw: string): ProtocolParseResult<WorkerRequest> {
  if (Buffer.byteLength(raw, "utf8") > WORKER_PROTOCOL_MAX_STDIN_BYTES) {
    return { ok: false, error: "request exceeds the protocol stdin budget" };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "request is not valid JSON" };
  }
  const parsed = workerRequestSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: "request violates the worker protocol" };
  }
  return { ok: true, data: parsed.data };
}

export function parseWorkerResponse(raw: string): ProtocolParseResult<WorkerResponse> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "response is not valid JSON" };
  }
  const parsed = workerResponseSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: "response violates the worker protocol" };
  }
  return { ok: true, data: parsed.data };
}

/** Encode a request for stdin. Throws only on programmer error (bounded inputs). */
export function encodeWorkerRequest(request: WorkerRequest): string {
  const parsed = workerRequestSchema.safeParse(request);
  if (!parsed.success) throw new Error("internal: invalid worker request");
  const line = JSON.stringify(parsed.data);
  if (Buffer.byteLength(line, "utf8") > WORKER_PROTOCOL_MAX_STDIN_BYTES) {
    throw new Error("internal: worker request exceeds stdin budget");
  }
  return line;
}
