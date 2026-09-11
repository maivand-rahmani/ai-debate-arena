import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceProofPanel } from "./evidence-proof-panel";
import type { MatchRecord } from "@/shared/api/matches";

const record = {
  matchId: "match-1",
  evidence: {
    items: [{ id: "ev_1", text: "saved text", provenance: { reference: "notes.txt", kind: "user-file" } }],
    proofs: [{ evidenceId: "ev_1", status: "verified", verifiedAt: "2026-01-01T00:00:00.000Z" }],
  },
} as unknown as MatchRecord;

describe("EvidenceProofPanel", () => {
  it("renders one accessible control and the integrity-only disclaimer per stored item", () => {
    const html = renderToStaticMarkup(<EvidenceProofPanel record={record} />);
    expect(html).toContain("Check again stored content integrity for notes.txt");
    expect(html).toContain("Integrity verified");
    expect(html).toContain("stored content integrity only");
    expect(html).toContain("does not verify truth or source authenticity");
  });
});
