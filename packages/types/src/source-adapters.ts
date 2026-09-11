/**
 * Canonical source-adapter shapes (v0.4 F10-09/F10-10 foundation).
 *
 * Dependency-free, serializable types for the safe source-adapter contract:
 * explicit-user-action-only adapters that capture immutable, hash-pinned
 * source snapshots with auditable consent and access records. NO network,
 * HTTP clients, URL fetching, DNS, search, automatic refresh, provider calls,
 * tools, filesystem, subprocesses, or sandbox live in this slice — these are
 * the data contracts an adapter implementation must satisfy later.
 *
 * Versioning is independent from the debate transport contract
 * (`streaming.ts`, transport v:1) and from `CONTRACT_VERSION`.
 */

/** Schema version stamped on source-adapter contracts. */
export const SOURCE_ADAPTER_SCHEMA_VERSION = 1 as const;
export type SourceAdapterSchemaVersion = typeof SOURCE_ADAPTER_SCHEMA_VERSION;

/** What kind of source an adapter exposes. */
export type SourceAdapterKind = "external-source" | "dataset" | "document";

/**
 * Freshness policy for a captured source snapshot. `maxAgeSeconds` is
 * bounded (1..365 days) and only meaningful for `reuse-if-fresh` /
 * `refresh-on-user-action`; `snapshot-only` material never goes stale.
 */
export type SourceFreshnessMode =
  | "snapshot-only"
  | "reuse-if-fresh"
  | "refresh-on-user-action";

export interface SourceFreshnessPolicy {
  readonly mode: SourceFreshnessMode;
  /** Bounded staleness window in seconds (1..31_536_000). */
  readonly maxAgeSeconds: number;
}

/** Sandbox permission names an adapter may require (subset of capabilities). */
export type SourceAdapterPermission = "fs.read" | "net.fetch" | "process.spawn";

/**
 * A registered adapter's declaration. Adapters are registered server-side;
 * clients can never supply a manifest. `requiresExplicitUserAction` is
 * always true in this slice: nothing runs without a user action.
 */
export interface SourceAdapterManifest {
  readonly schemaVersion: SourceAdapterSchemaVersion;
  /** Stable adapter id (`srcadp_`-prefixed). */
  readonly adapterId: string;
  /** Adapter version (bounded semantic-ish token). */
  readonly version: string;
  readonly kind: SourceAdapterKind;
  /** Bounded human-readable name. */
  readonly displayName: string;
  /** Capabilities the adapter requests from the sandbox (deny-by-default). */
  readonly requestedCapabilities: Readonly<Partial<Record<string, boolean>>>;
  /** Permissions the adapter requires before any capture is allowed. */
  readonly requiredPermissions: readonly SourceAdapterPermission[];
  readonly requiresExplicitUserAction: true;
}

/** What the user is being asked to allow, derived from the manifest. */
export interface SourceAdapterRequest {
  readonly schemaVersion: SourceAdapterSchemaVersion;
  readonly manifest: SourceAdapterManifest;
  /** Bounded human-readable description of what will be accessed. */
  readonly description: string;
}

/**
 * The user's explicit, bounded consent decision for one adapter request.
 * Every identity field is SERVER-issued or SERVER-derived — the client can
 * never supply ids, capability grants, or expiry instants.
 *
 * The consent is bound to:
 * - the server-issued `consentId` (single-use identifier),
 * - the adapter id AND exact adapter version,
 * - the match/request identity it was issued for (`matchId`/`requestId`),
 * - the exact source reference the user approved,
 * - the server-copied `requestedCapabilities` from the manifest,
 * - the user-action confirmation and its validity window.
 * Replaying a consent for any other match/request/reference/adapter version
 * is rejected by the gate.
 */
export interface SourceConsent {
  readonly schemaVersion: SourceAdapterSchemaVersion;
  /** Server-issued consent id (`sconsent_`-prefixed); clients never choose it. */
  readonly consentId: string;
  readonly adapterId: string;
  /** Exact adapter version the consent was issued for (pinned, not range). */
  readonly adapterVersion: string;
  /** Match the consent is bound to (present when issued per-match). */
  readonly matchId?: string;
  /** Server-issued request id the consent fulfills (when applicable). */
  readonly requestId?: string;
  /** Exact source reference the user consented to capture. */
  readonly reference: string;
  readonly granted: boolean;
  /** Server-copied requested-capability snapshot from the manifest. */
  readonly requestedCapabilities: Readonly<Partial<Record<string, boolean>>>;
  /** Server-derived capability grant snapshot copied from the manifest. */
  readonly grantedCapabilities: Readonly<Partial<Record<string, boolean>>>;
  /** When the user made the decision (ISO 8601, never in the future). */
  readonly decidedAt: string;
  /** Consent expiry (ISO 8601); captures after this instant are rejected. */
  readonly expiresAt: string;
  /** Explicit user-action semantics — must be exactly `true`. */
  readonly confirmedByUserAction: true;
}

/**
 * An immutable, hash-pinned capture of one source's content. Created only by
 * the ingest path; clients never supply snapshots.
 */
export interface SourceSnapshot {
  readonly schemaVersion: SourceAdapterSchemaVersion;
  /** Stable id (`srcsnap_`-prefixed). */
  readonly id: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly kind: SourceAdapterKind;
  /** Bounded source reference (no credentials, no control chars). */
  readonly reference: string;
  /** Bounded content type — text-only content types allowed in this slice. */
  readonly contentType: string;
  /** Exact UTF-8 byte length of `content`. */
  readonly contentBytes: number;
  /** Lowercase 64-hex SHA-256 of the exact UTF-8 encoding of `content`. */
  readonly contentHash: string;
  /** The captured text content itself (bounded). */
  readonly content: string;
  /** Capture timestamp (ISO 8601, never in the future). */
  readonly capturedAt: string;
  readonly freshness: SourceFreshnessPolicy;
  /** ISO 8601 instant after which the snapshot is stale (derived). */
  readonly freshUntil: string | null;
  /** Bounded, credential-free metadata. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Audit record for one adapter access. Persisted on the match record under
 * `sourceAudits`; never contains content or secrets.
 */
export interface SourceAccessAudit {
  readonly schemaVersion: SourceAdapterSchemaVersion;
  /** Stable id (`srcaudit_`-prefixed). */
  readonly id: string;
  readonly matchId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly outcome: "granted" | "denied" | "expired" | "failed";
  /** Snapshot id when the access produced one. */
  readonly sourceSnapshotId?: string;
  /** Consent id the access ran under (bounded). */
  readonly consentId: string;
  /** Access timestamp (ISO 8601). */
  readonly accessedAt: string;
  /** Bounded, credential-free detail (e.g. denial reason). */
  readonly detail?: string;
}
