# Local Sandbox Host — Threat Model and Platform Notes (F10-19 / F10-24)

Status: **implementation notes for the v0.4 gate** — written 2026-09-11.
Package: `@arena/sandbox-host` (isolated infrastructure package; the
`@arena/debate-engine` sandbox-adapter contracts stay pure and untouched).

## What this is

A **narrow** local worker host for exactly one purpose: running the
allow-listed, server-owned deterministic worker (SHA-256 over bounded input,
plus bounded diagnostic ops used by the tests) inside a Windows Job Object,
and reporting the strict `SandboxAdapterResult` shapes from
`@arena/debate-engine`.

Deliberately **not** implemented (and rejected by design):

- No generic command runner. There is no API that executes an arbitrary
  executable, script, or command line. The spawned executable is always the
  running Node binary (`process.execPath`) and the spawned script is always
  the bundled `src/worker/deterministic-worker.mjs`. Clients supply neither.
- No shell invocation (`shell: false`), no detached processes, no inherited
  stdio, no client-controlled arguments, environment, working directory, or
  source URLs.
- No source fetching and no filesystem/network capabilities. The manifest
  requests exactly one capability: `process.spawn` (deny-by-default; a run
  is denied BEFORE any spawn when the grant is missing).
- The pure `sbadp_content-hash` adapter remains in-process in
  `@arena/debate-engine` and never spawns anything.

## Containment model — what Job Objects do and do not provide

The host uses a Windows Job Object per run with:

- `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — the last handle close kills every
  member, so even a crashed host process cannot leak the worker tree.
- `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` — a small cap on concurrent processes
  in the job (blocks fork-bombs by the trusted worker).
- `JOB_OBJECT_LIMIT_PROCESS_MEMORY` — a per-process memory cap (512 MiB).
- No `JOB_OBJECT_LIMIT_BREAKAWAY_OK` / `SILENT_BREAKAWAY_OK` — members
  cannot leave the job.

**Honest characterization:** a Job Object provides *process-tree containment
and resource governance* — it is NOT a filesystem, network, or privilege
security boundary. Members run with the full rights of the server process;
they can read and write whatever the user can, and network access is not
restricted by the job. That is acceptable here because the worker is
server-owned, allow-listed, deterministic code with no I/O at all — the job
exists to guarantee termination, resource bounds, and cleanup, not to jail
hostile code. Do not extend this host to run untrusted code without adding
real isolation (restricted tokens, AppContainer, or a remote sandbox; see
F10-20).

## Fail-closed availability

The adapter reports `unavailable` (`adapter_unavailable`) and spawns nothing
whenever true containment cannot be proven:

- Non-Windows platform.
- `koffi` (pinned native FFI dependency) missing or unloadable, or any
  kernel32 binding failing to resolve.
- The behavioral preflight failing on any step (see below).
- Job creation, limit application, or membership verification failing at
  run time.

There is no code path that claims isolation from `child_process.kill()` or
`taskkill` alone. Termination claims always come from Job Object APIs
(`TerminateJobObject`), verified by process-handle waits, the child's exit
event, and the job's own accounting counters (`ActiveProcesses == 0`).

## Behavioral preflight (containment proof, not configuration)

Before the first run (cached afterwards; `resetContainmentPreflightCache()`
forces revalidation) the host proves containment with real canary processes:

1. For each candidate ABI layout (modern 168-byte `JOBOBJECT_EXTENDED_LIMIT_
   INFORMATION`, then the legacy Windows-2000-era 144-byte layout observed
   on some environments): set kill-on-close + active-process + memory limits
   and read them back unchanged via `QueryInformationJobObject`.
2. Spawn a canary worker (the same allow-listed script), assign it to the
   job, and verify membership with the layout's own strategy (member PID
   list on the legacy ABI, `IsProcessInJob` on the modern ABI) plus job
   accounting showing at least one active process.
3. `TerminateJobObject` must kill the canary within a bounded grace period.
4. A second canary must be killed by plain handle release (kill-on-close).

Only a layout that passes ALL steps is used. Any failure is a permanent
(until reset) fail-closed verdict. This also means the host automatically
adapts to environments whose kernel implements only the legacy job-object
interface instead of crashing or — worse — pretending containment works.

Known environment quirk (documented for future maintainers): on the Windows
build where this was developed, `SetInformationJobObject` rejects the modern
168-byte structure (`ERROR_BAD_LENGTH`) and only accepts the legacy
144-byte layout with `LimitFlags` at offset 16 and the legacy info-class
numbering (member PID list at class 3). The preflight detects and handles
both generations; `IsProcessInJob` is unreliable on the legacy ABI and is
never used as the sole membership proof there.

## Host-owned enforcement and attested cleanup

- **Wall-clock watchdog**: the host kills the job at the requested
  `timeoutMs`; the worker is never trusted to self-terminate. Result:
  `timed_out`.
- **Output cap**: stdout and stderr are counted host-side; exceeding the
  requested `maxOutputBytes` kills the job. Result: `resource_exhausted`.
  Reported `usage.outputBytes` is clamped to the cap (host-attested, never
  worker-reported).
- **Cancellation**: an `AbortSignal` kills the job mid-run. Result:
  `cancelled`.
- **Malformed output**: a worker response that is not valid protocol JSON is
  a safe `failed`/`adapter_failed` result; raw worker text never reaches the
  result.
- **Cleanup receipt**: every terminal result carries one. The host verifies
  process death (handle wait + exit event + empty job accounting) before
  claiming `worker-process`, closes the job handle (kill-on-close backstop)
  and verifies the job drained before claiming `job-object`, and removes the
  isolated temp dir with retries before claiming `temp-dir`. If any step
  cannot be verified, the receipt is `clean: false` and the result carries
  `errorCode: "cleanup_failed"` (required by the contract for unclean
  receipts).
- **Isolation of the run**: the worker gets a fresh temp dir under the OS
  temp dir (`sbadp-worker-XXXXXX`), a scrubbed minimal environment (only
  `SystemRoot`/`SystemDrive` plus `TEMP`/`TMP` pointed at the run dir and a
  protocol marker — never provider secrets or client environment),
  `windowsHide: true`, `shell: false`, piped (never inherited) stdio, and
  bounded JSON stdin/stdout with hard byte caps on both sides.

## Stale temp-dir sweep

Crash leftovers are swept by `sweepStaleWorkerTempDirs()`: only entries
under the OS temp dir matching the strict `sbadp-worker-XXXXXX` pattern
(six alphanumeric characters, exactly what `mkdtemp` appends to our prefix)
AND older than the age threshold (24h by default) are removed, capped at 32
entries per sweep, with per-entry errors swallowed. The restrictive pattern
plus age gate means the sweep cannot remove anything a user or another
application placed in the temp dir; a negative threshold ("any age") exists
for tests and explicit recovery.

## Exact supported-platform limitations

- **Windows only** (x64). On any other platform the adapter is permanently
  `unavailable`. There is no Linux/macOS implementation in this slice
  (F10-20 keeps Docker/remote sandboxes as the future alternative).
- The FFI dependency is `koffi` (pinned exact version). If the native
  binding cannot load (wrong architecture, missing binary, broken install),
  the adapter is `unavailable` — the rest of the evidence pipeline is
  unaffected.
- Memory limits are per-process only on the legacy ABI (no job-wide limit
  there); wall-clock limits are host-enforced, not kernel-enforced.
- There is a small, documented race window between process creation and
  `AssignProcessToJobObject` (Node cannot spawn suspended processes via
  `child_process.spawn`). The window is closed for practical purposes
  because the worker is trusted server-owned code that spawns nothing on
  startup except the explicit `tree` diagnostic op; a future hardening could
  switch to `CREATE_SUSPENDED` via `CreateProcessW`.

## Residual risks (explicit)

1. The worker runs with full user rights inside the job; the job bounds
   processes, memory, and lifetime — not what the code may read, write, or
   reach on the network. This is safe only because the worker is
   server-owned and capability-free.
2. `TerminateJobObject` is not instant; the host waits a bounded grace
   period and reports unclean cleanup if death is not observed.
3. A malicious local process could still kill or interfere with the worker
   (same-user processes can); the single-user local threat model is
   unchanged from the main v0.4 threat model.
4. If the host process is hard-killed (e.g. power loss), the job's
   kill-on-close still fires (the OS closes handles), but the temp dir may
   survive until the stale sweep reclaims it after 24h.
