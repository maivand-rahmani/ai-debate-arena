import "server-only";

import {
  appendEvidenceEvent,
  appendProofResult,
  challengeLifecycleEvent,
  nextEvidenceEventSeq,
  runContentHashProof,
  type EvidenceEventBody,
  type MatchRecord,
} from "@arena/debate-engine";
import { z } from "zod";
import { loadMatchRecord, matchRecordPath, saveMatchRecord } from "@/shared/config/match-store";
import { readBoundedJsonBody } from "@/shared/api/bounded-body";
import { withRecordLock } from "@/shared/config/record-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProofRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/**
 * Strict client input: `{ version: 1, evidenceId }`. Unknown fields are
 * rejected, never stripped: the client can only NAME a stored evidence item —
 * never supply hashes, statuses, adapter ids, capabilities, or content.
 */
const proofRequestSchema = z.strictObject({
  version: z.literal(1),
  evidenceId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, "evidenceId may only contain [A-Za-z0-9_-]"),
});

/**
 * Bounded post-match content-integrity proof endpoint (F10-16/F10-18).
 *
 * Runs the pure `sbadp_content-hash` adapter against the SERVER-resolved
 * evidence item in the stored bundle and persists the bounded `ProofResult`
 * plus a safe `proof-recorded` evidence event atomically with the updated
 * bundle (one locked read-modify-write, one atomic file rename). There are
 * NO model/provider calls on this path; the adapter is pure and deterministic.
 *
 * Safety properties:
 * - The evidence id is resolved against the STORED bundle only; unknown or
 *   missing references are rejected with a safe 409, never guessed.
 * - A repeated proof for the same evidence is idempotent: the stored result
 *   is returned unchanged, and `appendProofResult` additionally rejects
 *   duplicates at the bundle layer.
 * - Legacy records without an evidence bundle stay valid and get a 409.
 * - Verdict, challenges, source snapshots, audits, and terminal state are
 *   carried through untouched.
 */
export async function POST(request: Request, context: ProofRouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    matchRecordPath(id);
  } catch {
    return jsonError("Match not found", 404);
  }

  const bodyText = await readBoundedJsonBody(request);
  if (bodyText === null) {
    return jsonError("Request body too large", 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const parsed = proofRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid proof request", 400);
  }
  const { evidenceId } = parsed.data;

  // P0-5: the whole read-modify-write runs under the same exclusive
  // per-record lock as challenges/rejudge, so concurrent duplicate proofs
  // serialize: the first appends and persists; the second finds the stored
  // proof and returns it without re-running anything.
  try {
    return await withRecordLock(matchRecordPath(id), async () => {
      const record = await loadMatchRecord(id);
      if (!record) {
        return jsonError("Match not found", 404);
      }

      // Legacy records without an evidence bundle have nothing to prove;
      // they stay valid and get a safe 409 (never a guess or a crash).
      const bundle = record.evidence;
      if (!bundle) {
        return jsonError("Match record has no evidence bundle", 409);
      }

      // Idempotency: a repeated proof for the same evidence returns the
      // stored result without re-running the adapter.
      const existing = (bundle.proofs ?? []).find((proof) => proof.evidenceId === evidenceId);
      if (existing) {
        return Response.json({ proof: existing });
      }

      // The id must resolve against the stored bundle: unknown references
      // are rejected outright instead of becoming an "unavailable" proof.
      if (!bundle.items.some((item) => item.id === evidenceId)) {
        return jsonError("Unknown evidence reference", 409);
      }

      // Pure content-integrity proof over server-resolved evidence: no I/O,
      // no capabilities, no client-supplied content, bounded safe output
      // (ids, hash prefixes, byte counts — never raw content).
      const outcome = runContentHashProof({ kind: "verify", evidenceId }, bundle);
      const proof = outcome.proof;

      const appended = appendProofResult(bundle, proof);
      if (!appended.ok) {
        console.error(
          `Proof result rejected for match ${record.matchId}: ${appended.error}`,
        );
        return jsonError("Unable to persist proof", 500);
      }

      // Safe audit event: ids, enums, and adapter attribution only — never
      // content, hashes, errors, or secrets.
      const eventBody: EvidenceEventBody = {
        type: "proof-recorded",
        evidenceId: proof.evidenceId,
        status: proof.status,
        ...(proof.adapterId !== undefined ? { adapterId: proof.adapterId } : {}),
        ...(proof.adapterVersion !== undefined ? { adapterVersion: proof.adapterVersion } : {}),
        ...(proof.algorithm !== undefined ? { algorithm: proof.algorithm } : {}),
      };
      const events = appendEvidenceEvent(
        record.evidenceEvents,
        challengeLifecycleEvent(
          record.matchId,
          nextEvidenceEventSeq(record.evidenceEvents),
          eventBody,
        ),
      );

      // One atomic persistence: updated bundle + event together. Every other
      // record field (verdict, challenges, snapshots, audits, terminal) is
      // carried through untouched by the spread.
      const updated: MatchRecord = {
        ...record,
        evidence: appended.bundle,
        evidenceEvents: events,
      };
      try {
        await saveMatchRecord(updated);
      } catch (error) {
        console.error(
          `Failed to save proof for match ${record.matchId}:`,
          error instanceof Error ? error.message : String(error),
        );
        return jsonError("Unable to persist proof", 500);
      }

      return Response.json({ proof });
    });
  } catch (error) {
    if (error instanceof Error && /Another operation is in progress/.test(error.message)) {
      return jsonError("Another proof operation is in progress for this match", 409);
    }
    throw error;
  }
}
