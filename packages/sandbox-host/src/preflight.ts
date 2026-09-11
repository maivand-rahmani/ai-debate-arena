/**
 * Behavioral containment preflight for the local sandbox host (F10-19).
 *
 * The host NEVER claims isolation from configuration alone. Before the first
 * run (and cached afterwards), this module PROVES that the detected Job
 * Object layout can actually contain a process on this machine:
 *
 * 1. Platform must be Windows and the koffi/kernel32 bindings must load.
 * 2. For each candidate layout (modern 168-byte, then legacy 144-byte):
 *    a. Job limits (kill-on-close, active-process cap, per-process memory
 *       cap) must be accepted AND read back unchanged.
 *    b. A server-owned canary worker must be spawnable, assignable to the
 *       job, and verifiably a member (PID list on the legacy ABI,
 *       IsProcessInJob on the modern ABI) with job accounting agreeing.
 *    c. TerminateJobObject must actually kill the canary within a bounded
 *       grace period.
 *    d. Closing the job handle (kill-on-close) must kill a second canary.
 * 3. Only a layout that passes ALL steps is remembered. Anything else is a
 *    fail-closed `unavailable` outcome — no worker is ever spawned by the
 *    adapter without a passing preflight.
 *
 * The canaries are the same allow-listed server-owned worker script the
 * adapter runs; nothing client-controlled is ever executed here.
 */
import type { ChildProcess } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_JOB_LIMITS,
  KILL_GRACE_MS,
  LEGACY_JOB_LAYOUT,
  MODERN_JOB_LAYOUT,
  type JobHandle,
  type JobLayoutDescriptor,
  type WindowsJobApi,
  loadWindowsJobApi,
} from "./win-job-ffi";
import { encodeWorkerRequest } from "./worker-protocol";

/** Bounded, path-free reason tokens (safe to surface in diagnostics). */
export type PreflightFailureReason =
  | "platform-unsupported"
  | "ffi-unavailable"
  | "limits-unverifiable"
  | "canary-spawn-failed"
  | "membership-unverifiable"
  | "terminate-unverified"
  | "kill-on-close-unverified";

export type ContainmentPreflight =
  | { readonly ok: true; readonly layout: JobLayoutDescriptor }
  | { readonly ok: false; readonly reason: PreflightFailureReason };

export interface PreflightDeps {
  readonly platform?: string;
  readonly loadApi?: () => Promise<WindowsJobApi | null>;
  readonly spawn?: typeof nodeSpawn;
  readonly execPath?: string;
  readonly workerScriptPath?: string;
  readonly killGraceMs?: number;
}

export interface SpawnedCanary {
  readonly child: ChildProcess;
  readonly processHandle: JobHandle | null;
  readonly pid: number;
}

/** Resolve the bundled worker script path (server-owned, allow-listed). */
export function defaultWorkerScriptPath(): string {
  return fileURLToPath(new URL("./worker/deterministic-worker.mjs", import.meta.url));
}

/** Scrubbed minimal environment for worker/canary processes. */
export function workerEnvironment(tempDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  const inherited = ["SystemRoot", "SYSTEMROOT", "SystemDrive", "SYSTEMDRIVE"];
  for (const key of inherited) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 128) {
      env[key] = value;
    }
  }
  env.TEMP = tempDir;
  env.TMP = tempDir;
  env.SANDBOX_WORKER_PROTOCOL = "1";
  return env;
}

/**
 * Spawn one allow-listed canary/worker process. The caller owns stdin: it
 * must write exactly one bounded protocol request line and end the stream.
 */
export function spawnAllowListedWorker(
  deps: Required<Pick<PreflightDeps, "spawn" | "execPath" | "workerScriptPath">>,
  requestPayload: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): ChildProcess {
  return deps.spawn(deps.execPath, [deps.workerScriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
    detached: false,
    env: options.env ?? workerEnvironment(options.cwd ?? tmpdir()),
    cwd: options.cwd ?? tmpdir(),
  });
}

function writeStdinAndEnd(child: ChildProcess, payload: string): boolean {
  try {
    child.stdin?.write(payload + "\n");
    child.stdin?.end();
    return true;
  } catch {
    return false;
  }
}

async function waitForExitEvent(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

/**
 * One canary round: spawn, assign, verify membership + accounting, then
 * either TerminateJobObject or plain CloseHandle (kill-on-close) and require
 * observed death. Returns false on any unverifiable step.
 */
async function verifyCanaryKill(
  api: WindowsJobApi,
  layout: JobLayoutDescriptor,
  deps: Required<Pick<PreflightDeps, "spawn" | "execPath" | "workerScriptPath">> & { killGraceMs: number },
  mode: "terminate" | "kill-on-close",
): Promise<boolean> {
  const job = api.createJob();
  if (!job) return false;
  let processHandle: JobHandle | null = null;
  let child: ChildProcess | null = null;
  let jobClosed = false;
  try {
    if (!api.setExtendedLimits(job, DEFAULT_JOB_LIMITS, layout)) return false;
    if (!api.verifyExtendedLimits(job, DEFAULT_JOB_LIMITS, layout)) return false;

    child = spawnAllowListedWorker(deps, encodeWorkerRequest({ v: 1, op: "sleep", ms: 60_000 }));
    if (child.pid === undefined) return false;
    if (!writeStdinAndEnd(child, encodeWorkerRequest({ v: 1, op: "sleep", ms: 60_000 }))) return false;

    // Give the OS a moment to register the process, then assign + verify.
    await new Promise((resolve) => setTimeout(resolve, 100));
    processHandle = api.openProcess(child.pid);
    if (!processHandle) return false;
    if (!api.assignToJob(job, processHandle)) return false;

    // Membership must be provable with the layout's own strategy.
    if (layout.pidListClass !== null) {
      const pids = api.queryMemberPids(job, layout, 16);
      if (!pids || !pids.includes(child.pid)) return false;
    } else {
      const inJob = api.isProcessInJob(processHandle, job);
      if (inJob !== true) return false;
    }
    const accounting = api.queryAccounting(job, layout);
    if (!accounting || accounting.activeProcesses < 1) return false;

    if (mode === "terminate") {
      if (!api.terminateJob(job, 1)) return false;
    } else {
      // kill-on-close proof: release the LAST job handle without terminating.
      if (!api.closeHandle(job)) return false;
      jobClosed = true;
    }
    const died = await waitForExitEvent(child, deps.killGraceMs);
    if (!died) return false;
    if (processHandle && !api.waitForProcessDeath(processHandle, deps.killGraceMs)) return false;
    const after = api.queryAccounting(job, layout);
    if (after && after.activeProcesses !== 0) return false;
    return true;
  } finally {
    // Backstop termination + handle release; errors cannot undo the verdict
    // above because death was already observed for successful runs.
    if (!jobClosed) {
      try {
        api.terminateJob(job, 1);
      } catch {
        /* backstop only */
      }
    }
    if (processHandle) api.closeHandle(processHandle);
    if (!jobClosed) api.closeHandle(job);
    if (child) {
      await waitForExitEvent(child, deps.killGraceMs);
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
  }
}

/**
 * Run the full behavioral preflight. Injected deps bypass (and do not touch)
 * the module-level cache so tests can exercise every failure path.
 */
export async function runContainmentPreflight(deps: PreflightDeps = {}): Promise<ContainmentPreflight> {
  const injected = Object.keys(deps).length > 0;
  if (!injected && cachedPreflight) return cachedPreflight;

  const run = async (): Promise<ContainmentPreflight> => {
    const platform = deps.platform ?? process.platform;
    if (platform !== "win32") return { ok: false, reason: "platform-unsupported" };

    const api = deps.loadApi ? await deps.loadApi() : await loadWindowsJobApi();
    if (!api) return { ok: false, reason: "ffi-unavailable" };

    const fullDeps = {
      spawn: deps.spawn ?? nodeSpawn,
      execPath: deps.execPath ?? process.execPath,
      workerScriptPath: deps.workerScriptPath ?? defaultWorkerScriptPath(),
      killGraceMs: deps.killGraceMs ?? KILL_GRACE_MS,
    };

    for (const layout of [MODERN_JOB_LAYOUT, LEGACY_JOB_LAYOUT]) {
      if (await verifyCanaryKill(api, layout, fullDeps, "terminate")) {
        if (await verifyCanaryKill(api, layout, fullDeps, "kill-on-close")) {
          return { ok: true, layout };
        }
      }
    }
    return { ok: false, reason: "terminate-unverified" };
  };

  if (injected) return run();
  cachedPreflight = run();
  return cachedPreflight;
}

/** Forget any cached preflight verdict (used by tests and revalidation). */
export function resetContainmentPreflightCache(): void {
  cachedPreflight = null;
}

let cachedPreflight: Promise<ContainmentPreflight> | null = null;
