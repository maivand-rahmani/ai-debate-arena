"use client";

import { FormEvent, useState } from "react";
import { MatchesApiError, requestMatchSource, type MatchRecord } from "@/shared/api/matches";

export function SourceCapturePanel({ record, onCaptured }: { readonly record: MatchRecord; readonly onCaptured: () => Promise<void> }) {
  const [reference, setReference] = useState(""); const [label, setLabel] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle"); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); let url: URL;
    try { url = new URL(reference); } catch { setState("error"); setMessage("Enter a valid HTTPS source URL."); return; }
    if (url.protocol !== "https:") { setState("error"); setMessage("Only HTTPS sources can be captured."); return; }
    if (!confirmed) { setState("error"); setMessage("Confirm the one-time, untrusted snapshot capture first."); return; }
    setState("loading"); setMessage("");
    try { await requestMatchSource(record.matchId, { reference: url.toString(), label: label.trim() || undefined }); await onCaptured(); setState("success"); setMessage("Source snapshot saved as untrusted evidence provenance. It is not verified for truth or authenticity."); setReference(""); setLabel(""); setConfirmed(false); }
    catch (reason) { setState("error"); const status = reason instanceof MatchesApiError ? reason.status : undefined; setMessage(status === 403 ? "This source was blocked." : status === 408 ? "The source timed out." : status === 413 ? "The source is too large." : status === 409 ? "Source capture is unavailable for this match." : "The source could not be captured safely."); }
  }
  return <section className="source-capture-panel" aria-labelledby="source-capture-title">
    <p className="source-capture-panel__eyebrow">Optional source capture</p><h2 id="source-capture-title" className="source-capture-panel__title">Add a source snapshot</h2>
    <p className="source-capture-panel__intro">Capture one HTTPS source once for this completed match. The snapshot is untrusted and unverified; it does not prove the source is true or authentic.</p>
    <form className="source-capture-panel__form" onSubmit={(event) => void submit(event)}>
      <label>HTTPS URL<input required type="url" inputMode="url" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="https://example.org/report" /></label>
      <label>Label <span>(optional)</span><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={128} placeholder="Report or reference" /></label>
      <label className="source-capture-panel__confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm this source will be fetched once and treated as untrusted, unverified snapshot evidence.</label>
      <button type="submit" disabled={state === "loading" || !confirmed}>{state === "loading" ? "Capturing…" : "Fetch source snapshot"}</button>
    </form><p className="source-capture-panel__guidance">Snapshot-only capture · 24-hour freshness guidance · no automatic refresh.</p>
    {message ? <p role={state === "error" ? "alert" : "status"} className={`source-capture-panel__message source-capture-panel__message--${state}`}>{message}</p> : null}
  </section>;
}
