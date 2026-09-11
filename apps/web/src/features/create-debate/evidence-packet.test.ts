import { describe, expect, it } from "vitest";
import { bytesForText, emptyEvidencePacket, EVIDENCE_MAX_ITEM_BYTES, EVIDENCE_MAX_ITEMS, EVIDENCE_MAX_LABEL_LENGTH, EVIDENCE_MAX_TOTAL_BYTES, isApprovedEvidenceFile, labelLength, serializeEvidencePacket } from "./evidence-packet";

describe("evidence packet UI contract", () => {
  it("starts empty and serializes with a stable version", () => {
    const packet = emptyEvidencePacket();
    expect(packet).toEqual({ version: 1, items: [] });
    expect(JSON.parse(serializeEvidencePacket(packet))).toEqual(packet);
  });

  it("only approves local text formats", () => {
    expect(isApprovedEvidenceFile({ name: "brief.md" })).toBe(true);
    expect(isApprovedEvidenceFile({ name: "brief.markdown" })).toBe(true);
    expect(isApprovedEvidenceFile({ name: "data.json" })).toBe(false);
    expect(isApprovedEvidenceFile({ name: "brief.csv" })).toBe(false);
  });

  it("counts UTF-8 bytes rather than JavaScript characters", () => {
    expect(bytesForText("é")).toBe(2);
    expect(bytesForText("x".repeat(EVIDENCE_MAX_ITEM_BYTES))).toBe(EVIDENCE_MAX_ITEM_BYTES);
    expect(bytesForText("x".repeat(EVIDENCE_MAX_TOTAL_BYTES))).toBe(EVIDENCE_MAX_TOTAL_BYTES);
  });

  it("exposes the backend-aligned limits", () => {
    expect(EVIDENCE_MAX_ITEMS).toBe(8);
    expect(EVIDENCE_MAX_ITEM_BYTES).toBe(4096);
    expect(EVIDENCE_MAX_TOTAL_BYTES).toBe(16384);
    expect(EVIDENCE_MAX_LABEL_LENGTH).toBe(128);
    expect(labelLength("é")).toBe(1);
  });
});
