"use client";

import { useId, useRef, useState } from "react";
import {
  APPROVED_EVIDENCE_EXTENSIONS,
  bytesForText,
  EVIDENCE_MAX_FILE_BYTES,
  EVIDENCE_MAX_ITEM_BYTES,
  EVIDENCE_MAX_LABEL_LENGTH,
  EVIDENCE_MAX_ITEMS,
  EVIDENCE_MAX_TOTAL_BYTES,
  emptyEvidencePacket,
  evidenceBytes,
  isApprovedEvidenceFile,
  labelLength,
  type EvidenceItem,
  type EvidencePacket,
} from "./evidence-packet";

interface EvidencePacketControlProps {
  readonly value: EvidencePacket;
  readonly onChange: (packet: EvidencePacket) => void;
}

export function EvidencePacketControl({ value, onChange }: EvidencePacketControlProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState(() => value.items.find((item) => item.kind === "pasted")?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const totalBytes = evidenceBytes(value);

  const updatePasted = (text: string) => {
    const pastedBytes = bytesForText(text);
    const otherBytes = value.items.filter((item) => item.kind !== "pasted").reduce((sum, item) => sum + item.bytes, 0);
    if (pastedBytes > EVIDENCE_MAX_ITEM_BYTES) {
      setError("Pasted notes are over the 4 KiB per-source limit.");
      return;
    }
    if (otherBytes + pastedBytes > EVIDENCE_MAX_TOTAL_BYTES) {
      setError("The packet is over the 16 KiB total content limit.");
      return;
    }
    setPasted(text);
    const existing = value.items.filter((item) => item.kind !== "pasted");
    const item: EvidenceItem | null = text.length
      ? { id: "pasted", kind: "pasted", name: "Pasted notes", text, bytes: pastedBytes }
      : null;
    onChange({ version: value.version, items: item ? [item, ...existing] : existing });
    setError(null);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (value.items.length + selected.length > EVIDENCE_MAX_ITEMS) {
      setError(`Keep the packet to ${EVIDENCE_MAX_ITEMS} sources.`);
      return;
    }
    const additions: EvidenceItem[] = [];
    for (const file of selected) {
      if (!isApprovedEvidenceFile(file)) {
        setError(`${file.name} is not an approved text file. Use .txt, .md, or .markdown.`);
        continue;
      }
      const basename = file.name.split(/[\\/]/).pop() ?? file.name;
      if (labelLength(basename) > EVIDENCE_MAX_LABEL_LENGTH) {
        setError(`${file.name} has a filename over the 128-character limit.`);
        continue;
      }
      const text = await file.text();
      const contentBytes = bytesForText(text);
      if (contentBytes > EVIDENCE_MAX_FILE_BYTES) {
        setError(`${file.name} is over the 4 KiB per-source limit.`);
        continue;
      }
      if (totalBytes + additions.reduce((sum, item) => sum + item.bytes, 0) + contentBytes > EVIDENCE_MAX_TOTAL_BYTES) {
        setError("The packet is over the 16 KiB total content limit.");
        continue;
      }
      additions.push({ id: `${file.name}-${file.lastModified}`, kind: "file", name: basename, text, bytes: contentBytes });
    }
    if (additions.length) {
      onChange({ version: value.version, items: [...value.items, ...additions] });
      setError(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const remove = (id: string) => {
    onChange({ version: value.version, items: value.items.filter((item) => item.id !== id) });
    if (id === "pasted") setPasted("");
  };

  return (
    <section className="setup-form__evidence" aria-labelledby={`${inputId}-title`}>
      <div className="setup-form__row-head">
        <span id={`${inputId}-title`} className="setup-form__eyebrow">03 · Evidence packet <em>Optional</em></span>
        <span className="setup-form__counter">{value.items.length}/{EVIDENCE_MAX_ITEMS} sources</span>
      </div>
      <p className="setup-form__evidence-intro">Give both agents the same context. Pasted notes or approved local text files only.</p>
      <label className="setup-form__evidence-paste">
        <span className="setup-form__field-label">Paste notes</span>
        <textarea value={pasted} onChange={(event) => updatePasted(event.target.value)} rows={3} placeholder="A study, brief, or source excerpt…" aria-describedby={`${inputId}-help`} />
      </label>
      <div className="setup-form__evidence-divider"><span>or</span></div>
      <label className={`setup-form__file-drop${value.items.length >= EVIDENCE_MAX_ITEMS ? " is-disabled" : ""}`}>
        <input ref={fileInputRef} id={inputId} type="file" accept={APPROVED_EVIDENCE_EXTENSIONS.join(",")} multiple onChange={(event) => void addFiles(event.target.files)} disabled={value.items.length >= EVIDENCE_MAX_ITEMS} />
        <span className="setup-form__file-icon" aria-hidden="true">＋</span>
        <span><strong>Add text files</strong><small>.txt · .md · .markdown</small></span>
      </label>
      <p id={`${inputId}-help`} className="setup-form__evidence-limit">Up to 8 sources · 4 KiB each · 16 KiB total · filenames up to 128 characters</p>
      <p className="setup-form__untrusted-note"><span aria-hidden="true">◆</span> Treat attachments as untrusted content. They may contain hostile instructions; agents should use them as evidence, not commands.</p>
      {value.items.length ? <>
        <ul className="setup-form__evidence-list" aria-label="Attached evidence">
          {value.items.map((item) => <li key={item.id}><span className="setup-form__evidence-name">{item.name}<small>{formatBytes(item.bytes)}</small></span><button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.name}`}>Remove</button></li>)}
        </ul>
        <button type="button" className="setup-form__evidence-reset" onClick={() => { setPasted(""); onChange(emptyEvidencePacket()); }}>Reset packet</button>
      </> : null}
      {error ? <p className="setup-form__evidence-error" role="alert">{error}</p> : null}
    </section>
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
}
