/**
 * Sandbox-adapter contract (v0.4 F10-16/F10-17/F10-18 foundation).
 *
 * Strict Zod schemas + constants + pure helpers for the sandbox adapter
 * slice. Contracts and pure adapters ONLY: no process execution, workers,
 * Docker, network, filesystem, tools, provider calls, or sandbox runtime.
 *
 * EXPLICIT SCOPE NOTE: wall-clock timeout enforcement belongs to a future
 * host runtime. This contract models the `timed_out` outcome and validates
 * the shape of a result that claims it, but nothing here executes anything
 * or fakes execution — helpers only validate and classify.
 *
 * Safety properties enforced below:
 * - Bounded ids/versions/display names/descriptions.
 * - Limits are positive finite integers; requested limits must not exceed
 *   the manifest's maxima.
 * - Serialized input/output sizes are bounded (UTF-8).
 * - Error messages are safe: no raw exception text, no filesystem paths, no
 *   credential-like content.
 * - A cleanup receipt is REQUIRED on every terminal result.
 * - Deny-by-default: requests carry no client capabilities; grants come from
 *   the server-side `SandboxCapabilities`.
 */
import { z } from "zod";
import { SANDBOX_PERMISSIONS, type SandboxAdapterManifest, type SandboxAdapterRequest, type SandboxAdapterResult, type SandboxPermission, type SandboxResourceLimits } from "@arena/types";

/** Independent sandbox-adapter schema version (separate from CONTRACT_VERSION). */
export const SANDBOX_ADAPTER_SCHEMA_VERSION = 1 as const;

/** Hard limits for the sandbox-adapter slice. */
export const SANDBOX_LIMITS = Object.freeze({
  /** Max chars for ids. */
  idChars: 128,
  /** Max chars for version tokens. */
  versionChars: 32,
  /** Max chars for display names / descriptions. */
  displayNameChars: 128,
  /** Max chars for a safe error message. */
  messageChars: 300,
  /** Max serialized JSON chars for the request input. */
  maxInputChars: 64 * 1024,
  /** Max serialized JSON chars for the result data payload. */
  maxOutputChars: 16 * 1024,
  /** Max cleanup receipt entries. */
  maxCleanupEntries: 16,
  /** Max result data entries. */
  maxDataEntries: 16,
  /** Min/max timeout a request may ask for (1s .. 60s). */
  minTimeoutMs: 1_000,
  maxTimeoutMs: 60_000,
  /** Min/max output bytes a request may ask for (1 KiB .. 1 MiB). */
  minOutputBytes: 1_024,
  maxOutputBytes: 1_048_576,
  /** Min/max input bytes a request may ask for (1 KiB .. 1 MiB). */
  minInputBytes: 1_024,
  maxInputBytes: 1_048_576,
} as const);

/* ------------------------------------------------------------------ */
/* Primitive schemas                                                   */
/* ------------------------------------------------------------------ */

const sandboxId = z
  .string()
  .trim()
  .min(1)
  .max(SANDBOX_LIMITS.idChars)
  .regex(/^[A-Za-z0-9_-]+$/, "id may only contain [A-Za-z0-9_-]");

const adapterIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SANDBOX_LIMITS.idChars)
  .regex(/^sbadp_[A-Za-z0-9_-]+$/, "adapterId must start with sbadp_");

const adapterVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(SANDBOX_LIMITS.versionChars)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "adapter version must be a bounded token");

const sandboxTimestamp = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), "invalid ISO timestamp");

/**
 * Safe message text: no control characters/newlines beyond spaces, no
 * filesystem paths, no credential-like content. Real errors must be mapped
 * onto safe codes + these bounded messages by the adapter.
 */
const safeMessage = z
  .string()
  .trim()
  .min(1)
  .max(SANDBOX_LIMITS.messageChars)
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), "message contains control characters")
  .refine((value) => !value.includes("\\"), "message must not contain filesystem paths")
  .refine((value) => !/^[A-Za-z]:[\\/]/.test(value), "message must not contain filesystem paths")
  .refine(
    (value) => !/(password|secret|token|api[-_]?key|authorization|credential|cookie|session)/i.test(value),
    "message must not contain credential-like content",
  );

const positiveInt = z.number().int().finite().min(1);

const resourceLimitsSchema = z.strictObject({
  timeoutMs: positiveInt,
  maxOutputBytes: positiveInt,
  maxInputBytes: positiveInt,
});

const sandboxScalar = z.union([
  z.string().max(SANDBOX_LIMITS.messageChars),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const resultDataSchema = z
  .record(z.string().min(1).max(SANDBOX_LIMITS.idChars), sandboxScalar)
  .refine(
    (data) => Object.keys(data).length <= SANDBOX_LIMITS.maxDataEntries,
    `result data exceeds ${SANDBOX_LIMITS.maxDataEntries} entries`,
  )
  .refine(
    (data) => JSON.stringify(data).length <= SANDBOX_LIMITS.maxOutputChars,
    `result data exceeds ${SANDBOX_LIMITS.maxOutputChars} serialized chars`,
  )
  .optional();

const cleanupReceiptSchema = z.strictObject({
  releasedAt: sandboxTimestamp,
  resourcesReleased: z
    .array(sandboxId)
    .max(SANDBOX_LIMITS.maxCleanupEntries),
  clean: z.boolean(),
});

/* ------------------------------------------------------------------ */
/* Manifest / request / result schemas                                 */
/* ------------------------------------------------------------------ */

export const sandboxAdapterManifestSchema = z.strictObject({
  schemaVersion: z.literal(SANDBOX_ADAPTER_SCHEMA_VERSION),
  adapterId: adapterIdSchema,
  version: adapterVersionSchema,
  displayName: z.string().trim().min(1).max(SANDBOX_LIMITS.displayNameChars),
  description: z.string().trim().min(1).max(SANDBOX_LIMITS.displayNameChars),
  requiredPermissions: z
    .array(z.enum(SANDBOX_PERMISSIONS))
    .max(SANDBOX_PERMISSIONS.length),
  requestedCapabilities: z
    .record(z.string().min(1).max(SANDBOX_LIMITS.idChars), z.boolean())
    .refine(
      (capabilities) => Object.keys(capabilities).length <= SANDBOX_PERMISSIONS.length,
      `requestedCapabilities exceeds ${SANDBOX_PERMISSIONS.length} keys`,
    ),
  maxLimits: resourceLimitsSchema,
});

export const sandboxAdapterRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(SANDBOX_ADAPTER_SCHEMA_VERSION),
    adapterId: adapterIdSchema,
    input: z.unknown(),
    limits: resourceLimitsSchema,
  })
  // Bounded serialized input (UTF-8); shape validation is adapter-specific.
  .refine(
    (request) => JSON.stringify(request.input ?? null).length <= SANDBOX_LIMITS.maxInputChars,
    `request input exceeds ${SANDBOX_LIMITS.maxInputChars} serialized chars`,
  );

export const sandboxAdapterResultSchema = z
  .strictObject({
    schemaVersion: z.literal(SANDBOX_ADAPTER_SCHEMA_VERSION),
    adapterId: adapterIdSchema,
    adapterVersion: adapterVersionSchema,
    status: z.enum([
      "completed",
      "denied",
      "unavailable",
      "timed_out",
      "resource_exhausted",
      "failed",
      "cancelled",
    ]),
    errorCode: z
      .enum([
        "invalid_input",
        "manifest_invalid",
        "capability_denied",
        "permission_unmet",
        "consent_missing",
        "consent_expired",
        "limits_exceeded",
        "input_too_large",
        "output_too_large",
        "adapter_unavailable",
        "adapter_failed",
        "timeout",
        "cancelled",
        "cleanup_failed",
      ])
      .optional(),
    message: safeMessage.optional(),
    data: resultDataSchema,
    usage: z.strictObject({
      elapsedMs: z.number().int().finite().min(0),
      outputBytes: z.number().int().finite().min(0),
    }),
    cleanup: cleanupReceiptSchema,
  })
  // Non-completed statuses require a safe error code.
  .refine(
    (result) => result.status === "completed" || result.errorCode !== undefined,
    "non-completed results require an errorCode",
  )
  // A run that did not complete cleanly must report an unclean receipt.
  .refine(
    (result) => result.cleanup.clean || result.errorCode === "cleanup_failed",
    "unclean cleanup requires the cleanup_failed error code",
  )
  // Output bytes must not exceed the requested limit when present.
  .refine(
    (result) => result.usage.outputBytes <= SANDBOX_LIMITS.maxOutputBytes,
    `result output exceeds ${SANDBOX_LIMITS.maxOutputBytes} bytes`,
  );

/* ------------------------------------------------------------------ */
/* Pure helpers: validation + denial/limit semantics                   */
/* ------------------------------------------------------------------ */

export type SandboxValidationResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

export function validateSandboxAdapterManifest(
  input: unknown,
): SandboxValidationResult<SandboxAdapterManifest> {
  const parsed = sandboxAdapterManifestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid manifest" };
  }
  return { ok: true, data: parsed.data };
}

export function validateSandboxAdapterRequest(
  input: unknown,
): SandboxValidationResult<SandboxAdapterRequest> {
  const parsed = sandboxAdapterRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid request" };
  }
  return { ok: true, data: parsed.data };
}

export function validateSandboxAdapterResult(
  input: unknown,
): SandboxValidationResult<SandboxAdapterResult> {
  const parsed = sandboxAdapterResultSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid result" };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Check that a request's limits fit within a manifest's maxima and that the
 * request targets the manifest's adapter.
 */
export function validateRequestAgainstManifest(
  request: SandboxAdapterRequest,
  manifest: SandboxAdapterManifest,
): SandboxValidationResult<undefined> {
  if (request.adapterId !== manifest.adapterId) {
    return { ok: false, error: "request targets a different adapter" };
  }
  if (request.limits.timeoutMs > manifest.maxLimits.timeoutMs) {
    return { ok: false, error: "requested timeout exceeds the adapter maximum" };
  }
  if (request.limits.maxOutputBytes > manifest.maxLimits.maxOutputBytes) {
    return { ok: false, error: "requested output limit exceeds the adapter maximum" };
  }
  if (request.limits.maxInputBytes > manifest.maxLimits.maxInputBytes) {
    return { ok: false, error: "requested input limit exceeds the adapter maximum" };
  }
  return { ok: true, data: undefined };
}

/**
 * Deny-by-default permission gate: every manifest-required permission must
 * be explicitly `true` in the granted sandbox capabilities. Missing entries
 * count as denied.
 */
export function validateSandboxPermissions(
  manifest: SandboxAdapterManifest,
  granted: Readonly<Record<string, boolean>>,
): SandboxValidationResult<undefined> {
  for (const permission of manifest.requiredPermissions) {
    if (granted[permission] !== true) {
      return { ok: false, error: `required permission not granted: ${permission}` };
    }
  }
  return { ok: true, data: undefined };
}

/**
 * Capability gate: every manifest-requested capability set to `true` must be
 * granted in the effective sandbox capabilities (deny-by-default).
 */
export function validateSandboxCapabilityGrant(
  manifest: SandboxAdapterManifest,
  granted: Readonly<Record<string, boolean>>,
): SandboxValidationResult<undefined> {
  for (const [capability, wanted] of Object.entries(manifest.requestedCapabilities)) {
    if (wanted === true && granted[capability] !== true) {
      return { ok: false, error: `capability not granted: ${capability}` };
    }
  }
  return { ok: true, data: undefined };
}

/**
 * Build the canonical DENIED result (no execution happened). Pure.
 */
export function deniedSandboxResult(
  manifest: SandboxAdapterManifest,
  errorCode: "capability_denied" | "permission_unmet" | "consent_missing" | "consent_expired",
  message: string,
  now: string = new Date().toISOString(),
): SandboxAdapterResult {
  return {
    schemaVersion: SANDBOX_ADAPTER_SCHEMA_VERSION,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.version,
    status: "denied",
    errorCode,
    message: message.slice(0, SANDBOX_LIMITS.messageChars),
    usage: { elapsedMs: 0, outputBytes: 0 },
    cleanup: { releasedAt: now, resourcesReleased: [], clean: true },
  };
}

/**
 * Build the canonical UNAVAILABLE result (the adapter or its input cannot be
 * used at all — no execution happened). Pure.
 */
export function unavailableSandboxResult(
  manifest: SandboxAdapterManifest,
  message: string,
  now: string = new Date().toISOString(),
): SandboxAdapterResult {
  return {
    schemaVersion: SANDBOX_ADAPTER_SCHEMA_VERSION,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.version,
    status: "unavailable",
    errorCode: "adapter_unavailable",
    message: message.slice(0, SANDBOX_LIMITS.messageChars),
    usage: { elapsedMs: 0, outputBytes: 0 },
    cleanup: { releasedAt: now, resourcesReleased: [], clean: true },
  };
}

/**
 * Build the canonical FAILED result for an input-size violation discovered
 * before any work. Pure.
 */
export function inputTooLargeResult(
  manifest: SandboxAdapterManifest,
  message: string,
  now: string = new Date().toISOString(),
): SandboxAdapterResult {
  return {
    schemaVersion: SANDBOX_ADAPTER_SCHEMA_VERSION,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.version,
    status: "failed",
    errorCode: "input_too_large",
    message: message.slice(0, SANDBOX_LIMITS.messageChars),
    usage: { elapsedMs: 0, outputBytes: 0 },
    cleanup: { releasedAt: now, resourcesReleased: [], clean: true },
  };
}

/**
 * Build the canonical TIMED_OUT result. This is a REPORTING constructor for
 * a host runtime that enforced a wall-clock timeout — it does not execute
 * anything and must never be used to fake a timeout that did not happen.
 */
export function timedOutSandboxResult(
  manifest: SandboxAdapterManifest,
  elapsedMs: number,
  now: string = new Date().toISOString(),
): SandboxAdapterResult {
  return {
    schemaVersion: SANDBOX_ADAPTER_SCHEMA_VERSION,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.version,
    status: "timed_out",
    errorCode: "timeout",
    message: "Adapter run exceeded its wall-clock budget",
    usage: { elapsedMs, outputBytes: 0 },
    cleanup: { releasedAt: now, resourcesReleased: [], clean: true },
  };
}

/**
 * Build the canonical RESOURCE_EXHAUSTED result (e.g. output budget hit).
 * Pure reporting constructor, same caveats as `timedOutSandboxResult`.
 */
export function resourceExhaustedSandboxResult(
  manifest: SandboxAdapterManifest,
  elapsedMs: number,
  message: string,
  now: string = new Date().toISOString(),
): SandboxAdapterResult {
  return {
    schemaVersion: SANDBOX_ADAPTER_SCHEMA_VERSION,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.version,
    status: "resource_exhausted",
    errorCode: "limits_exceeded",
    message: message.slice(0, SANDBOX_LIMITS.messageChars),
    usage: { elapsedMs, outputBytes: 0 },
    cleanup: { releasedAt: now, resourcesReleased: [], clean: true },
  };
}

/** Type re-exports for callers that only want the helper surface. */
export type { SandboxPermission, SandboxResourceLimits };
