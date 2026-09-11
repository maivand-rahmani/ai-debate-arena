/**
 * Maps the designer's UI evidence packet to the v0.4 wire shape for
 * `POST /api/debate` (F10-06).
 *
 * The browser sends basename + contents only: no ids, hashes, timestamps,
 * statuses, provenance, URLs, filesystem paths, capabilities, or verification
 * claims — the server assigns all of those. Empty/blank items are dropped and
 * the whole field is omitted when nothing usable remains.
 */
import type { EvidencePacket } from "./evidence-packet";
import type { DebateStreamEvidence } from "@/shared/api/debate-stream";

/** Reduce a stored file name to a safe basename (no directories, no dots). */
export function evidenceBasename(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  const last = normalized.split("/").pop() ?? "";
  return last === "." || last === ".." ? "" : last;
}

export function evidenceRequestFromPacket(
  packet: EvidencePacket | undefined,
): DebateStreamEvidence | undefined {
  const items = (packet?.items ?? [])
    .map((item) => ({
      source: item.kind === "file" ? ("local_file" as const) : ("user_text" as const),
      label: item.kind === "file" ? evidenceBasename(item.name) : item.name,
      content: item.text,
    }))
    .filter((item) => item.label.trim().length > 0 && item.content.trim().length > 0);
  if (items.length === 0) return undefined;
  return { version: 1, items };
}
