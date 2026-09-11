/**
 * Local worker sandbox host adapter (F10-19/F10-24).
 *
 * Runs ONE allow-listed, server-owned deterministic worker process inside a
 * Windows Job Object and returns the strict `SandboxAdapterResult` shapes
 * from `@arena/debate-engine`. Fail-closed everywhere:
 *
 * - Non-Windows, missing FFI, unprovable containment, or any preflight
 *   failure  -> `unavailable` (`adapter_unavailable`), nothing is spawned.
 * - Missing `process.spawn` grant -> `denied` BEFORE any spawn.
 * - Requests exceeding manifest limits or malformed inputs are rejected
 *   BEFORE any spawn.
 * - The host owns and attests everything: wall-clock watchdog with
 *   TerminateJobObject, output byte cap with kill, verified process-tree
 *   death, retried temp-dir cleanup, and a cleanup receipt on every
 *   terminal result. Worker-reported values are never trusted.
 * - Results are re-validated against the contract schema before being
 *   returned; a self-invalid result degrades to `unavailable`.
 *
 * This is containment and resource governance, NOT a filesystem/network
 * security boundary — see docs/security/sandbox-host.md.
 */
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxAdapterManifest, SandboxAdapterRequest, SandboxAdapterResult } from "@arena/types";
import {
  SANDBOX_LIMITS,
  deniedSandboxResult,
  inputTooLargeResult,
  unavailableSandboxResult,
  validateRequestAgainstManifest,
  validateSandboxAdapterRequest,
  validateSandboxAdapterResult,
  validateSandboxCapabilityGrant,
  validateSandboxPermissions,
} from "@arena/debate-engine";
import {
  DEFAULT_JOB_LIMITS,
  KILL_GRACE_MS,
  type JobHandle,
  type JobLayoutDescriptor,
  type WindowsJobApi,
  loadWindowsJobApi,
  verifyProcessTreeDeath,
} from "./win-job-ffi";
import {
  defaultWorkerScriptPath,
  runContainmentPreflight,
  spawnAllowListedWorker,
  workerEnvironment,
  type ContainmentPreflight,
} from "./preflight";
import { encodeWorkerRequest, parseWorkerResponse } from "./worker-protocol";

export const WORKER_HOST_ADAPTER_ID = "sbadp_worker-host";
export const WORKER_HOST_ADAPTER_VERSION = "1.0.0";

/**
 * Server-owned manifest. Requires the explicit `process.spawn` permission
 * (deny-by-default); no filesystem or network capabilities are requested.
 */
export const WORKER_HOST_MANIFEST: SandboxAdapterManifest = Object.freeze({
  schemaVersion: 1,
  adapterId: WORKER_HOST_ADAPTER_ID,
  version: WORKER_HOST_ADAPTER_VERSION,
  displayName: "Local worker host",
  description:
    "Runs the allow-listed deterministic bounded worker (SHA-256 plus bounded diagnostic ops) inside a kill-on-close Windows job object with host-enforced limits.",
  requiredPermissions: Object.freeze(["process.spawn"] as const),
  requestedCapabilities: Object.freeze({ "process.spawn": true }),
  maxLimits: Object.freeze({
    timeoutMs: SANDBOX_LIMITS.maxTimeoutMs,
    maxOutputBytes: SANDBOX_LIMITS.maxOutputBytes,
    maxInputBytes: 64 * 1024,
  }),
});

/** Expected adapter input: one bounded operation of the worker protocol. */
export type WorkerHostInput =
  | { readonly kind: "sha256"; readonly contentUtf8B64: string }
  | { readonly kind: "sleep"; readonly ms: number }
  | { readonly kind: "flood"; readonly bytes: number }
  | { readonly kind: "malformed" };

export interface WorkerHostRunOptions {
  /** Server-side sandbox capability grants (deny-by-default). */
  readonly granted: Readonly<Record<string, boolean>>;
  /** Cancel the run; the host kills the job and reports `cancelled`. */
  readonly signal?: AbortSignal;
  /** Injectable clock (ISO timestamps for cleanup receipts). */
  readonly now?: () => string;
  /* ---- test seams (fail-closed behavior is exercised through these) ---- */
  readonly platform?: string;
  readonly loadJobApi?: () => Promise<WindowsJobApi | null>;
  readonly preflight?: () => Promise<ContainmentPreflight>;
  readonly spawnImpl?: typeof nodeSpawn;
  readonly removeDir?: (path: string) => Promise<void>;
  readonly killGraceMs?: number;
}

/* ------------------------------------------------------------------ */
/* Safe message vocabulary (no paths, no secrets, bounded)             */
/* ------------------------------------------------------------------ */

const MESSAGES = Object.freeze({
  invalidRequest: "Request failed sandbox adapter validation",
  limitsExceeded: "Requested limits exceed the adapter maximum",
  permissionUnmet: "Required permission not granted: process.spawn",
  capabilityDenied: "Capability not granted: process.spawn",
  invalidInput: "Input does not match the worker host input schema",
  inputTooLarge: "Input content exceeds the requested input budget",
  unavailable: "Local worker containment could not be verified",
  jobSetupFailed: "Job object setup failed",
  spawnFailed: "Worker process could not be started",
  containmentFailed: "Worker containment could not be established",
  workerFailed: "Worker run failed",
  malformedOutput: "Worker returned malformed output",
  timeout: "Adapter run exceeded its wall-clock budget",
  cancelled: "Adapter run was cancelled",
  overflow: "Output budget exhausted",
  cleanupFailed: "Cleanup could not be fully verified",
} as const);

/* ------------------------------------------------------------------ */
/* Result construction (receipt is finalized after teardown)           */
/* ------------------------------------------------------------------ */

/**
 * What the host borrowed for this run and what it verifiably released.
 * `clean` means: every borrowed resource was verifiably released. A run
 * that never borrowed anything (denied/unavailable-before-setup) is clean
 * with an empty release list.
 */
interface ReleaseState {
  borrowed: { workerProcess: boolean; jobObject: boolean; tempDir: boolean };
  released: { workerProcess: boolean; jobObject: boolean; tempDir: boolean };
}

const RELEASE_NONE: ReleaseState = {
  borrowed: { workerProcess: false, jobObject: false, tempDir: false },
  released: { workerProcess: false, jobObject: false, tempDir: false },
};

function cleanupReceipt(released: ReleaseState, now: () => string): SandboxAdapterResult["cleanup"] {
  const resourcesReleased: string[] = [];
  if (released.borrowed.workerProcess && released.released.workerProcess) resourcesReleased.push("worker-process");
  if (released.borrowed.jobObject && released.released.jobObject) resourcesReleased.push("job-object");
  if (released.borrowed.tempDir && released.released.tempDir) resourcesReleased.push("temp-dir");
  const clean =
    (!released.borrowed.workerProcess || released.released.workerProcess) &&
    (!released.borrowed.jobObject || released.released.jobObject) &&
    (!released.borrowed.tempDir || released.released.tempDir);
  return {
    releasedAt: now(),
    resourcesReleased,
    clean,
  };
}

/** A result body whose cleanup receipt is attached after teardown. */
interface ResultBody {
  status: SandboxAdapterResult["status"];
  errorCode: SandboxAdapterResult["errorCode"];
  message: string;
  usage: { elapsedMs: number; outputBytes: number };
  data?: Record<string, string | number | boolean | null>;
}

function withReceipt(body: ResultBody, released: ReleaseState, now: () => string): SandboxAdapterResult {
  const clean =
    (!released.borrowed.workerProcess || released.released.workerProcess) &&
    (!released.borrowed.jobObject || released.released.jobObject) &&
    (!released.borrowed.tempDir || released.released.tempDir);
  // Contract rule: an unclean receipt REQUIRES the cleanup_failed error code,
  // regardless of the run status (e.g. a timed-out run whose temp dir could
  // not be removed reports status timed_out + errorCode cleanup_failed).
  const errorCode = clean ? body.errorCode : "cleanup_failed";
  const message =
    body.message !== "" ? body.message : clean ? "" : MESSAGES.cleanupFailed;
  return {
    schemaVersion: 1,
    adapterId: WORKER_HOST_ADAPTER_ID,
    adapterVersion: WORKER_HOST_ADAPTER_VERSION,
    status: body.status,
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(message !== "" ? { message } : {}),
    ...(body.data !== undefined ? { data: body.data } : {}),
    usage: body.usage,
    cleanup: cleanupReceipt(released, now),
  } as SandboxAdapterResult;
}

function immediateResult(body: Omit<ResultBody, "usage"> & { usage?: ResultBody["usage"] }, now: () => string): SandboxAdapterResult {
  return withReceipt(
    { ...body, usage: body.usage ?? { elapsedMs: 0, outputBytes: 0 } },
    RELEASE_NONE,
    now,
  );
}

/* ------------------------------------------------------------------ */
/* Temp-dir hygiene                                                    */
/* ------------------------------------------------------------------ */

const TEMP_DIR_PREFIX = "sbadp-worker-";
const TEMP_DIR_PATTERN = /^sbadp-worker-[A-Za-z0-9]{6}$/;
const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_MAX_ENTRIES = 32;

async function removeDirWithRetries(path: string, attempts = 3, delayMs = 50): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 });
      return true;
    } catch {
      if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

/**
 * Best-effort sweep of stale worker temp dirs (crash leftovers). Only
 * directories matching the strict `sbadp-worker-XXXXXX` pattern under the
 * OS temp dir AND older than 24h are removed; per-entry errors are swallowed.
 * See docs/security/sandbox-host.md for the safety argument.
 */
export async function sweepStaleWorkerTempDirs(
  olderThanMs: number = SWEEP_MIN_AGE_MS,
  nowMs: number = Date.now(),
): Promise<number> {
  let removed = 0;
  try {
    const entries = await readdir(tmpdir());
    const candidates = entries.filter((entry) => TEMP_DIR_PATTERN.test(entry)).slice(0, SWEEP_MAX_ENTRIES);
    for (const entry of candidates) {
      try {
        const fullPath = join(tmpdir(), entry);
        const stats = await stat(fullPath);
        if (!stats.isDirectory()) continue;
        if (nowMs - stats.mtimeMs < olderThanMs) continue;
        if (await removeDirWithRetries(fullPath)) removed++;
      } catch {
        /* skip unreachable entries */
      }
    }
  } catch {
    /* temp dir unreadable — sweep is best-effort only */
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* Run state machine                                                   */
/* ------------------------------------------------------------------ */

type RunOutcome =
  | { kind: "completed"; data: Record<string, string | number | boolean | null> }
  | { kind: "timed_out" }
  | { kind: "cancelled" }
  | { kind: "overflow" }
  | { kind: "failed"; message: string };

interface RunState {
  outcome: RunOutcome | null;
  outputBytes: number;
  stdoutChunks: Buffer[];
  killed: boolean;
}

function terminateJob(api: WindowsJobApi, job: JobHandle, state: RunState): void {
  if (state.killed || !job) return;
  state.killed = true;
  try {
    api.terminateJob(job, 1);
  } catch {
    /* the kill-on-close handle release is the backstop */
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
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

function classifyNaturalExit(child: ChildProcess, stdoutText: string): RunOutcome {
  if (child.exitCode !== 0) {
    return { kind: "failed", message: MESSAGES.workerFailed };
  }
  const parsed = parseWorkerResponse(stdoutText.trim());
  if (!parsed.ok) {
    return { kind: "failed", message: MESSAGES.malformedOutput };
  }
  const response = parsed.data;
  if (!response.ok) {
    return { kind: "failed", message: MESSAGES.workerFailed };
  }
  // Host-attested data projection: only bounded scalar fields the protocol
  // declares, never raw worker text.
  const data: Record<string, string | number | boolean | null> = {};
  if (typeof response.sha256Hex === "string") data.sha256Hex = response.sha256Hex;
  if (typeof response.contentBytes === "number") data.contentBytes = response.contentBytes;
  if (typeof response.sleptMs === "number") data.sleptMs = response.sleptMs;
  if (typeof response.spawnedChildren === "number") data.spawnedChildren = response.spawnedChildren;
  return { kind: "completed", data };
}

function verifyMembership(
  api: WindowsJobApi,
  layout: JobLayoutDescriptor,
  job: JobHandle,
  processHandle: JobHandle,
  pid: number,
): boolean {
  if (layout.pidListClass !== null) {
    const pids = api.queryMemberPids(job, layout, 16);
    return !!pids && pids.includes(pid);
  }
  return api.isProcessInJob(processHandle, job) === true;
}

/** Decode + bound-check the adapter input BEFORE anything is spawned. */
function parseAdapterInput(
  request: SandboxAdapterRequest,
): { ok: true; payload: string } | { ok: false; reason: "invalid" | "too_large" } {
  const input = request.input as Partial<WorkerHostInput> | null | undefined;
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "invalid" };
  }
  switch (input.kind) {
    case "sha256": {
      const contentB64 = (input as { contentUtf8B64?: unknown }).contentUtf8B64;
      if (typeof contentB64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentB64)) {
        return { ok: false, reason: "invalid" };
      }
      const content = Buffer.from(contentB64, "base64");
      if (content.length > request.limits.maxInputBytes) {
        return { ok: false, reason: "too_large" };
      }
      try {
        return { ok: true, payload: encodeWorkerRequest({ v: 1, op: "sha256", contentB64 }) };
      } catch {
        return { ok: false, reason: "too_large" };
      }
    }
    case "sleep": {
      const ms = (input as { ms?: unknown }).ms;
      if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 0 || ms > 120_000) {
        return { ok: false, reason: "invalid" };
      }
      return { ok: true, payload: encodeWorkerRequest({ v: 1, op: "sleep", ms }) };
    }
    case "flood": {
      const bytes = (input as { bytes?: unknown }).bytes;
      if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0 || bytes > 4 * 1024 * 1024) {
        return { ok: false, reason: "invalid" };
      }
      return { ok: true, payload: encodeWorkerRequest({ v: 1, op: "flood", bytes }) };
    }
    case "malformed":
      return { ok: true, payload: encodeWorkerRequest({ v: 1, op: "malformed" }) };
    default:
      return { ok: false, reason: "invalid" };
  }
}

/**
 * Execute one bounded worker run. Assumes validation, grants, and preflight
 * already passed. Every failure path terminates the job, verifies death,
 * cleans the temp dir, and reports a schema-safe result.
 */
async function executeWorkerRun(
  request: SandboxAdapterRequest,
  payload: string,
  preflight: ContainmentPreflight & { ok: true },
  options: WorkerHostRunOptions,
  startedAtMs: number,
): Promise<SandboxAdapterResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
  const layout = preflight.layout;
  const loadApi = options.loadJobApi ?? loadWindowsJobApi;
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const removeDir = options.removeDir ?? removeDirWithRetries;

  const api = await loadApi();
  if (!api) {
    return unavailableSandboxResult(WORKER_HOST_MANIFEST, MESSAGES.unavailable, now());
  }

  // Isolated temp dir; the worker's cwd and TMP/TEMP point here.
  const tempDir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));

  let job: JobHandle | null = null;
  let processHandle: JobHandle | null = null;
  let child: ChildProcess | null = null;
  const state: RunState = { outcome: null, outputBytes: 0, stdoutChunks: [], killed: false };
  // The temp dir is borrowed unconditionally (created before anything else).
  const released: ReleaseState = {
    borrowed: { workerProcess: false, jobObject: false, tempDir: true },
    released: { workerProcess: false, jobObject: false, tempDir: false },
  };
  const cap = request.limits.maxOutputBytes;
  // Slack so the overflow kill decision stays deterministic for chunky writes.
  const captureSlack = 64 * 1024;
  let watchdog: NodeJS.Timeout | null = null;
  let onAbort: (() => void) | null = null;

  /** Deterministic teardown, then attach the attested cleanup receipt. */
  const finish = async (body: ResultBody): Promise<SandboxAdapterResult> => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    if (onAbort && options.signal) {
      options.signal.removeEventListener("abort", onAbort);
      onAbort = null;
    }
    if (child && child.exitCode === null && child.signalCode === null && !state.killed) {
      terminateJob(api, job, state);
    }
    if (child) {
      const exited = await waitForChildExit(child, killGraceMs);
      released.released.workerProcess =
        exited && (child.exitCode !== null || child.signalCode !== null);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
    }
    if (job) {
      const death = verifyProcessTreeDeath(api, job, layout, processHandle, null, Math.min(killGraceMs, 2000));
      released.released.jobObject = api.closeHandle(job) && death.jobEmpty;
    }
    if (processHandle) {
      api.closeHandle(processHandle);
    }
    try {
      const outcome = await removeDir(tempDir);
      released.released.tempDir = outcome !== false;
    } catch {
      released.released.tempDir = false;
    }
    return withReceipt(body, released, now);
  };

  try {
    job = api.createJob();
    if (!job) {
      return await finish({ status: "unavailable", errorCode: "adapter_unavailable", message: MESSAGES.jobSetupFailed, usage: { elapsedMs: 0, outputBytes: 0 } });
    }
    released.borrowed.jobObject = true;
    if (!api.setExtendedLimits(job, DEFAULT_JOB_LIMITS, layout) || !api.verifyExtendedLimits(job, DEFAULT_JOB_LIMITS, layout)) {
      return await finish({ status: "unavailable", errorCode: "adapter_unavailable", message: MESSAGES.jobSetupFailed, usage: { elapsedMs: 0, outputBytes: 0 } });
    }

    child = spawnAllowListedWorker(
      { spawn: spawnImpl, execPath: process.execPath, workerScriptPath: defaultWorkerScriptPath() },
      payload,
      { cwd: tempDir, env: workerEnvironment(tempDir) },
    );
    if (!child.pid) {
      return await finish({ status: "failed", errorCode: "adapter_failed", message: MESSAGES.spawnFailed, usage: { elapsedMs: 0, outputBytes: 0 } });
    }
    released.borrowed.workerProcess = true;

    // Containment: assign to the job and VERIFY membership before any I/O.
    processHandle = api.openProcess(child.pid);
    if (!processHandle) {
      terminateJob(api, job, state);
      return await finish({ status: "unavailable", errorCode: "adapter_unavailable", message: MESSAGES.containmentFailed, usage: { elapsedMs: 0, outputBytes: 0 } });
    }
    if (!api.assignToJob(job, processHandle)) {
      terminateJob(api, job, state);
      return await finish({ status: "unavailable", errorCode: "adapter_unavailable", message: MESSAGES.containmentFailed, usage: { elapsedMs: 0, outputBytes: 0 } });
    }
    if (!verifyMembership(api, layout, job, processHandle, child.pid)) {
      terminateJob(api, job, state);
      return await finish({ status: "unavailable", errorCode: "adapter_unavailable", message: MESSAGES.containmentFailed, usage: { elapsedMs: 0, outputBytes: 0 } });
    }

    // I/O wiring: bounded stdout capture + host-side output accounting.
    const onOutput = (chunk: Buffer): void => {
      state.outputBytes += chunk.length;
      if (state.stdoutChunks.length < 4096 && state.outputBytes <= cap + captureSlack) {
        state.stdoutChunks.push(Buffer.from(chunk));
      }
      if (state.outputBytes > cap && state.outcome === null) {
        state.outcome = { kind: "overflow" };
        terminateJob(api, job, state);
      }
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.on("error", () => {
      if (state.outcome === null) state.outcome = { kind: "failed", message: MESSAGES.workerFailed };
    });

    // Hard wall-clock watchdog: host-owned kill, never worker cooperation.
    watchdog = setTimeout(() => {
      if (state.outcome === null) {
        state.outcome = { kind: "timed_out" };
        terminateJob(api, job, state);
      }
    }, request.limits.timeoutMs);

    // Cancellation: host-owned kill on abort.
    if (options.signal) {
      if (options.signal.aborted) {
        state.outcome = { kind: "cancelled" };
        terminateJob(api, job, state);
      } else {
        onAbort = () => {
          if (state.outcome === null) {
            state.outcome = { kind: "cancelled" };
            terminateJob(api, job, state);
          }
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    // Feed the bounded request, then close stdin.
    try {
      child.stdin?.write(payload + "\n");
      child.stdin?.end();
    } catch {
      if (state.outcome === null) state.outcome = { kind: "failed", message: MESSAGES.workerFailed };
    }

    // Await termination (exit event). The watchdog bounds the wait.
    const exited = await waitForChildExit(child, request.limits.timeoutMs + killGraceMs);
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    if (!exited && state.outcome === null) {
      state.outcome = { kind: "failed", message: MESSAGES.workerFailed };
      terminateJob(api, job, state);
      await waitForChildExit(child, killGraceMs);
    }

    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    const usage = { elapsedMs, outputBytes: Math.min(state.outputBytes, cap) };
    const outcome: RunOutcome =
      state.outcome ?? classifyNaturalExit(child, Buffer.concat(state.stdoutChunks).toString("utf8"));

    let body: ResultBody;
    switch (outcome.kind) {
      case "completed":
        body = { status: "completed", errorCode: undefined, message: "", usage, data: outcome.data };
        break;
      case "timed_out":
        body = { status: "timed_out", errorCode: "timeout", message: MESSAGES.timeout, usage };
        break;
      case "cancelled":
        body = { status: "cancelled", errorCode: "cancelled", message: MESSAGES.cancelled, usage };
        break;
      case "overflow":
        body = { status: "resource_exhausted", errorCode: "limits_exceeded", message: MESSAGES.overflow, usage };
        break;
      case "failed":
        body = { status: "failed", errorCode: "adapter_failed", message: outcome.message, usage };
        break;
    }
    return await finish(body);
  } catch {
    // Unexpected host error: fail closed with a generic safe message.
    return await finish({
      status: "failed",
      errorCode: "adapter_failed",
      message: MESSAGES.workerFailed,
      usage: { elapsedMs: Math.max(0, Date.now() - startedAtMs), outputBytes: 0 },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Adapter entry point                                                 */
/* ------------------------------------------------------------------ */

/**
 * Run one bounded, sandboxed worker request. This is the adapter entry point.
 */
export async function runWorkerHostAdapter(
  request: unknown,
  options: WorkerHostRunOptions,
): Promise<SandboxAdapterResult> {
  const now = options.now ?? (() => new Date().toISOString());

  // 1. Contract validation (no spawn on any failure).
  const parsedRequest = validateSandboxAdapterRequest(request);
  if (!parsedRequest.ok || parsedRequest.data.adapterId !== WORKER_HOST_ADAPTER_ID) {
    return immediateResult({ status: "failed", errorCode: "invalid_input", message: MESSAGES.invalidRequest }, now);
  }
  const req: SandboxAdapterRequest = parsedRequest.data;

  const limitsCheck = validateRequestAgainstManifest(req, WORKER_HOST_MANIFEST);
  if (!limitsCheck.ok) {
    return immediateResult({ status: "failed", errorCode: "limits_exceeded", message: MESSAGES.limitsExceeded }, now);
  }

  // 2. Deny-by-default permission/capability gates — BEFORE any spawn.
  const permissionCheck = validateSandboxPermissions(WORKER_HOST_MANIFEST, options.granted);
  if (!permissionCheck.ok) {
    return deniedSandboxResult(WORKER_HOST_MANIFEST, "permission_unmet", MESSAGES.permissionUnmet, now());
  }
  const capabilityCheck = validateSandboxCapabilityGrant(WORKER_HOST_MANIFEST, options.granted);
  if (!capabilityCheck.ok) {
    return deniedSandboxResult(WORKER_HOST_MANIFEST, "capability_denied", MESSAGES.capabilityDenied, now());
  }

  // 3. Input validation — BEFORE any spawn.
  const input = parseAdapterInput(req);
  if (!input.ok) {
    if (input.reason === "too_large") {
      return inputTooLargeResult(WORKER_HOST_MANIFEST, MESSAGES.inputTooLarge, now());
    }
    return immediateResult({ status: "failed", errorCode: "invalid_input", message: MESSAGES.invalidInput }, now);
  }

  // 4. Cancellation before spawn.
  if (options.signal?.aborted) {
    return immediateResult({ status: "cancelled", errorCode: "cancelled", message: MESSAGES.cancelled }, now);
  }

  // 5. Behavioral containment preflight (cached on real runs; injected deps
  //    bypass the cache for deterministic fail-closed tests).
  const injectedDeps =
    options.platform !== undefined || options.loadJobApi !== undefined || options.spawnImpl !== undefined
      ? {
          ...(options.platform !== undefined ? { platform: options.platform } : {}),
          ...(options.loadJobApi !== undefined ? { loadApi: options.loadJobApi } : {}),
          ...(options.spawnImpl !== undefined ? { spawn: options.spawnImpl } : {}),
        }
      : {};
  const preflight = options.preflight ? await options.preflight() : await runContainmentPreflight(injectedDeps);
  if (!preflight.ok) {
    return unavailableSandboxResult(WORKER_HOST_MANIFEST, MESSAGES.unavailable, now());
  }

  // 6. Execute.
  const result = await executeWorkerRun(req, input.payload, preflight, options, Date.now());

  // 7. Re-validate our own result against the contract; fail closed if the
  //    host ever produced a schema-invalid result.
  const validated = validateSandboxAdapterResult(result);
  if (!validated.ok) {
    return unavailableSandboxResult(WORKER_HOST_MANIFEST, MESSAGES.cleanupFailed, now());
  }
  return validated.data;
}

export { runContainmentPreflight, resetContainmentPreflightCache } from "./preflight";
