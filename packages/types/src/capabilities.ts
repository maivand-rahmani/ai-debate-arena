/**
 * Sandbox capability declarations (v0.4 foundation slice).
 *
 * Dependency-free, serializable shapes describing what a sandboxed evidence
 * verification step is allowed to do. Deny-by-default: every permission
 * defaults to `false` and must be explicitly granted by the request, then
 * narrowed by negotiation before use.
 *
 * Versioning is independent from the debate transport contract
 * (`streaming.ts`, transport v:1) and from `CONTRACT_VERSION`.
 */

/** Schema version stamped on capability declarations and requests. */
export type CapabilitySchemaVersion = 1;

/** Independently versioned evidence schema (mirrored here for convenience). */
export const EVIDENCE_SCHEMA_VERSION = 1 as const;
/** Independently versioned capability schema. */
export const CAPABILITY_SCHEMA_VERSION = 1 as const;

/**
 * Known sandbox permissions. Unknown permission names are rejected at the
 * contract boundary (never treated as granted).
 */
export const SANDBOX_PERMISSIONS = Object.freeze([
  "fs.read",
  "fs.write",
  "net.fetch",
  "process.spawn",
] as const);

export type SandboxPermission = (typeof SANDBOX_PERMISSIONS)[number];

/**
 * What the evidence pipeline asks the sandbox to be allowed to do. All
 * permissions are opt-in; omitting one is equivalent to `false`.
 */
export interface CapabilityRequest {
  readonly schemaVersion: CapabilitySchemaVersion;
  readonly permissions: Readonly<Partial<Record<SandboxPermission, boolean>>>;
}

/**
 * What the sandbox will actually enforce for a match. Every permission is
 * materialized explicitly; deny-by-default for anything not granted.
 */
export interface SandboxCapabilities {
  readonly schemaVersion: CapabilitySchemaVersion;
  readonly permissions: Readonly<Record<SandboxPermission, boolean>>;
}

/** The all-disabled capability set (the default for legacy and non-evidence flows). */
export const DISABLED_SANDBOX_CAPABILITIES: SandboxCapabilities = Object.freeze({
  schemaVersion: 1,
  permissions: Object.freeze({
    "fs.read": false,
    "fs.write": false,
    "net.fetch": false,
    "process.spawn": false,
  }),
});
