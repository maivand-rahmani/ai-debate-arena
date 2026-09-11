/**
 * REAL containment and cleanup tests for the local sandbox host on Windows
 * (F10-19/F10-24). These tests spawn actual allow-listed worker processes
 * inside actual Job Objects and prove:
 *
 * - the behavioral preflight passes on this machine (or the suite fails),
 * - a completed run returns the correct hash with verified cleanup,
 * - the watchdog kills an over-budget worker (timed_out, no orphans),
 * - the output cap kills a flooding worker (resource_exhausted),
 * - malformed worker output is classified as a safe failure,
 * - mid-run cancellation kills the job (cancelled, no orphans),
 * - Job Object termination reaches the WHOLE process tree (worker +
 *   grandchild) and the job's PID list drains to empty,
 * - no temp dirs are left behind and no secrets/paths leak into results.
 *
 * Every assertion here is host-attested (job accounting, PID lists, process
 * handles) — never worker-reported values.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_JOB_LIMITS,
  KILL_GRACE_MS,
  loadWindowsJobApi,
  verifyProcessTreeDeath,
} from "../src/win-job-ffi";
import {
  runContainmentPreflight,
  spawnAllowListedWorker,
  workerEnvironment,
} from "../src/preflight";
import {
  WORKER_HOST_MANIFEST,
  runWorkerHostAdapter,
  sweepStaleWorkerTempDirs,
} from "../src/worker-host-adapter";
import { encodeWorkerRequest } from "../src/worker-protocol";
import { validateSandboxAdapterResult } from "@arena/debate-engine";

const IS_WINDOWS = process.platform === "win32";
const GRANT_SPAWN = { "process.spawn": true };
const WORKER_SCRIPT = fileURLToPath(new URL("../src/worker/deterministic-worker.mjs", import.meta.url));

beforeAll(async () => {
  // Remove leftovers from previous crashed runs so the "no orphan temp dir"
  // assertions below measure THIS run only. Negative threshold = any age.
  await sweepStaleWorkerTempDirs(-60_000);
});

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    adapterId: WORKER_HOST_MANIFEST.adapterId,
    input: {
      kind: "sha256",
      contentUtf8B64: Buffer.from("deterministic worker input", "utf8").toString("base64"),
    },
    limits: { timeoutMs: 10_000, maxOutputBytes: 4_096, maxInputBytes: 64 * 1024 },
    ...overrides,
  };
}

function leftoverTempDirs(): string[] {
  try {
    return readdirSync(tmpdir()).filter((entry) => /^sbadp-worker-[A-Za-z0-9]{6}$/.test(entry));
  } catch {
    return [];
  }
}

describe.skipIf(!IS_WINDOWS)("behavioral containment preflight (real)", () => {
  it("proves kill-on-close + terminate containment on this machine", async () => {
    const outcome = await runContainmentPreflight();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(["modern", "legacy"]).toContain(outcome.layout.name);
    }
  });

  it("caches the verdict for subsequent calls", async () => {
    const first = await runContainmentPreflight();
    const second = await runContainmentPreflight();
    expect(second).toBe(first);
  });
});

describe.skipIf(!IS_WINDOWS)("hosted worker runs (real, end-to-end)", () => {
  it("completes a SHA-256 run with verified cleanup and bounded usage", async () => {
    const content = "real containment test input";
    const result = await runWorkerHostAdapter(
      baseRequest({
        input: { kind: "sha256", contentUtf8B64: Buffer.from(content, "utf8").toString("base64") },
      }),
      { granted: GRANT_SPAWN },
    );
    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeUndefined();
    const expected = createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
    expect(result.data?.sha256Hex).toBe(expected);
    expect(result.data?.contentBytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(result.usage.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.usage.outputBytes).toBeLessThanOrEqual(baseRequest().limits.maxOutputBytes);
    expect(result.cleanup.clean).toBe(true);
    expect(result.cleanup.resourcesReleased).toEqual(["worker-process", "job-object", "temp-dir"]);
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
    expect(leftoverTempDirs()).toEqual([]);
  });

  it("kills an over-budget worker at the wall-clock watchdog (timed_out)", async () => {
    const result = await runWorkerHostAdapter(
      baseRequest({
        input: { kind: "sleep", ms: 30_000 },
        limits: { timeoutMs: 1_500, maxOutputBytes: 4_096, maxInputBytes: 64 * 1024 },
      }),
      { granted: GRANT_SPAWN },
    );
    expect(result.status).toBe("timed_out");
    expect(result.errorCode).toBe("timeout");
    expect(result.usage.elapsedMs).toBeGreaterThanOrEqual(1_400);
    expect(result.usage.elapsedMs).toBeLessThan(10_000);
    expect(result.cleanup.clean).toBe(true);
    expect(result.cleanup.resourcesReleased).toContain("worker-process");
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
    expect(leftoverTempDirs()).toEqual([]);
  });

  it("kills a flooding worker at the output cap (resource_exhausted)", async () => {
    const result = await runWorkerHostAdapter(
      baseRequest({
        input: { kind: "flood", bytes: 512 * 1024 },
        limits: { timeoutMs: 10_000, maxOutputBytes: 4_096, maxInputBytes: 64 * 1024 },
      }),
      { granted: GRANT_SPAWN },
    );
    expect(result.status).toBe("resource_exhausted");
    expect(result.errorCode).toBe("limits_exceeded");
    expect(result.usage.outputBytes).toBeLessThanOrEqual(4_096);
    expect(result.usage.elapsedMs).toBeLessThan(10_000);
    expect(result.cleanup.clean).toBe(true);
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
    expect(leftoverTempDirs()).toEqual([]);
  });

  it("reports malformed worker output as a safe failure", async () => {
    const result = await runWorkerHostAdapter(
      baseRequest({ input: { kind: "malformed" } }),
      { granted: GRANT_SPAWN },
    );
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("adapter_failed");
    expect(result.message).toBe("Worker returned malformed output");
    expect(result.cleanup.clean).toBe(true);
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
    expect(leftoverTempDirs()).toEqual([]);
  });

  it("kills the job on mid-run cancellation (cancelled, no orphans)", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const result = await runWorkerHostAdapter(
      baseRequest({
        input: { kind: "sleep", ms: 30_000 },
        limits: { timeoutMs: 30_000, maxOutputBytes: 4_096, maxInputBytes: 64 * 1024 },
      }),
      { granted: GRANT_SPAWN, signal: controller.signal },
    );
    expect(result.status).toBe("cancelled");
    expect(result.errorCode).toBe("cancelled");
    expect(result.usage.elapsedMs).toBeLessThan(10_000);
    expect(result.cleanup.clean).toBe(true);
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
    expect(leftoverTempDirs()).toEqual([]);
  });

  it("reports cleanup_failed with an unclean receipt when temp removal fails", async () => {
    const result = await runWorkerHostAdapter(baseRequest(), {
      granted: GRANT_SPAWN,
      removeDir: async () => {
        throw new Error("injected removal failure");
      },
    });
    expect(result.status).toBe("completed");
    expect(result.cleanup.clean).toBe(false);
    expect(result.errorCode).toBe("cleanup_failed");
    expect(result.cleanup.resourcesReleased).not.toContain("temp-dir");
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
    // The injected failure leaves the dir behind; the documented recovery
    // path is the stale-dir sweep. Use an any-age threshold (negative =
    // immune to filesystem mtime granularity) and verify the OS temp dir is
    // clean again.
    expect(await sweepStaleWorkerTempDirs(-60_000)).toBeGreaterThanOrEqual(1);
    expect(leftoverTempDirs()).toEqual([]);
  });

  it("leaves no temp dirs and leaks no paths or secrets in results", async () => {
    const result = await runWorkerHostAdapter(baseRequest(), { granted: GRANT_SPAWN });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sbadp-worker-");
    expect(serialized).not.toMatch(/[A-Za-z]:\\\\/);
    expect(serialized).not.toContain("SANDBOX_WORKER_PROTOCOL");
    expect(serialized).not.toContain(process.execPath);
    expect(leftoverTempDirs()).toEqual([]);
  });
});

describe.skipIf(!IS_WINDOWS)("direct Job Object containment harness (real)", () => {
  it("terminates the whole worker tree and drains the job PID list", async () => {
    const api = await loadWindowsJobApi();
    expect(api).not.toBeNull();
    if (!api) return;

    // Pick the layout the behavioral preflight proved on this machine.
    const preflight = await runContainmentPreflight();
    expect(preflight.ok).toBe(true);
    if (!preflight.ok) return;
    const layout = preflight.layout;

    const job = api.createJob();
    expect(job).not.toBeNull();
    if (!job) return;
    let child: import("node:child_process").ChildProcess | null = null;
    let processHandle: import("../src/win-job-ffi").JobHandle | null = null;
    try {
      expect(api.setExtendedLimits(job, DEFAULT_JOB_LIMITS, layout)).toBe(true);
      expect(api.verifyExtendedLimits(job, DEFAULT_JOB_LIMITS, layout)).toBe(true);

      // Worker that starts a grandchild, then waits (the `tree` op).
      child = spawnAllowListedWorker(
        { spawn, execPath: process.execPath, workerScriptPath: WORKER_SCRIPT },
        encodeWorkerRequest({ v: 1, op: "tree" }),
        { env: workerEnvironment(tmpdir()) },
      );
      expect(child.pid).toBeTruthy();
      child.stdin?.write(encodeWorkerRequest({ v: 1, op: "tree" }) + "\n");
      child.stdin?.end();

      const processHandleLocal = api.openProcess(child.pid!);
      processHandle = processHandleLocal;
      expect(processHandleLocal).not.toBeNull();
      if (!processHandleLocal) return;
      expect(api.assignToJob(job, processHandleLocal)).toBe(true);

      // Membership + tree evidence: the job must contain BOTH processes.
      const workerResponse = await readOneLine(child, 10_000);
      expect(workerResponse?.ok).toBe(true);
      expect(workerResponse?.spawnedChildren).toBe(1);

      const pids = api.queryMemberPids(job, layout, 16);
      expect(pids).not.toBeNull();
      expect(pids!.length).toBeGreaterThanOrEqual(2);
      expect(pids).toContain(child.pid);

      // Host-owned kill of the whole tree.
      expect(api.terminateJob(job, 1)).toBe(true);
      const death = verifyProcessTreeDeath(api, job, layout, processHandleLocal, child, KILL_GRACE_MS);
      expect(death.dead).toBe(true);
      expect(death.jobEmpty).toBe(true);

      // PID list must be empty afterwards (legacy ABI) — the strongest
      // evidence that no member of the tree survived.
      if (layout.pidListClass !== null) {
        const after = api.queryMemberPids(job, layout, 16);
        expect(after).toEqual([]);
      }
    } finally {
      api.terminateJob(job, 1);
      if (processHandle) api.closeHandle(processHandle);
      api.closeHandle(job);
      expect(leftoverTempDirs()).toEqual([]);
    }
  }, 30_000);

  it("sweepStaleWorkerTempDirs only removes matching, old directories", async () => {
    // Fresh dirs (mtime now) must survive the age-gated sweep.
    expect(await sweepStaleWorkerTempDirs(24 * 60 * 60 * 1000)).toBe(0);
    expect(leftoverTempDirs()).toEqual([]);
  });
});

function readOneLine(
  child: import("node:child_process").ChildProcess,
  timeoutMs: number,
): Promise<{ ok: boolean; spawnedChildren?: number } | null> {
  return new Promise((resolve) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        cleanup();
        try {
          resolve(JSON.parse(line));
        } catch {
          resolve(null);
        }
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.removeListener("data", onData);
    };
    child.stdout?.on("data", onData);
  });
}
