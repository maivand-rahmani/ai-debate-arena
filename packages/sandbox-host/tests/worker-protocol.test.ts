/**
 * Pure protocol tests for the allow-listed worker protocol: strict schema
 * validation, bounded sizes, and reject-by-default behavior. No I/O.
 */
import { describe, expect, it } from "vitest";
import {
  WORKER_PROTOCOL_MAX_STDIN_BYTES,
  WORKER_PROTOCOL_OPS,
  WORKER_PROTOCOL_VERSION,
  encodeWorkerRequest,
  parseWorkerRequest,
  parseWorkerResponse,
  workerRequestSchema,
  workerResponseSchema,
} from "../src/worker-protocol";

describe("worker protocol request validation", () => {
  it("accepts every allow-listed op with a valid shape", () => {
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "sha256", contentB64: "aGVsbG8=" })).ok).toBe(true);
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "sleep", ms: 100 })).ok).toBe(true);
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "flood", bytes: 10 })).ok).toBe(true);
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "malformed" })).ok).toBe(true);
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "tree" })).ok).toBe(true);
    expect(WORKER_PROTOCOL_OPS).toHaveLength(5);
  });

  it("rejects unknown ops, wrong versions, and unknown fields", () => {
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "exec", cmd: "dir" })).ok).toBe(false);
    expect(parseWorkerRequest(JSON.stringify({ v: 2, op: "sha256" })).ok).toBe(false);
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "sha256", path: "C:/x" })).ok).toBe(false);
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "sha256", env: { FOO: "bar" } })).ok).toBe(false);
    expect(parseWorkerRequest("not json").ok).toBe(false);
  });

  it("rejects oversized or malformed base64 payloads", () => {
    const big = { v: 1, op: "sha256", contentB64: "A".repeat(WORKER_PROTOCOL_MAX_STDIN_BYTES) };
    expect(parseWorkerRequest(JSON.stringify(big)).ok).toBe(false);
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "sha256", contentB64: "not base64!!" })).ok).toBe(false);
  });

  it("bounds sleep and flood magnitudes", () => {
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "sleep", ms: 121_000 })).ok).toBe(false);
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "sleep", ms: -1 })).ok).toBe(false);
    expect(parseWorkerRequest(JSON.stringify({ v: 1, op: "flood", bytes: 5 * 1024 * 1024 })).ok).toBe(false);
  });

  it("encodeWorkerRequest round-trips and rejects invalid requests", () => {
    const line = encodeWorkerRequest({ v: WORKER_PROTOCOL_VERSION, op: "sha256", contentB64: "QQ==" });
    expect(JSON.parse(line)).toEqual({ v: 1, op: "sha256", contentB64: "QQ==" });
    expect(() =>
      encodeWorkerRequest({ v: 1, op: "sha256", contentB64: "!!!" } as never),
    ).toThrow();
  });
});

describe("worker protocol response validation", () => {
  it("accepts bounded success and failure responses", () => {
    expect(
      parseWorkerResponse(JSON.stringify({ ok: true, sha256Hex: "a".repeat(64), contentBytes: 3 })).ok,
    ).toBe(true);
    expect(parseWorkerResponse(JSON.stringify({ ok: false, error: "input_too_large" })).ok).toBe(true);
    expect(parseWorkerResponse(JSON.stringify({ ok: true, sleptMs: 5 })).ok).toBe(true);
    expect(parseWorkerResponse(JSON.stringify({ ok: true, spawnedChildren: 1 })).ok).toBe(true);
  });

  it("rejects malformed shapes and unsafe error tokens", () => {
    expect(parseWorkerResponse("garbage").ok).toBe(false);
    expect(parseWorkerResponse(JSON.stringify({ ok: true, extra: 1 })).ok).toBe(false);
    expect(parseWorkerResponse(JSON.stringify({ ok: true, sha256Hex: "xyz" })).ok).toBe(false);
    expect(parseWorkerResponse(JSON.stringify({ ok: false, error: "C:\\boot\\ini" })).ok).toBe(false);
    expect(parseWorkerResponse(JSON.stringify({ ok: false, error: "has spaces" })).ok).toBe(false);
    expect(workerResponseSchema.safeParse({ ok: true, error: "x".repeat(65) }).success).toBe(false);
    expect(workerRequestSchema.safeParse({ v: 1, op: "sha256" }).success).toBe(true);
  });
});
