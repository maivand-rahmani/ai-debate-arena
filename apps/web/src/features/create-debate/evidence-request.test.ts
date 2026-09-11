import { describe, expect, it } from "vitest";
import { evidenceBasename, evidenceRequestFromPacket } from "./evidence-request";
import { emptyEvidencePacket, type EvidencePacket } from "./evidence-packet";

describe("evidence request mapping (F10-06)", () => {
  it("omits the evidence field for an empty packet", () => {
    expect(evidenceRequestFromPacket(undefined)).toBeUndefined();
    expect(evidenceRequestFromPacket(emptyEvidencePacket())).toBeUndefined();
  });

  it("maps pasted notes to user_text and files to local_file with basename labels", () => {
    const packet: EvidencePacket = {
      version: 1,
      items: [
        { id: "pasted", kind: "pasted", name: "Pasted notes", text: "Pasted content.", bytes: 15 },
        { id: "f1", kind: "file", name: "brief.md", text: "# Brief", bytes: 7 },
      ],
    };
    expect(evidenceRequestFromPacket(packet)).toEqual({
      version: 1,
      items: [
        { source: "user_text", label: "Pasted notes", content: "Pasted content." },
        { source: "local_file", label: "brief.md", content: "# Brief" },
      ],
    });
  });

  it("sends basename + contents only — never client ids, bytes, or kinds", () => {
    const packet: EvidencePacket = {
      version: 1,
      items: [{ id: "f1", kind: "file", name: "notes.txt", text: "content", bytes: 7 }],
    };
    const wire = JSON.stringify(evidenceRequestFromPacket(packet));
    expect(wire).not.toContain('"id"');
    expect(wire).not.toContain('"bytes"');
    expect(wire).not.toContain('"kind"');
    expect(wire).not.toContain("contentHash");
    expect(wire).not.toContain("status");
    expect(wire).not.toContain("provenance");
  });

  it("reduces file names to safe basenames", () => {
    expect(evidenceBasename("notes.txt")).toBe("notes.txt");
    expect(evidenceBasename("dir/notes.txt")).toBe("notes.txt");
    expect(evidenceBasename("dir\\notes.txt")).toBe("notes.txt");
    expect(evidenceBasename("/etc/passwd")).toBe("passwd");
    expect(evidenceBasename("..")).toBe("");
    expect(evidenceBasename(".")).toBe("");
  });

  it("drops blank items and omits the field when nothing usable remains", () => {
    const packet: EvidencePacket = {
      version: 1,
      items: [
        { id: "pasted", kind: "pasted", name: "Pasted notes", text: "   ", bytes: 3 },
        { id: "f1", kind: "file", name: "..", text: "content", bytes: 7 },
      ],
    };
    expect(evidenceRequestFromPacket(packet)).toBeUndefined();
  });
});
