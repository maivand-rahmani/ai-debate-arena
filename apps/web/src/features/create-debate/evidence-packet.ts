/** UI-only contract for the optional v0.4 evidence packet. */

export const EVIDENCE_PACKET_VERSION = 1 as const;
export const EVIDENCE_MAX_ITEMS = 8;
export const EVIDENCE_MAX_ITEM_BYTES = 4 * 1024;
export const EVIDENCE_MAX_FILE_BYTES = EVIDENCE_MAX_ITEM_BYTES;
export const EVIDENCE_MAX_TOTAL_BYTES = 16 * 1024;
export const EVIDENCE_MAX_LABEL_LENGTH = 128;

export const APPROVED_EVIDENCE_EXTENSIONS = [".txt", ".md", ".markdown"] as const;

export interface EvidenceItem {
  readonly id: string;
  readonly kind: "pasted" | "file";
  readonly name: string;
  readonly text: string;
  readonly bytes: number;
}

/** Stable, serializable shape for a parent to submit when backend support lands. */
export interface EvidencePacket {
  readonly version: typeof EVIDENCE_PACKET_VERSION;
  readonly items: readonly EvidenceItem[];
}

export function emptyEvidencePacket(): EvidencePacket {
  return { version: EVIDENCE_PACKET_VERSION, items: [] };
}

export function evidenceBytes(packet: EvidencePacket): number {
  return packet.items.reduce((total, item) => total + item.bytes, 0);
}

export function isApprovedEvidenceFile(file: Pick<File, "name">): boolean {
  const name = file.name.toLowerCase();
  return APPROVED_EVIDENCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function bytesForText(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function labelLength(label: string): number {
  return Array.from(label).length;
}

export function serializeEvidencePacket(packet: EvidencePacket): string {
  return JSON.stringify(packet);
}
