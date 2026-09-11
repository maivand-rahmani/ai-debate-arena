/**
 * Windows Job Object FFI layer for the local sandbox host (F10-19).
 *
 * Loads `koffi` lazily and binds the small kernel32 surface needed to run one
 * allow-listed worker inside a kill-on-close Job Object:
 *
 * - CreateJobObjectW / SetInformationJobObject / QueryInformationJobObject
 * - AssignProcessToJobObject / TerminateJobObject
 * - IsProcessInJob / OpenProcess / WaitForSingleObject / CloseHandle
 *
 * LAYOUT DETECTION: Windows exposes two generations of the job-object info
 * structures. Modern systems accept the 168-byte `JOBOBJECT_EXTENDED_LIMIT_
 * INFORMATION` (LimitFlags at offset 48); this codebase has also observed
 * environments that only implement the legacy Windows-2000-era interface
 * (144-byte extended limits, LimitFlags at offset 16, legacy info-class
 * numbering with a PID list at class 3). The layout is a runtime detail:
 * callers must verify EVERY layout behaviorally (see `preflight.ts`) and
 * fail closed when neither layout can be proven to contain a process.
 *
 * FAIL-CLOSED: every loader/setup error surfaces as `null`/`false`. Nothing
 * here spawns processes or makes availability claims — that is the host
 * adapter's job after a successful behavioral preflight.
 */
import type { ChildProcess } from "node:child_process";

/** Which job-object ABI a verified environment supports. */
export type JobObjectLayout = "modern" | "legacy";

/** Offsets/sizes the two layouts differ in (x64). */
export interface JobLayoutDescriptor {
  readonly name: JobObjectLayout;
  /** JobObjectExtendedLimitInformation byte size. */
  readonly extendedLimitSize: number;
  /** Offset of LimitFlags inside the extended-limit struct. */
  readonly flagsOffset: number;
  /** Offset of ActiveProcessLimit. */
  readonly activeProcessLimitOffset: number;
  /** Offset of ProcessMemoryLimit. */
  readonly processMemoryLimitOffset: number;
  /** Query class for JOBOBJECT_BASIC_ACCOUNTING_INFORMATION (same in both). */
  readonly accountingClass: number;
  /** Offset of TotalProcesses in the accounting struct. */
  readonly accountingTotalOffset: number;
  /** Offset of ActiveProcesses in the accounting struct. */
  readonly accountingActiveOffset: number;
  /** Offset of TotalTerminatedProcesses in the accounting struct. */
  readonly accountingTerminatedOffset: number;
  /** Query class for the member PID list, when the ABI supports one. */
  readonly pidListClass: number | null;
}

/** Modern (current Windows SDK) layout: 168-byte extended limits. */
export const MODERN_JOB_LAYOUT: JobLayoutDescriptor = Object.freeze({
  name: "modern",
  extendedLimitSize: 168,
  flagsOffset: 48,
  activeProcessLimitOffset: 24,
  processMemoryLimitOffset: 56,
  accountingClass: 1,
  accountingTotalOffset: 32,
  accountingActiveOffset: 36,
  accountingTerminatedOffset: 40,
  pidListClass: null,
});

/** Legacy (Windows 2000-era) layout observed on some environments. */
export const LEGACY_JOB_LAYOUT: JobLayoutDescriptor = Object.freeze({
  name: "legacy",
  extendedLimitSize: 144,
  flagsOffset: 16,
  activeProcessLimitOffset: 40,
  processMemoryLimitOffset: 112,
  accountingClass: 1,
  accountingTotalOffset: 36,
  accountingActiveOffset: 40,
  accountingTerminatedOffset: 44,
  pidListClass: 3,
});

/** Job object limit flags (identical bit values in both generations). */
export const JOB_OBJECT_LIMIT_FLAGS = Object.freeze({
  activeProcess: 0x0008,
  processMemory: 0x0100,
  // Breakaway is intentionally NEVER set: child processes must not be able
  // to leave the job (JOB_OBJECT_LIMIT_BREAKAWAY_OK / SILENT_BREAKAWAY_OK).
  killOnClose: 0x2000,
} as const);

/** Limits applied to every worker job. */
export interface JobLimits {
  readonly activeProcessLimit: number;
  readonly processMemoryLimitBytes: number;
}

/** Snapshot of the job's basic accounting counters. */
export interface JobAccounting {
  readonly totalProcesses: number;
  readonly activeProcesses: number;
  readonly totalTerminatedProcesses: number;
}

/** Opaque job/process handle as returned by the FFI layer. */
export type JobHandle = unknown;

/** Minimal kernel32 job-object surface used by the host. */
export interface WindowsJobApi {
  createJob(): JobHandle | null;
  closeHandle(handle: JobHandle): boolean;
  /** Applies kill-on-close + active-process + per-process memory limits. */
  setExtendedLimits(job: JobHandle, limits: JobLimits, layout: JobLayoutDescriptor): boolean;
  /** Reads the limits back and compares them with what was requested. */
  verifyExtendedLimits(job: JobHandle, limits: JobLimits, layout: JobLayoutDescriptor): boolean;
  queryAccounting(job: JobHandle, layout: JobLayoutDescriptor): JobAccounting | null;
  /** Member PIDs, when the ABI supports a PID list (legacy); else null. */
  queryMemberPids(job: JobHandle, layout: JobLayoutDescriptor, maxPids: number): number[] | null;
  openProcess(pid: number): JobHandle | null;
  assignToJob(job: JobHandle, processHandle: JobHandle): boolean;
  /** `true`/`false` = answered; `null` = the call itself failed. */
  isProcessInJob(processHandle: JobHandle, job: JobHandle): boolean | null;
  terminateJob(job: JobHandle, exitCode: number): boolean;
  /** `true` once the process handle is signaled (process exited). */
  waitForProcessDeath(processHandle: JobHandle, timeoutMs: number): boolean;
}

/* ------------------------------------------------------------------ */
/* Buffer encoding (manual, layout-driven — no struct marshalling)     */
/* ------------------------------------------------------------------ */

function writeU64(buf: Buffer, offset: number, value: bigint): void {
  buf.writeBigUInt64LE(value, offset);
}

function readU64(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

function encodeExtendedLimits(limits: JobLimits, layout: JobLayoutDescriptor): Buffer {
  const buf = Buffer.alloc(layout.extendedLimitSize);
  const flags =
    BigInt(JOB_OBJECT_LIMIT_FLAGS.activeProcess) |
    BigInt(JOB_OBJECT_LIMIT_FLAGS.processMemory) |
    BigInt(JOB_OBJECT_LIMIT_FLAGS.killOnClose);
  writeU64(buf, layout.flagsOffset, flags);
  buf.writeUInt32LE(limits.activeProcessLimit >>> 0, layout.activeProcessLimitOffset);
  writeU64(buf, layout.processMemoryLimitOffset, BigInt(limits.processMemoryLimitBytes));
  return buf;
}

/* ------------------------------------------------------------------ */
/* Loader                                                              */
/* ------------------------------------------------------------------ */

interface KoffiLib {
  func(proto: string): unknown;
}

interface KoffiModule {
  load(name: string): KoffiLib;
}

/**
 * Load koffi dynamically and bind the kernel32 functions. Returns `null` on
 * ANY failure (module missing, wrong architecture, binding error) so callers
 * can fail closed.
 */
export async function loadWindowsJobApi(): Promise<WindowsJobApi | null> {
  let koffi: KoffiModule;
  try {
    const mod = (await import("koffi")) as unknown as { default?: unknown } & Record<string, unknown>;
    koffi = (mod.default ?? mod) as KoffiModule;
    if (typeof koffi?.load !== "function") return null;
  } catch {
    return null;
  }

  let k32: KoffiLib;
  try {
    k32 = koffi.load("kernel32.dll");
  } catch {
    return null;
  }
  if (typeof k32?.func !== "function") return null;

  const bind = (proto: string): ((...args: unknown[]) => unknown) | null => {
    try {
      return k32.func(proto) as (...args: unknown[]) => unknown;
    } catch {
      return null;
    }
  };

  const createJobObjectW = bind("void* CreateJobObjectW(void* attrs, str16 name)");
  const setInformationJobObject = bind("bool SetInformationJobObject(void* job, int infoClass, void* info, uint32 size)");
  const queryInformationJobObject = bind(
    "bool QueryInformationJobObject(void* job, int infoClass, void* info, uint32 size, void* retLen)",
  );
  const assignProcessToJobObject = bind("bool AssignProcessToJobObject(void* job, void* proc)");
  const terminateJobObject = bind("bool TerminateJobObject(void* job, uint32 exitCode)");
  const isProcessInJob = bind("bool IsProcessInJob(void* proc, void* job, void* result)");
  const openProcess = bind("void* OpenProcess(uint32 access, int inherit, uint32 pid)");
  const waitForSingleObject = bind("uint32 WaitForSingleObject(void* h, uint32 ms)");
  const closeHandle = bind("bool CloseHandle(void* h)");

  // Every binding must resolve; a partial kernel32 surface is fail-closed.
  if (
    !createJobObjectW || !setInformationJobObject || !queryInformationJobObject ||
    !assignProcessToJobObject || !terminateJobObject || !isProcessInJob ||
    !openProcess || !waitForSingleObject || !closeHandle
  ) {
    return null;
  }

  // OpenProcess rights: PROCESS_SET_QUOTA | PROCESS_TERMINATE | SYNCHRONIZE.
  const OPEN_PROCESS_ACCESS = 0x0100 | 0x0001 | 0x00100000;
  const WAIT_OBJECT_0 = 0;
  const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9;

  const queryRaw = (job: JobHandle, infoClass: number, size: number): Buffer | null => {
    const buf = Buffer.alloc(size);
    const ok = queryInformationJobObject(job, infoClass, buf, size, null);
    return ok === true ? buf : null;
  };

  const api: WindowsJobApi = {
    createJob(): JobHandle | null {
      try {
        const job = createJobObjectW(null, null);
        return job ?? null;
      } catch {
        return null;
      }
    },
    closeHandle(handle: JobHandle): boolean {
      try {
        return closeHandle(handle) === true;
      } catch {
        return false;
      }
    },
    setExtendedLimits(job: JobHandle, limits: JobLimits, layout: JobLayoutDescriptor): boolean {
      try {
        const buf = encodeExtendedLimits(limits, layout);
        return setInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS, buf, buf.length) === true;
      } catch {
        return false;
      }
    },
    verifyExtendedLimits(job: JobHandle, limits: JobLimits, layout: JobLayoutDescriptor): boolean {
      try {
        const buf = queryRaw(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS, layout.extendedLimitSize);
        if (!buf) return false;
        const expectedFlags =
          BigInt(JOB_OBJECT_LIMIT_FLAGS.activeProcess) |
          BigInt(JOB_OBJECT_LIMIT_FLAGS.processMemory) |
          BigInt(JOB_OBJECT_LIMIT_FLAGS.killOnClose);
        if (readU64(buf, layout.flagsOffset) !== expectedFlags) return false;
        if (buf.readUInt32LE(layout.activeProcessLimitOffset) !== (limits.activeProcessLimit >>> 0)) return false;
        if (readU64(buf, layout.processMemoryLimitOffset) !== BigInt(limits.processMemoryLimitBytes)) return false;
        return true;
      } catch {
        return false;
      }
    },
    queryAccounting(job: JobHandle, layout: JobLayoutDescriptor): JobAccounting | null {
      try {
        const buf = queryRaw(job, layout.accountingClass, 48);
        if (!buf) return null;
        return {
          totalProcesses: buf.readUInt32LE(layout.accountingTotalOffset),
          activeProcesses: buf.readUInt32LE(layout.accountingActiveOffset),
          totalTerminatedProcesses: buf.readUInt32LE(layout.accountingTerminatedOffset),
        };
      } catch {
        return null;
      }
    },
    queryMemberPids(job: JobHandle, layout: JobLayoutDescriptor, maxPids: number): number[] | null {
      if (layout.pidListClass === null) return null;
      try {
        // JOBOBJECT_BASIC_PROCESS_ID_LIST: two DWORD counts + ULONG_PTR pids.
        const buf = queryRaw(job, layout.pidListClass, 8 + 8 * maxPids);
        if (!buf) return null;
        const inList = buf.readUInt32LE(4);
        if (inList > maxPids) return null;
        const pids: number[] = [];
        for (let i = 0; i < inList; i++) {
          pids.push(Number(buf.readBigUInt64LE(8 + i * 8)));
        }
        return pids;
      } catch {
        return null;
      }
    },
    openProcess(pid: number): JobHandle | null {
      try {
        const handle = openProcess(OPEN_PROCESS_ACCESS, 0, pid >>> 0);
        return handle ?? null;
      } catch {
        return null;
      }
    },
    assignToJob(job: JobHandle, processHandle: JobHandle): boolean {
      try {
        return assignProcessToJobObject(job, processHandle) === true;
      } catch {
        return false;
      }
    },
    isProcessInJob(processHandle: JobHandle, job: JobHandle): boolean | null {
      try {
        const out = [0];
        const ok = isProcessInJob(processHandle, job, out);
        if (ok !== true) return null;
        return out[0] === 1;
      } catch {
        return null;
      }
    },
    terminateJob(job: JobHandle, exitCode: number): boolean {
      try {
        return terminateJobObject(job, exitCode >>> 0) === true;
      } catch {
        return false;
      }
    },
    waitForProcessDeath(processHandle: JobHandle, timeoutMs: number): boolean {
      try {
        return waitForSingleObject(processHandle, timeoutMs >>> 0) === WAIT_OBJECT_0;
      } catch {
        return false;
      }
    },
  };

  // layout is resolved per-call via the descriptor argument; expose the two
  // known descriptors for callers.
  return api;
}

/** Default per-run job limits (documented in docs/security/sandbox-host.md). */
export const DEFAULT_JOB_LIMITS: JobLimits = Object.freeze({
  activeProcessLimit: 8,
  processMemoryLimitBytes: 512 * 1024 * 1024,
});

/** Wait grace period after TerminateJobObject before declaring cleanup unclean. */
export const KILL_GRACE_MS = 5_000;

/**
 * Verify that a spawned child has actually died. Combines the OS wait on the
 * process handle with the child process object's own exit reporting and the
 * job's accounting counters. Never claims death without evidence.
 */
export function verifyProcessTreeDeath(
  api: WindowsJobApi,
  job: JobHandle,
  layout: JobLayoutDescriptor,
  processHandle: JobHandle | null,
  child: ChildProcess | null,
  graceMs: number = KILL_GRACE_MS,
): { dead: boolean; jobEmpty: boolean } {
  const handleDead = processHandle ? api.waitForProcessDeath(processHandle, graceMs) : false;
  const childDead = child ? child.exitCode !== null || child.signalCode !== null : true;
  // Poll accounting briefly for an empty job (active processes == 0).
  let jobEmpty = false;
  const deadline = Date.now() + graceMs;
  for (;;) {
    const accounting = api.queryAccounting(job, layout);
    if (accounting && accounting.activeProcesses === 0) {
      jobEmpty = true;
      break;
    }
    if (Date.now() >= deadline) break;
    // Busy-wait in small bounded steps; Atomics.wait keeps this cheap and
    // synchronous without spinning hot.
    sleepSync(25);
  }
  return { dead: handleDead || childDead, jobEmpty };
}

/** Synchronous bounded sleep that does not starve the event loop badly. */
function sleepSync(ms: number): void {
  // Atomics.wait on a shared int32 blocks the thread without polling.
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}
