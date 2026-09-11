/**
 * Fail-closed behavior tests for the local sandbox host (F10-19/F10-24).
 *
 * These tests run on EVERY platform: they inject the platform string, the
 * FFI loader, the preflight, and the spawn function, so no real process is
 * ever started here. They prove:
 *
 * - non-Windows platforms and missing FFI yield `unavailable` (no spawn),
 * - a failing behavioral preflight yields `unavailable` (no spawn),
 * - capability/permission denial happens BEFORE any spawn,
 * - limits and input violations are rejected BEFORE any spawn,
 * - the modern->legacy layout fallback is chosen only when behaviorally
 *   verified against the injected fake job API,
 * - cleanup failures produce unclean receipts with `cleanup_failed`,
 * - every produced result validates against the contract schema and leaks
 *   no paths, secrets, or environment values.
 */
import { describe, expect, it } from "vitest";
import type { ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  LEGACY_JOB_LAYOUT,
  type JobHandle,
  type JobLayoutDescriptor,
  type WindowsJobApi,
} from "../src/win-job-ffi";
import { runContainmentPreflight, type PreflightDeps } from "../src/preflight";
import { WORKER_HOST_MANIFEST, runWorkerHostAdapter, sweepStaleWorkerTempDirs } from "../src/worker-host-adapter";
import { validateSandboxAdapterResult } from "@arena/debate-engine";

/* ------------------------------------------------------------------ */
/* Fake child process + fake job API (no real processes)               */
/* ------------------------------------------------------------------ */

interface FakeChild extends ChildProcess {
  emitExit(code: number): void;
  emitStdout(chunk: Buffer): void;
}

function makeFakeChild(pid: number): FakeChild {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const stdoutListeners = new Set<(chunk: Buffer) => void>();
  const child = {
    pid,
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: { write: () => true, end: () => undefined, destroy: () => undefined },
    stdout: {
      on: (ev: string, cb: (chunk: Buffer) => void) => {
        if (ev === "data") stdoutListeners.add(cb);
        return child.stdout;
      },
      destroy: () => undefined,
    },
    stderr: { on: () => undefined, destroy: () => undefined },
    on(ev: string, cb: (...args: unknown[]) => void) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(cb);
      return child;
    },
    once(ev: string, cb: (...args: unknown[]) => void) {
      return child.on(ev, cb);
    },
    removeListener(ev: string, cb: (...args: unknown[]) => void) {
      listeners.get(ev)?.delete(cb);
      return child;
    },
    emitExit(code: number) {
      (child as { exitCode: number | null }).exitCode = code;
      for (const cb of listeners.get("exit") ?? []) cb(0);
    },
    emitStdout(chunk: Buffer) {
      for (const cb of stdoutListeners) cb(chunk);
    },
  } as unknown as FakeChild;
  return child;
}

interface FakeJobState {
  limitsSet: boolean;
  pids: Set<number>;
  terminated: boolean;
  closed: boolean;
}

interface FakeApiOptions {
  modernWorks?: boolean;
  legacyWorks?: boolean;
  membershipFails?: boolean;
}

function makeFakeApi(options: FakeApiOptions = {}) {
  const modernWorks = options.modernWorks ?? false;
  const legacyWorks = options.legacyWorks ?? true;
  const jobs = new Map<number, FakeJobState>();
  const children = new Map<number, FakeChild>();
  let nextJobId = 1;
  let nextPid = 4200;

  const api: WindowsJobApi & { children: Map<number, FakeChild> } = {
    children,
    createJob(): JobHandle | null {
      const id = nextJobId++;
      jobs.set(id, { limitsSet: false, pids: new Set(), terminated: false, closed: false });
      return { id };
    },
    closeHandle(handle: JobHandle): boolean {
      const state = (handle as { id?: number })?.id !== undefined ? jobs.get((handle as { id: number }).id) : undefined;
      if (state) {
        if (!state.closed) {
          state.closed = true;
          // kill-on-close semantics: members die when the last handle goes.
          killMembers(state);
        }
        return true;
      }
      return true;
    },
    setExtendedLimits(job: JobHandle, _limits: unknown, layout: JobLayoutDescriptor): boolean {
      const state = jobs.get((job as { id: number }).id);
      if (!state) return false;
      if (layout.name === "modern" && !modernWorks) return false;
      if (layout.name === "legacy" && !legacyWorks) return false;
      state.limitsSet = true;
      return true;
    },
    verifyExtendedLimits(job: JobHandle, _limits: unknown, layout: JobLayoutDescriptor): boolean {
      const state = jobs.get((job as { id: number }).id);
      if (!state || !state.limitsSet || state.closed) return false;
      return (layout.name === "modern" && modernWorks) || (layout.name === "legacy" && legacyWorks);
    },
    queryAccounting(job: JobHandle, layout: JobLayoutDescriptor) {
      const state = jobs.get((job as { id: number }).id);
      if (!state || state.closed) return null;
      const active = state.terminated ? 0 : state.pids.size;
      return {
        totalProcesses: state.pids.size,
        activeProcesses: layout.name === "legacy" ? active : state.pids.size,
        totalTerminatedProcesses: state.terminated ? 1 : 0,
      };
    },
    queryMemberPids(job: JobHandle, layout: JobLayoutDescriptor, maxPids: number) {
      if (layout.pidListClass === null) return null;
      if (options.membershipFails) return null;
      const state = jobs.get((job as { id: number }).id);
      if (!state || state.closed) return null;
      const pids = state.terminated ? [] : [...state.pids];
      return pids.length > maxPids ? null : pids;
    },
    openProcess(pid: number): JobHandle | null {
      return children.has(pid) ? { pid } : null;
    },
    assignToJob(job: JobHandle, processHandle: JobHandle): boolean {
      const state = jobs.get((job as { id: number }).id);
      if (!state || state.closed) return false;
      state.pids.add((processHandle as { pid: number }).pid);
      return true;
    },
    isProcessInJob(processHandle: JobHandle, job: JobHandle): boolean | null {
      if (options.membershipFails) return null;
      const state = jobs.get((job as { id: number }).id);
      if (!state || state.closed) return null;
      return state.pids.has((processHandle as { pid: number }).pid);
    },
    terminateJob(job: JobHandle, _exitCode: number): boolean {
      const state = jobs.get((job as { id: number }).id);
      if (!state || state.closed) return false;
      state.terminated = true;
      killMembers(state);
      return true;
    },
    waitForProcessDeath(processHandle: JobHandle): boolean {
      const child = children.get((processHandle as { pid: number }).pid);
      return child ? child.exitCode !== null : true;
    },
  };

  function killMembers(state: FakeJobState): void {
    for (const pid of [...state.pids]) {
      state.pids.delete(pid);
      children.get(pid)?.emitExit(1);
    }
  }

  /** A naturally-exiting child must also leave the job's accounting. */
  function registerChild(child: FakeChild): void {
    children.set(child.pid!, child);
    const original = child.emitExit.bind(child);
    child.emitExit = (code: number) => {
      original(code);
      for (const state of jobs.values()) state.pids.delete(child.pid!);
    };
  }
  return { api, jobs, children, nextPid: () => nextPid++, registerChild };
}

/** Fake spawn producing a child that emits a successful protocol response. */
function makeFakeSpawn(api: ReturnType<typeof makeFakeApi>, response: Record<string, unknown>) {
  return ((_exe: string, _args: string[]): ChildProcess => {
    const child = makeFakeChild(api.nextPid());
    api.registerChild(child);
    queueMicrotask(() => {
      child.emitStdout(Buffer.from(JSON.stringify(response)));
      child.emitExit(0);
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

const baseRequest = {
  schemaVersion: 1,
  adapterId: WORKER_HOST_MANIFEST.adapterId,
  input: { kind: "sha256", contentUtf8B64: Buffer.from("hello", "utf8").toString("base64") },
  limits: { timeoutMs: 5_000, maxOutputBytes: 4_096, maxInputBytes: 4_096 },
};

const okPreflight = { ok: true as const, layout: LEGACY_JOB_LAYOUT };

function spawnCounter() {
  let calls = 0;
  return {
    get count() {
      return calls;
    },
    impl: ((..._args: unknown[]) => {
      calls++;
      throw new Error("spawn must never be called in this scenario");
    }) as unknown as typeof import("node:child_process").spawn,
  };
}

/* ------------------------------------------------------------------ */
/* Fail-closed: platform / FFI / preflight                             */
/* ------------------------------------------------------------------ */

describe("fail-closed availability", () => {
  it("reports unavailable on non-Windows platforms without spawning", async () => {
    const counter = spawnCounter();
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: { "process.spawn": true },
      platform: "linux",
      spawnImpl: counter.impl,
    });
    expect(result.status).toBe("unavailable");
    expect(result.errorCode).toBe("adapter_unavailable");
    expect(counter.count).toBe(0);
    expect(result.usage).toEqual({ elapsedMs: 0, outputBytes: 0 });
    expect(result.cleanup.clean).toBe(true);
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
  });

  it("reports unavailable when the FFI layer cannot load, without spawning", async () => {
    const counter = spawnCounter();
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: { "process.spawn": true },
      platform: "win32",
      loadJobApi: async () => null,
      spawnImpl: counter.impl,
    });
    expect(result.status).toBe("unavailable");
    expect(result.errorCode).toBe("adapter_unavailable");
    expect(counter.count).toBe(0);
  });

  it("reports unavailable when the behavioral preflight fails, without spawning", async () => {
    const counter = spawnCounter();
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: { "process.spawn": true },
      platform: "win32",
      preflight: async () => ({ ok: false, reason: "terminate-unverified" }),
      spawnImpl: counter.impl,
    });
    expect(result.status).toBe("unavailable");
    expect(counter.count).toBe(0);
  });

  it("preflight fails closed on non-Windows and missing FFI (injected deps)", async () => {
    const linux = await runContainmentPreflight({ platform: "darwin" } satisfies PreflightDeps);
    expect(linux).toEqual({ ok: false, reason: "platform-unsupported" });
    const noFfi = await runContainmentPreflight({ platform: "win32", loadApi: async () => null });
    expect(noFfi).toEqual({ ok: false, reason: "ffi-unavailable" });
  });

  it("preflight fails when job limits cannot be set or verified (fake api)", async () => {
    const fake = makeFakeApi({ modernWorks: false, legacyWorks: false });
    const outcome = await runContainmentPreflight({
      platform: "win32",
      loadApi: async () => fake.api,
      killGraceMs: 100,
    });
    expect(outcome.ok).toBe(false);
  });

  it("preflight selects the legacy layout only after behavioral proof (fake api)", async () => {
    const fake = makeFakeApi({ modernWorks: false, legacyWorks: true });
    const outcome = await runContainmentPreflight({
      platform: "win32",
      loadApi: async () => fake.api,
      spawn: makeCanarySpawn(fake),
      killGraceMs: 100,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.layout.name).toBe("legacy");
  });

  it("preflight selects the modern layout when it verifies (fake api)", async () => {
    const fake = makeFakeApi({ modernWorks: true, legacyWorks: true });
    const outcome = await runContainmentPreflight({
      platform: "win32",
      loadApi: async () => fake.api,
      spawn: makeCanarySpawn(fake),
      killGraceMs: 100,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.layout.name).toBe("modern");
  });

  it("preflight fails when membership cannot be proven with either strategy", async () => {
    const fake = makeFakeApi({ modernWorks: true, legacyWorks: true, membershipFails: true });
    const outcome = await runContainmentPreflight({
      platform: "win32",
      loadApi: async () => fake.api,
      spawn: makeCanarySpawn(fake),
      killGraceMs: 100,
    });
    expect(outcome.ok).toBe(false);
  });
});

/** Fake spawn for canaries: a sleeping child the fake api can kill. */
function makeCanarySpawn(fake: ReturnType<typeof makeFakeApi>) {
  return ((..._args: unknown[]): ChildProcess => {
    const child = makeFakeChild(fake.nextPid());
    fake.registerChild(child);
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

/* ------------------------------------------------------------------ */
/* Denial / validation BEFORE spawn                                    */
/* ------------------------------------------------------------------ */

describe("denial and validation before spawn", () => {
  it("denies when process.spawn is not granted, without spawning", async () => {
    const counter = spawnCounter();
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: {},
      platform: "win32",
      spawnImpl: counter.impl,
    });
    expect(result.status).toBe("denied");
    expect(result.errorCode).toBe("permission_unmet");
    expect(counter.count).toBe(0);
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
  });

  it("denies when the capability gate is unmet, without spawning", async () => {
    // The manifest requests exactly { "process.spawn": true }; a grant object
    // missing that key must fail BOTH gates before any spawn attempt.
    const counter = spawnCounter();
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: { "fs.read": true, "net.fetch": true },
      platform: "win32",
      spawnImpl: counter.impl,
    });
    expect(result.status).toBe("denied");
    expect(result.errorCode).toBe("permission_unmet");
    expect(counter.count).toBe(0);
  });

  it("rejects requests exceeding manifest limits without spawning", async () => {
    const counter = spawnCounter();
    const result = await runWorkerHostAdapter(
      {
        ...baseRequest,
        limits: { timeoutMs: 600_000, maxOutputBytes: 4_096, maxInputBytes: 4_096 },
      },
      { granted: { "process.spawn": true }, platform: "win32", spawnImpl: counter.impl },
    );
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("limits_exceeded");
    expect(counter.count).toBe(0);
  });

  it("rejects malformed and oversized inputs without spawning", async () => {
    const counter = spawnCounter();
    const badShape = await runWorkerHostAdapter(
      { ...baseRequest, input: { kind: "exec", cmd: "dir" } },
      { granted: { "process.spawn": true }, platform: "win32", spawnImpl: counter.impl },
    );
    expect(badShape.status).toBe("failed");
    expect(badShape.errorCode).toBe("invalid_input");
    expect(counter.count).toBe(0);

    const tooLarge = await runWorkerHostAdapter(
      {
        ...baseRequest,
        input: { kind: "sha256", contentUtf8B64: "A".repeat(8192) },
      },
      { granted: { "process.spawn": true }, platform: "win32", spawnImpl: counter.impl },
    );
    expect(tooLarge.status).toBe("failed");
    expect(tooLarge.errorCode).toBe("input_too_large");
    expect(counter.count).toBe(0);
  });

  it("rejects invalid request envelopes and foreign adapter ids without spawning", async () => {
    const counter = spawnCounter();
    const invalid = await runWorkerHostAdapter(
      { ...baseRequest, schemaVersion: 2 },
      { granted: { "process.spawn": true }, platform: "win32", spawnImpl: counter.impl },
    );
    expect(invalid.status).toBe("failed");
    expect(invalid.errorCode).toBe("invalid_input");
    expect(counter.count).toBe(0);

    const foreign = await runWorkerHostAdapter(
      { ...baseRequest, adapterId: "sbadp_content-hash" },
      { granted: { "process.spawn": true }, platform: "win32", spawnImpl: counter.impl },
    );
    expect(foreign.status).toBe("failed");
    expect(foreign.errorCode).toBe("invalid_input");
    expect(counter.count).toBe(0);
  });

  it("reports cancelled before spawn when the signal is already aborted", async () => {
    const counter = spawnCounter();
    const controller = new AbortController();
    controller.abort();
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: { "process.spawn": true },
      platform: "win32",
      signal: controller.signal,
      spawnImpl: counter.impl,
    });
    expect(result.status).toBe("cancelled");
    expect(result.errorCode).toBe("cancelled");
    expect(counter.count).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Execution semantics against the fake job API                        */
/* ------------------------------------------------------------------ */

describe("execution semantics (fake job api)", () => {
  it("completes a run and reports host-attested cleanup", async () => {
    const fake = makeFakeApi({ modernWorks: false, legacyWorks: true });
    const response = { ok: true, sha256Hex: "a".repeat(64), contentBytes: 5 };
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: { "process.spawn": true },
      platform: "win32",
      preflight: async () => okPreflight,
      loadJobApi: async () => fake.api,
      spawnImpl: makeFakeSpawn(fake, response),
      killGraceMs: 250,
    });
    expect(result.status).toBe("completed");
    expect(result.data).toEqual({ sha256Hex: "a".repeat(64), contentBytes: 5 });
    expect(result.cleanup.clean).toBe(true);
    expect(result.cleanup.resourcesReleased).toEqual(["worker-process", "job-object", "temp-dir"]);
    expect(result.usage.outputBytes).toBeLessThanOrEqual(baseRequest.limits.maxOutputBytes);
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
  });

  it("marks cleanup unclean with cleanup_failed when temp-dir removal fails", async () => {
    const fake = makeFakeApi({ modernWorks: false, legacyWorks: true });
    const response = { ok: true, sha256Hex: "b".repeat(64), contentBytes: 2 };
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: { "process.spawn": true },
      platform: "win32",
      preflight: async () => okPreflight,
      loadJobApi: async () => fake.api,
      spawnImpl: makeFakeSpawn(fake, response),
      removeDir: async () => {
        throw new Error("injected removal failure");
      },
      killGraceMs: 250,
    });
    expect(result.cleanup.clean).toBe(false);
    expect(result.errorCode).toBe("cleanup_failed");
    expect(result.cleanup.resourcesReleased).not.toContain("temp-dir");
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
    // The injected failure leaves a REAL temp dir behind (mkdtemp runs even
    // against the fake job API); clean it via the documented any-age sweep
    // so the suite leaves no orphans.
    await sweepStaleWorkerTempDirs(-60_000);
    expect(readdirSync(tmpdir()).filter((e) => /^sbadp-worker-[A-Za-z0-9]{6}$/.test(e))).toEqual([]);
  });

  it("reports malformed output as a safe failed result", async () => {
    const fake = makeFakeApi({ modernWorks: false, legacyWorks: true });
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: { "process.spawn": true },
      platform: "win32",
      preflight: async () => okPreflight,
      loadJobApi: async () => fake.api,
      spawnImpl: makeFakeSpawn(fake, { completely: "wrong" }),
      killGraceMs: 250,
    });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("adapter_failed");
    expect(result.message).toBe("Worker returned malformed output");
    expect(validateSandboxAdapterResult(result).ok).toBe(true);
  });

  it("keeps every result free of paths, secrets, and environment values", async () => {
    const fake = makeFakeApi({ modernWorks: false, legacyWorks: true });
    const result = await runWorkerHostAdapter(baseRequest, {
      granted: { "process.spawn": true },
      platform: "win32",
      preflight: async () => okPreflight,
      loadJobApi: async () => fake.api,
      spawnImpl: makeFakeSpawn(fake, { ok: true, sha256Hex: "c".repeat(64), contentBytes: 1 }),
      killGraceMs: 250,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/[A-Za-z]:\\\\/);
    expect(serialized).not.toContain("sbadp-worker-");
    expect(serialized).not.toContain("SANDBOX_WORKER_PROTOCOL");
    expect(serialized).not.toMatch(/sk-|apiKey|password|token|secret/i);
    expect(serialized).not.toContain(process.execPath);
  });
});
