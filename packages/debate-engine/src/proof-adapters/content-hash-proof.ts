/**
 * Content-hash proof adapter (`sbadp_content-hash`, F10-16/F10-18).
 *
 * A deterministic, capability-free pure adapter: recomputes the exact UTF-8
 * SHA-256 of an evidence item's text and compares it against the item's
 * declared `provenance.contentHash`. When the item references a source
 * snapshot (`provenance.sourceSnapshotId`), the snapshot's hash, byte count,
 * and content must also agree exactly.
 *
 * Guarantees:
 * - NO capabilities/permissions required (the manifest declares none).
 * - NO I/O: no fs, network, process, provider, or worker imports of any kind.
 * - Input is the SERVER-resolved evidenceId + the stored EvidenceBundle —
 *   never client-supplied paths, handles, or content.
 * - NEVER mutates `EvidenceItem.status`; verification is recorded only in
 *   the returned bounded `ProofResult`.
 * - NEVER includes raw content in the result — only ids, hashes, and counts.
 * - Deterministic: identical input yields byte-identical output.
 */
import type { EvidenceBundle, ProofResult } from "@arena/types";
import { createHash } from "node:crypto";

/** The canonical adapter id for this proof adapter. */
export const CONTENT_HASH_ADAPTER_ID = "sbadp_content-hash";
/** The canonical adapter version for this proof adapter. */
export const CONTENT_HASH_ADAPTER_VERSION = "1.0.0";
/** The hash algorithm this adapter applies. */
export const CONTENT_HASH_ALGORITHM = "sha256";

/** Hard output bound for the produced ProofResult (serialized chars). */
export const CONTENT_HASH_RESULT_MAX_CHARS = 2 * 1024;

/** Manifest for the content-hash proof adapter (no capabilities at all). */
export const CONTENT_HASH_ADAPTER_MANIFEST = Object.freeze({
  schemaVersion: 1,
  adapterId: CONTENT_HASH_ADAPTER_ID,
  version: CONTENT_HASH_ADAPTER_VERSION,
  displayName: "Content hash proof",
  description: "Recomputes the exact UTF-8 SHA-256 of stored evidence text and compares it with the declared provenance hash.",
  requiredPermissions: Object.freeze([]),
  requestedCapabilities: Object.freeze({}),
  maxLimits: Object.freeze({
    timeoutMs: 60_000,
    maxOutputBytes: CONTENT_HASH_RESULT_MAX_CHARS,
    maxInputBytes: 512 * 1024,
  }),
} as const);

export type ContentHashProofInput =
  | { readonly kind: "verify"; readonly evidenceId: string }
  | { readonly kind: "list" };

export type ContentHashProofOutcome =
  | { readonly status: "verified"; readonly proof: ProofResult }
  | { readonly status: "failed"; readonly proof: ProofResult }
  | { readonly status: "unavailable"; readonly proof: ProofResult };

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Safe collection access for possibly-malformed bundles. */
function safeItems(bundle: EvidenceBundle): readonly { id: string; text: string; status: string; provenance: { contentHash: string; sourceSnapshotId?: string } }[] {
  const items = (bundle as { items?: unknown }).items;
  return Array.isArray(items) ? (items as never) : [];
}

function safeSnapshots(bundle: EvidenceBundle): readonly { id: string; content: string; contentHash: string; contentBytes: number }[] {
  const snapshots = (bundle as { sourceSnapshots?: unknown }).sourceSnapshots;
  return Array.isArray(snapshots) ? (snapshots as never) : [];
}

function boundedDetails(
  details: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  // Keep the serialized payload bounded; drop overflow deterministically.
  const entries = Object.entries(details);
  const kept: Record<string, string | number | boolean | null> = {};
  let size = 0;
  for (const [key, value] of entries) {
    const chunk = JSON.stringify({ [key]: value });
    if (size + chunk.length > CONTENT_HASH_RESULT_MAX_CHARS) break;
    kept[key] = value;
    size += chunk.length;
  }
  return kept;
}

/**
 * Run the content-hash proof over one server-resolved evidence item.
 * Pure: no I/O, no mutation, deterministic output for identical input.
 */
export function runContentHashProof(
  input: ContentHashProofInput,
  bundle: EvidenceBundle,
  verifiedAt: string = nowIso(),
): ContentHashProofOutcome {
  if (input.kind === "list") {
    // Listing is a pure projection: one unavailable marker per item is not
    // useful; instead report a single unavailable proof with no target.
    return {
      status: "unavailable",
      proof: {
        evidenceId: "",
        status: "unavailable",
        data: { message: "list is not a verification run" },
        verifiedAt,
      },
    };
  }

  const item = safeItems(bundle).find((entry) => entry.id === input.evidenceId);
  if (!item) {
    return {
      status: "unavailable",
      proof: {
        evidenceId: input.evidenceId,
        status: "unavailable",
        data: { message: "evidence item not found in the stored bundle" },
        verifiedAt,
      },
    };
  }

  const actualHash = sha256Utf8(item.text);
  if (actualHash !== item.provenance.contentHash) {
    return {
      status: "failed",
      proof: {
        evidenceId: item.id,
        status: "failed",
        adapterId: CONTENT_HASH_ADAPTER_ID,
        adapterVersion: CONTENT_HASH_ADAPTER_VERSION,
        algorithm: CONTENT_HASH_ALGORITHM,
        data: {
          details: boundedDetails({
            algorithm: CONTENT_HASH_ALGORITHM,
            adapterId: CONTENT_HASH_ADAPTER_ID,
            expectedHashPrefix: item.provenance.contentHash.slice(0, 8),
            actualHashPrefix: actualHash.slice(0, 8),
            reason: "hash mismatch",
          }),
        },
        verifiedAt,
      },
    };
  }

  // Snapshot cross-check: when the item came through a source adapter, the
  // snapshot's hash, byte count, and content must all agree exactly.
  const snapshotId = item.provenance.sourceSnapshotId;
  if (snapshotId !== undefined) {
    const snapshot = safeSnapshots(bundle).find((entry) => entry.id === snapshotId);
    if (!snapshot) {
      return {
        status: "unavailable",
        proof: {
          evidenceId: item.id,
          status: "unavailable",
          adapterId: CONTENT_HASH_ADAPTER_ID,
          adapterVersion: CONTENT_HASH_ADAPTER_VERSION,
          algorithm: CONTENT_HASH_ALGORITHM,
          data: {
            details: boundedDetails({
              algorithm: CONTENT_HASH_ALGORITHM,
              adapterId: CONTENT_HASH_ADAPTER_ID,
              sourceSnapshotId: snapshotId,
              reason: "source snapshot not found",
            }),
          },
          verifiedAt,
        },
      };
    }
    const snapshotHash = sha256Utf8(snapshot.content);
    const snapshotBytes = Buffer.byteLength(snapshot.content, "utf8");
    if (
      snapshotHash !== snapshot.contentHash ||
      snapshotBytes !== snapshot.contentBytes ||
      snapshot.content !== item.text
    ) {
      return {
        status: "failed",
        proof: {
          evidenceId: item.id,
          status: "failed",
          adapterId: CONTENT_HASH_ADAPTER_ID,
          adapterVersion: CONTENT_HASH_ADAPTER_VERSION,
          algorithm: CONTENT_HASH_ALGORITHM,
          data: {
            details: boundedDetails({
              algorithm: CONTENT_HASH_ALGORITHM,
              adapterId: CONTENT_HASH_ADAPTER_ID,
              sourceSnapshotId: snapshotId,
              reason: "source snapshot mismatch",
            }),
          },
          verifiedAt,
        },
      };
    }
  }

  return {
    status: "verified",
    proof: {
      evidenceId: item.id,
      status: "verified",
      adapterId: CONTENT_HASH_ADAPTER_ID,
      adapterVersion: CONTENT_HASH_ADAPTER_VERSION,
      algorithm: CONTENT_HASH_ALGORITHM,
      data: {
        details: boundedDetails({
          algorithm: CONTENT_HASH_ALGORITHM,
          adapterId: CONTENT_HASH_ADAPTER_ID,
          adapterVersion: CONTENT_HASH_ADAPTER_VERSION,
          ...(snapshotId !== undefined ? { sourceSnapshotId: snapshotId } : {}),
          contentBytes: Buffer.byteLength(item.text, "utf8"),
        }),
      },
      verifiedAt,
    },
  };
}

/**
 * Validate the produced proof against the bounded safe-result rules. Pure.
 */
export function isBoundedProofResult(proof: ProofResult): boolean {
  return JSON.stringify(proof).length <= CONTENT_HASH_RESULT_MAX_CHARS;
}
