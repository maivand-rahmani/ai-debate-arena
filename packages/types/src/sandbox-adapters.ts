/**
 * Canonical sandbox-adapter shapes (v0.4 F10-16/F10-17/F10-18 foundation).
 *
 * Dependency-free, serializable types for the sandbox adapter contract:
 * a registered adapter declares what it needs (server-owned manifest), a
 * caller asks for a bounded run (request without client capabilities, paths,
 * or handles), and the adapter returns a SAFE result (bounded, no raw
 * exceptions/paths/secrets) plus a cleanup receipt. Deny-by-default via the
 * existing `CapabilityRequest`/`SandboxCapabilities`.
 *
 * IMPORTANT SCOPE: this is contracts + pure adapters only. There is NO
 * process execution, workers, Docker, network, filesystem, tools, provider
 * calls, or sandbox runtime in this slice. Wall-clock timeout enforcement
 * belongs to a future host runtime; this contract models the OUTCOME
 * (`timed_out`) but nothing here can fake or perform execution.
 *
 * Versioning is independent from the debate transport contract
 * (`streaming.ts`, transport v:1) and from `CONTRACT_VERSION`.
 */

import type { SandboxPermission } from "./capabilities";

/** Schema version stamped on sandbox-adapter contracts. */
export const SANDBOX_ADAPTER_SCHEMA_VERSION = 1 as const;
export type SandboxAdapterSchemaVersion = typeof SANDBOX_ADAPTER_SCHEMA_VERSION;

/**
 * Terminal status of one sandbox adapter run. `denied` covers consent/
 * capability/permission refusal; `unavailable` means the adapter or its
 * input cannot be used at all; `timed_out`/`resource_exhausted` are host-
 * enforced outcomes a future runtime reports; `failed` is any other
 * adapter-side failure; `cancelled` is an abort before/during the run.
 */
export type SandboxAdapterStatus =
  | "completed"
  | "denied"
  | "unavailable"
  | "timed_out"
  | "resource_exhausted"
  | "failed"
  | "cancelled";

/**
 * Safe, bounded error codes. Never raw exception text, never provider or
 * filesystem specifics — callers map real errors onto these.
 */
export type SandboxAdapterErrorCode =
  | "invalid_input"
  | "manifest_invalid"
  | "capability_denied"
  | "permission_unmet"
  | "consent_missing"
  | "consent_expired"
  | "limits_exceeded"
  | "input_too_large"
  | "output_too_large"
  | "adapter_unavailable"
  | "adapter_failed"
  | "timeout"
  | "cancelled"
  | "cleanup_failed";

/** Bounded, server-side sandbox resource limits for one run. */
export interface SandboxResourceLimits {
  /** Max wall-clock milliseconds the host may allot (host-enforced later). */
  readonly timeoutMs: number;
  /** Max output bytes the adapter may return. */
  readonly maxOutputBytes: number;
  /** Max input bytes the adapter accepts. */
  readonly maxInputBytes: number;
}

/**
 * Server-owned adapter declaration. Registered server-side; clients can
 * never supply one. Declares the permission set the adapter may need and
 * the hard ceilings it accepts.
 */
export interface SandboxAdapterManifest {
  readonly schemaVersion: SandboxAdapterSchemaVersion;
  /** Stable adapter id (`sbadp_`-prefixed). */
  readonly adapterId: string;
  /** Bounded adapter version token. */
  readonly version: string;
  /** Bounded human-readable name. */
  readonly displayName: string;
  /** What the adapter is for (bounded). */
  readonly description: string;
  /** Permissions the adapter requires (all deny-by-default). */
  readonly requiredPermissions: readonly SandboxPermission[];
  /** Capabilities the adapter requests (deny-by-default; server-derived grant). */
  readonly requestedCapabilities: Readonly<Partial<Record<string, boolean>>>;
  /** Hard ceilings the adapter accepts; requests may not exceed these. */
  readonly maxLimits: SandboxResourceLimits;
}

/**
 * A bounded run request. Deliberately carries NO client capabilities, NO
 * paths, NO handles — only what the adapter needs to do its bounded job.
 */
export interface SandboxAdapterRequest {
  readonly schemaVersion: SandboxAdapterSchemaVersion;
  readonly adapterId: string;
  /** Bounded, server-resolved input payload (shape is adapter-specific). */
  readonly input: unknown;
  /** Requested limits; must be <= the manifest's `maxLimits`. */
  readonly limits: SandboxResourceLimits;
}

/** What the adapter actually consumed (reported, bounded). */
export interface SandboxResourceUsage {
  /** Wall-clock milliseconds the adapter reports for its pure work. */
  readonly elapsedMs: number;
  /** Output bytes produced. */
  readonly outputBytes: number;
}

/**
 * Proof the adapter released everything it borrowed. Required on every
 * terminal result — a run without a cleanup receipt is not complete.
 */
export interface SandboxCleanupReceipt {
  readonly releasedAt: string;
  /** Bounded summary of what was released (no paths/handles). */
  readonly resourcesReleased: readonly string[];
  readonly clean: boolean;
}

/**
 * The safe result of one adapter run. `data` carries only bounded, scalar,
 * serializable values — never raw content, exceptions, paths, or secrets.
 */
export interface SandboxAdapterResult {
  readonly schemaVersion: SandboxAdapterSchemaVersion;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly status: SandboxAdapterStatus;
  /** Safe error code when the status is not `completed`. */
  readonly errorCode?: SandboxAdapterErrorCode;
  /** Bounded safe message when the status is not `completed`. */
  readonly message?: string;
  /** Bounded scalar result data when the status is `completed`. */
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
  readonly usage: SandboxResourceUsage;
  readonly cleanup: SandboxCleanupReceipt;
}
