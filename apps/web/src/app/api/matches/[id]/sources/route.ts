import "server-only";

/**
 * Bounded opt-in external-source capture endpoint (F10-09, backend only).
 *
 * `POST /api/matches/[id]/sources` performs ONE explicit, user-confirmed,
 * consent-gated HTTPS capture of a source and merges it into the match's
 * evidence bundle. This is the only public entry point into the source-fetch
 * host; there is no automatic refresh, no caching, no background job, and no
 * scheduler anywhere on this path — a capture happens exclusively inside a
 * POST that carries `confirm: true`, and the captured snapshot is immutable.
 *
 * Safety properties:
 * - Strict bounded JSON input `{ version: 1, requestId, adapterId,
 *   adapterVersion, reference, label?, freshness, confirm: true }`. Unknown
 *   fields are rejected, never stripped: the client can only NAME the
 *   registered adapter (exact id AND version) and DESCRIBE what to capture
 *   (reference + optional label). It can never supply a manifest,
 *   capabilities, grants, a consent record/consentId, headers, hashes,
 *   content, provider ids, or any decision fields.
 * - The adapter manifest is SERVER-OWNED: a single fixed HTTPS text-capture
 *   adapter declared below. The client's adapterId/adapterVersion must match
 *   it exactly; anything else is rejected before the record is even loaded.
 * - Requires a completed match (`terminal: "completed"`); in-progress or
 *   failed matches are rejected with a safe 409.
 * - `freshness` is pinned to `snapshot-only` on this first route: captured
 *   material never goes stale, is never re-fetched, and is never refreshed.
 * - Requires a valid HTTPS reference (the shared URL policy: no userinfo, no
 *   IP literals, no localhost, port 443 only), validated before any lock or
 *   consent issuance.
 * - Under the same exclusive per-record lock as challenges/rejudge/proofs
 *   (P0-5): load record -> idempotency -> consent issuance -> one consented
 *   capture -> pure ingest -> ONE atomic persistence of the evidence bundle,
 *   source audit, and safe lifecycle events. Verdict, challenges,
 *   capabilities, transcript, and terminal state are carried through
 *   untouched.
 * - The `SourceConsent` is issued server-side per request via
 *   `issueSourceConsent` (server-issued `consentId`, exact adapter id AND
 *   version, matchId/requestId/reference binding, capability snapshots
 *   copied from the server manifest) and is never persisted, never echoed,
 *   and single-use by construction. The `net.fetch` capability grant is
 *   derived server-side for this explicit action only and never stored.
 * - Idempotency: the server-side `requestId` is pinned into the immutable
 *   snapshot's bounded metadata. A repeated requestId returns the stored
 *   source result without refetching (no second consent, no second socket).
 *   A repeated (adapter, reference) under a NEW requestId is rejected with a
 *   safe 409 — the ingest contract forbids duplicate captures.
 * - On failure, only safe reason codes are persisted (audit outcome +
 *   bounded detail, plus a `source-access-denied` event for the five gate
 *   reasons the event schema allows). Raw URLs, IPs, network errors, and
 *   provider secrets are never echoed, logged, or persisted.
 * - Legacy records without an evidence bundle stay valid: the bundle is
 *   initialized empty on the success path (additive, schema-validated);
 *   nothing else about legacy shapes changes.
 * - Relies on the existing loopback-only server binding (no auth layer
 *   exists; the whole app is local by design). Keep it that way.
 */
import {
  SOURCE_ADAPTER_LIMITS,
  SOURCE_AUDITS_MAX,
  appendEvidenceEvent,
  challengeLifecycleEvent,
  deniedSourceEventBody,
  emptyEvidenceBundle,
  ingestSourceCapture,
  issueSourceConsent,
  newSourceAccessAuditId,
  nextEvidenceEventSeq,
  type EvidenceEventBody,
  type MatchRecord,
  type SourceAccessAudit,
  type SourceAdapterManifest,
  type SourceAdapterRequest,
  type SourceSnapshot,
} from "@arena/debate-engine";
import { z } from "zod";
import { loadMatchRecord, matchRecordPath, saveMatchRecord } from "@/shared/config/match-store";
import { readBoundedJsonBody } from "@/shared/api/bounded-body";
import { withRecordLock } from "@/shared/config/record-lock";
import {
  fetchSourceCapture,
  parseSourceReference,
  type SourceFetchResult,
} from "@/shared/server/source-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SourcesRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

function jsonError(error: string, status: number, reason?: string): Response {
  return Response.json({ error, ...(reason !== undefined ? { reason } : {}) }, { status });
}

/* ------------------------------------------------------------------ */
/* Server-owned adapter (the client can never supply a manifest)       */
/* ------------------------------------------------------------------ */

/**
 * The ONE registered source adapter. Fixed at compile time, server-owned:
 * its capabilities, permissions, identity, and version never come from the
 * client. Clients only name it (adapterId + adapterVersion).
 */
const SOURCE_ADAPTER_MANIFEST: SourceAdapterManifest = Object.freeze({
  schemaVersion: 1,
  adapterId: "srcadp_https",
  version: "1.0.0",
  kind: "external-source",
  displayName: "Consented HTTPS source",
  requestedCapabilities: { "net.fetch": true },
  requiredPermissions: ["net.fetch"],
  requiresExplicitUserAction: true,
} as const);

/** Server-owned adapter request used for consent issuance. */
const SOURCE_ADAPTER_REQUEST: SourceAdapterRequest = Object.freeze({
  schemaVersion: 1,
  manifest: SOURCE_ADAPTER_MANIFEST,
  description: "Capture one explicitly consented HTTPS page as immutable, hash-pinned text.",
} as const);

/**
 * Server-owned freshness policy for this first route: snapshot-only — the
 * captured material never goes stale and is never refreshed. The client's
 * freshness field is validated (mode must be snapshot-only) but the policy
 * itself is never taken from the client.
 */
const SOURCE_FRESHNESS = Object.freeze({
  mode: "snapshot-only",
  maxAgeSeconds: 86_400,
} as const);

/** Safe event-schema denial reasons (the only ones an event body may carry). */
const DENIED_EVENT_REASONS = Object.freeze([
  "consent-missing",
  "consent-expired",
  "consent-replayed",
  "capability-denied",
  "permission-unmet",
] as const);
type DeniedEventReason = (typeof DENIED_EVENT_REASONS)[number];

/** Capture outcome including the route-level unexpected-throw fallback. */
type CaptureOutcome = SourceFetchResult | { readonly ok: false; readonly reason: "capture-failed" };

/* ------------------------------------------------------------------ */
/* Strict client input                                                 */
/* ------------------------------------------------------------------ */

const boundedRequestId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "requestId may only contain [A-Za-z0-9_-]");

const sourceRequestSchema = z.strictObject({
  version: z.literal(1),
  requestId: boundedRequestId,
  // The client may only NAME the fixed server adapter — never describe one.
  adapterId: z.literal("srcadp_https", { message: "unknown source adapter" }),
  adapterVersion: z.literal("1.0.0", { message: "unknown source adapter version" }),
  // Bounded here; the full HTTPS URL policy is enforced by parseSourceReference.
  reference: z.string().trim().min(1).max(SOURCE_ADAPTER_LIMITS.referenceChars),
  // Optional bounded human-readable label, stored as credential-free
  // snapshot metadata only when present.
  label: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine(
      (label) => !/[\u0000-\u001F\u007F]/.test(label),
      "label contains control characters",
    )
    .optional(),
  // First route is snapshot-only: no reuse window, no refresh semantics.
  freshness: z.strictObject({
    mode: z.literal("snapshot-only", { message: "freshness mode must be snapshot-only" }),
    // Bounded acknowledgement of the snapshot-only policy; the server pins
    // its own policy regardless of this value.
    maxAgeSeconds: z
      .number()
      .int()
      .min(SOURCE_ADAPTER_LIMITS.minMaxAgeSeconds)
      .max(SOURCE_ADAPTER_LIMITS.maxMaxAgeSeconds),
  }),
  // Explicit user action is mandatory — implicit defaults are rejected.
  confirm: z.literal(true),
});

/* ------------------------------------------------------------------ */
/* Failure mapping (safe codes only — never raw URLs/errors)           */
/* ------------------------------------------------------------------ */

/** HTTP status for a safe capture-failure reason code. */
function failureStatus(reason: string): number {
  if (reason === "timeout") return 408;
  if (reason === "body-too-large") return 413;
  if (
    reason === "consent-missing" ||
    reason === "consent-expired" ||
    reason === "consent-replayed" ||
    reason === "consent-invalid" ||
    reason === "capability-denied" ||
    reason === "permission-unmet" ||
    reason === "dns-blocked"
  ) {
    return 403;
  }
  return 502;
}

/** Audit outcome for a safe failure reason code. */
function failureOutcome(reason: string): "denied" | "expired" | "failed" {
  if (reason === "consent-expired") return "expired";
  return (DENIED_EVENT_REASONS as readonly string[]).includes(reason) ? "denied" : "failed";
}

function deniedEventReason(reason: string): DeniedEventReason | undefined {
  return (DENIED_EVENT_REASONS as readonly string[]).includes(reason)
    ? (reason as DeniedEventReason)
    : undefined;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Append one audit, keeping the record within the persisted-audit cap. */
function appendSourceAudit(
  existing: readonly SourceAccessAudit[] | undefined,
  audit: SourceAccessAudit,
): SourceAccessAudit[] {
  const next = [...(existing ?? []), audit];
  return next.length > SOURCE_AUDITS_MAX ? next.slice(next.length - SOURCE_AUDITS_MAX) : next;
}

/**
 * Build the bounded, safe source result returned to the client (both on a
 * fresh capture and on idempotent replay). Ids, hashes, counts, and modes
 * only — never snapshot content, consent material, or capability grants.
 */
function sourceResult(
  snapshot: SourceSnapshot,
  evidenceId: string | null,
  auditId: string | null,
): Record<string, unknown> {
  const metadata = snapshot.metadata ?? {};
  const requestId = metadata["requestId"];
  const label = metadata["label"];
  return {
    sourceSnapshot: {
      requestId: typeof requestId === "string" ? requestId : null,
      id: snapshot.id,
      adapterId: snapshot.adapterId,
      adapterVersion: snapshot.adapterVersion,
      reference: snapshot.reference,
      label: typeof label === "string" ? label : null,
      freshness: snapshot.freshness.mode,
      contentType: snapshot.contentType,
      contentBytes: snapshot.contentBytes,
      contentHash: snapshot.contentHash,
      capturedAt: snapshot.capturedAt,
    },
    evidence: { id: evidenceId },
  };
}

/**
 * Idempotency: a repeated requestId returns the stored source result without
 * refetching. The requestId was pinned into the immutable snapshot's
 * metadata at capture time.
 */
function storedSourceResult(record: MatchRecord, requestId: string): Response | undefined {
  const snapshots = record.evidence?.sourceSnapshots ?? [];
  const snapshot = snapshots.find((entry) => entry.metadata?.["requestId"] === requestId);
  if (snapshot === undefined) return undefined;
  const evidenceId =
    (record.evidence?.items ?? []).find((item) => item.provenance.sourceSnapshotId === snapshot.id)
      ?.id ?? null;
  const auditId =
    (record.sourceAudits ?? []).find((audit) => audit.sourceSnapshotId === snapshot.id)?.id ?? null;
  return Response.json(sourceResult(snapshot, evidenceId, auditId));
}

/**
 * Best-effort persistence of a safe failure audit (and, where the event
 * schema allows, a `source-access-denied` event). Only ids, outcomes, and
 * safe reason codes are persisted — never URLs, network errors, or content.
 */
async function persistSafeFailure(
  record: MatchRecord,
  consentId: string,
  outcome: "denied" | "expired" | "failed",
  reason: string,
  eventReason?: DeniedEventReason,
): Promise<void> {
  const audit: SourceAccessAudit = {
    schemaVersion: 1,
    id: newSourceAccessAuditId(),
    matchId: record.matchId,
    adapterId: SOURCE_ADAPTER_MANIFEST.adapterId,
    adapterVersion: SOURCE_ADAPTER_MANIFEST.version,
    outcome,
    consentId,
    accessedAt: new Date().toISOString(),
    detail: reason.slice(0, SOURCE_ADAPTER_LIMITS.detailChars),
  };
  let events = record.evidenceEvents;
  if (eventReason !== undefined) {
    events = appendEvidenceEvent(
      events,
      challengeLifecycleEvent(
        record.matchId,
        nextEvidenceEventSeq(events),
        deniedSourceEventBody(SOURCE_ADAPTER_MANIFEST.adapterId, eventReason),
      ),
    );
  }
  const updated: MatchRecord = {
    ...record,
    sourceAudits: appendSourceAudit(record.sourceAudits, audit),
    ...(events !== record.evidenceEvents ? { evidenceEvents: events } : {}),
  };
  try {
    await saveMatchRecord(updated);
  } catch (error) {
    // Failure-path audit persistence is best-effort; it never masks the
    // original safe failure response. Log a bounded, safe message only.
    console.error(
      `Failed to persist source audit for match ${record.matchId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export async function POST(request: Request, context: SourcesRouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    matchRecordPath(id);
  } catch {
    return jsonError("match-not-found", 404);
  }

  const bodyText = await readBoundedJsonBody(request);
  if (bodyText === null) {
    return jsonError("request-body-too-large", 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonError("invalid-json-body", 400);
  }
  const parsed = sourceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "invalid-source-request", 400);
  }
  const { requestId, reference, label } = parsed.data;

  // HTTPS URL policy before any lock, consent, or socket. Safe reason code
  // only; the reference is never echoed back in an error.
  const urlCheck = parseSourceReference(reference);
  if (!urlCheck.ok) {
    return jsonError("invalid-source-reference", 400, urlCheck.reason);
  }

  // P0-5: the whole read-modify-write — idempotency, consent issuance, the
  // capture itself, ingest, and persistence — runs under the same exclusive
  // per-record lock as challenges/rejudge/proofs, so concurrent duplicate
  // requestIds serialize: the first captures; the second finds the stored
  // snapshot and returns it without touching the network.
  try {
    return await withRecordLock(matchRecordPath(id), async () => {
      const record = await loadMatchRecord(id);
      if (!record) {
        return jsonError("match-not-found", 404);
      }

      // Only completed matches may gain external evidence. The original
      // verdict, challenges, and terminal state are never modified here.
      if (record.terminal !== "completed") {
        return jsonError("match-not-completed", 409);
      }

      // Idempotent replay: return the stored result, never refetch.
      const stored = storedSourceResult(record, requestId);
      if (stored !== undefined) {
        return stored;
      }

      // Legacy records without an evidence bundle stay valid: an empty
      // canonical bundle is initialized for the capture (additive only).
      const bundle = record.evidence ?? emptyEvidenceBundle();

      // The ingest contract forbids duplicate (adapter, reference) captures;
      // reject before issuing a consent or opening any socket.
      const duplicate = (bundle.sourceSnapshots ?? []).some(
        (snapshot) =>
          snapshot.adapterId === SOURCE_ADAPTER_MANIFEST.adapterId && snapshot.reference === reference,
      );
      if (duplicate) {
        return jsonError("source-already-captured", 409);
      }

      // Server-issued consent bound to matchId/requestId/adapter/version/
      // reference. The consent is never persisted and never echoed; its
      // single-use consentId only reaches the (immutable) audit record.
      const issued = issueSourceConsent(SOURCE_ADAPTER_REQUEST, {
        reference,
        matchId: record.matchId,
        requestId,
      });
      if (!issued.ok) {
        console.error(
          `Source consent issuance failed for match ${record.matchId}: ${issued.error}`,
        );
        return jsonError("source-consent-unavailable", 500);
      }

      // Server-granted net.fetch capability, derived for THIS explicit action
      // only. Deny-by-default everywhere else; never persisted.
      const grantedPermissions = { "net.fetch": true } as const;

      // One consent-gated HTTPS capture (the host validates the full gate,
      // URL policy, DNS/SSRF policy, and redirects before/while fetching).
      let capture: CaptureOutcome;
      try {
        capture = await fetchSourceCapture({
          manifest: SOURCE_ADAPTER_MANIFEST,
          consent: issued.consent,
          reference,
          grantedPermissions,
          matchId: record.matchId,
          requestId,
          metadata: { ...(label !== undefined ? { label } : {}), requestId },
        });
      } catch {
        // Fail closed: the host already maps network errors to safe reason
        // codes; an unexpected throw must not leak anything either.
        capture = { ok: false, reason: "capture-failed" };
      }
      if (!capture.ok) {
        await persistSafeFailure(
          record,
          issued.consent.consentId,
          failureOutcome(capture.reason),
          capture.reason,
          deniedEventReason(capture.reason),
        );
        return jsonError("source-capture-failed", failureStatus(capture.reason), capture.reason);
      }

      // Pure ingest merge: re-validates the gate and consent binding,
      // recomputes hash/bytes, derives the immutable snapshot, and returns
      // the bundle + audit + safe event bodies. No I/O, no decisions here.
      const ingest = ingestSourceCapture(
        bundle,
        {
          manifest: SOURCE_ADAPTER_MANIFEST,
          consent: issued.consent,
          reference,
          content: capture.capture.content,
          contentType: capture.capture.contentType,
          contentHash: capture.capture.contentHash,
          contentBytes: capture.capture.contentBytes,
          freshness: { ...SOURCE_FRESHNESS },
          metadata: { ...(label !== undefined ? { label } : {}), requestId },
          grantedPermissions,
        },
        { matchId: record.matchId, consentId: issued.consent.consentId },
      );
      if (!ingest.ok) {
        // The ingest reason may embed the reference or content hashes —
        // persist and return only the fixed safe code.
        await persistSafeFailure(record, issued.consent.consentId, "failed", "ingest-rejected");
        return jsonError("source-capture-rejected", 409);
      }

      // Stamp the audit with the bounded requestId (audit trail linkage) and
      // append the safe lifecycle events (ids/enums only, never content).
      const audit: SourceAccessAudit = { ...ingest.audit, detail: `requestId:${requestId}` };
      let events = record.evidenceEvents;
      for (const body of ingest.eventBodies as readonly EvidenceEventBody[]) {
        events = appendEvidenceEvent(
          events,
          challengeLifecycleEvent(record.matchId, nextEvidenceEventSeq(events), body),
        );
      }

      // ONE atomic persistence: bundle + audit + events together. Every other
      // record field (verdict, challenges, capabilities, terminal) is carried
      // through untouched by the spread.
      const updated: MatchRecord = {
        ...record,
        evidence: ingest.bundle,
        sourceAudits: appendSourceAudit(record.sourceAudits, audit),
        evidenceEvents: events,
      };
      try {
        await saveMatchRecord(updated);
      } catch (error) {
        console.error(
          `Failed to save source capture for match ${record.matchId}:`,
          error instanceof Error ? error.message : String(error),
        );
        return jsonError("unable-to-persist-source", 500);
      }

      const evidenceId =
        ingest.bundle.items.find((item) => item.provenance.sourceSnapshotId === ingest.snapshot.id)
          ?.id ?? null;
      return Response.json(sourceResult(ingest.snapshot, evidenceId, audit.id));
    });
  } catch (error) {
    if (error instanceof Error && /Another operation is in progress/.test(error.message)) {
      return jsonError("Another source operation is in progress for this match", 409);
    }
    throw error;
  }
}
