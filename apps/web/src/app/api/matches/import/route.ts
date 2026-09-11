import { CONTRACT_VERSION, matchRecordSchema } from "@arena/debate-engine";
import { matchSummary } from "@/features/run-debate/server/export";
import { loadMatchRecord, matchRecordPath, saveMatchRecord } from "@/shared/config/match-store";
import { readBoundedJsonBody } from "@/shared/api/bounded-body";
import { withRecordLock } from "@/shared/config/record-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREDENTIAL_KEY_PATTERN = /api.?key|secret|token|authorization/i;

/**
 * Deep-scan for credential-like fields: keys matching the credential pattern
 * with non-empty string values (numeric counters such as usage tallies are
 * ignored). Returns deduplicated key names in encounter order.
 */
export function findCredentialLikeFields(value: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      if (CREDENTIAL_KEY_PATTERN.test(key) && typeof child === "string" && child.length > 0) {
        if (!seen.has(key)) {
          seen.add(key);
          found.push(key);
        }
      }
      visit(child);
    }
  };
  visit(value);
  return found;
}

/**
 * Import a previously exported match record (`exportMatchJson` shape; extra
 * export metadata is tolerated and stripped). Overwriting an existing id is
 * only allowed when the stored record already terminalled as completed.
 *
 * Hardening (P0-5):
 * - The body is read through the shared bounded reader BEFORE parsing, so an
 *   oversized or non-UTF-8 payload is rejected without ever being buffered or
 *   persisted.
 * - The whole read-modify-write (existence/terminal check + save) runs under
 *   the same exclusive per-record lock as proofs/challenges/rejudge, so a
 *   concurrent import, re-judge, or challenge cannot interleave writes and
 *   lose updates on the same record file.
 */
export async function POST(request: Request): Promise<Response> {
  const bodyText = await readBoundedJsonBody(request);
  if (bodyText === null) {
    return Response.json({ error: "Request body too large" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const credentialFields = findCredentialLikeFields(body);
  if (credentialFields.length > 0) {
    return Response.json(
      { error: `record contains credential-like fields: ${credentialFields.join(", ")}` },
      { status: 400 },
    );
  }

  const version = typeof body === "object" && body !== null
    ? (body as Record<string, unknown>).version
    : undefined;
  if (version !== undefined && version !== CONTRACT_VERSION) {
    return Response.json(
      { error: `unsupported contract version: expected ${CONTRACT_VERSION}, received ${JSON.stringify(version)}` },
      { status: 400 },
    );
  }

  const parsed = matchRecordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid match record" }, { status: 400 });
  }

  // The store rejects ids outside `[A-Za-z0-9_-]`; fail fast with a safe 400
  // instead of an unhandled 500 at persistence time.
  let recordPath: string;
  try {
    recordPath = matchRecordPath(parsed.data.matchId);
  } catch {
    return Response.json({ error: "Invalid match id" }, { status: 400 });
  }

  try {
    return await withRecordLock(recordPath, async () => {
      const existing = await loadMatchRecord(parsed.data.matchId);
      if (existing && existing.terminal !== "completed") {
        return Response.json({ error: "Existing match cannot be overwritten" }, { status: 409 });
      }

      await saveMatchRecord(parsed.data);
      return Response.json(matchSummary(parsed.data));
    });
  } catch (error) {
    if (error instanceof Error && /Another operation is in progress/.test(error.message)) {
      return Response.json({ error: "Another match operation is in progress" }, { status: 409 });
    }
    throw error;
  }
}
