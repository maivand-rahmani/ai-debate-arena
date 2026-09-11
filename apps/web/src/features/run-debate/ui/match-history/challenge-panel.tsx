"use client";

import { useMemo, useState } from "react";
import type { MatchChallenge, EvidenceItem } from "@arena/types";
import { MatchesApiError, submitMatchChallenge, type MatchRecord } from "@/shared/api/matches";

const MAX_EVIDENCE = 4;

export function ChallengePanel({ record }: { readonly record: MatchRecord }) {
  const [turnId, setTurnId] = useState("");
  const [claimText, setClaimText] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<MatchChallenge | null>(null);
  const [requestId, setRequestId] = useState(() => newRequestId());
  const selectedTurn = record.transcript.find((turn) => turn.id === turnId);
  const evidence = record.evidence?.items ?? [];
  const prior = record.challenges ?? [];
  const ready = Boolean(turnId && claimText.trim() && status !== "submitting");
  const request = useMemo(() => ({ version: 1 as const, requestId, target: { turnId, claimText }, evidenceIds }), [claimText, evidenceIds, requestId, turnId]);

  const chooseTurn = (id: string) => {
    setTurnId(id);
    setClaimText("");
    setError(null);
  };
  const toggleEvidence = (id: string) => setEvidenceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < MAX_EVIDENCE ? [...current, id] : current);
  const submit = async () => {
    if (!ready) return;
    setStatus("submitting");
    setError(null);
    try {
      setLatest(await submitMatchChallenge(record.matchId, request));
      setStatus("idle");
      setRequestId(newRequestId());
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof MatchesApiError && reason.status
        ? `${reason.status === 400 ? "Validation failed" : reason.status === 409 ? "Challenge unavailable" : "Challenge failed"} (${reason.status}): ${reason.message}`
        : reason instanceof Error ? reason.message : "The challenge could not be submitted.");
    }
  };

  return (
    <section className="challenge-panel" aria-labelledby="match-challenge-title">
      <div>
        <p className="challenge-panel__eyebrow">Post-match review</p>
        <h2 id="match-challenge-title" className="challenge-panel__title">Challenge a claim</h2>
        <p className="challenge-panel__intro">Ask the model to review one exact excerpt using evidence saved with this match. This does not change the original verdict.</p>
      </div>
      <fieldset className="challenge-panel__fieldset">
        <legend>1 · Target a transcript turn</legend>
        <div className="challenge-panel__turns">
          {record.transcript.map((turn, index) => <button key={turn.id} type="button" aria-pressed={turn.id === turnId} onClick={() => chooseTurn(turn.id)} className={turn.id === turnId ? "is-selected" : ""}>Turn {index + 1} · {turn.side}<small>{turn.content.slice(0, 92)}{turn.content.length > 92 ? "…" : ""}</small></button>)}
        </div>
      </fieldset>
      <label className="challenge-panel__label">2 · Exact claim excerpt
        <textarea value={claimText} onChange={(event) => setClaimText(event.target.value)} disabled={!selectedTurn} rows={3} placeholder={selectedTurn ? "Paste the exact words from the selected turn…" : "Select a turn first"} />
        <span>The server validates that this excerpt appears exactly in the selected turn.</span>
      </label>
      <fieldset className="challenge-panel__fieldset">
        <legend>3 · Stored evidence <small>Optional · up to 4</small></legend>
        {evidence.length === 0 ? <p className="challenge-panel__muted">No stored evidence is available for this match.</p> : <div className="challenge-panel__evidence">{evidence.map((item) => <EvidenceChoice key={item.id} item={item} checked={evidenceIds.includes(item.id)} disabled={!evidenceIds.includes(item.id) && evidenceIds.length >= MAX_EVIDENCE} onChange={() => toggleEvidence(item.id)} />)}</div>}
      </fieldset>
      <p className="challenge-panel__notice"><strong>Model-assessed, not factual verification.</strong> The response is a bounded review by a model, with the selected evidence and provenance shown where available.</p>
      {error ? <p className="challenge-panel__error" role="alert">{error} <span>Check the excerpt and try again. Retrying uses a safe request key.</span></p> : null}
      {latest ? <ChallengeResult challenge={latest} /> : null}
      {prior.length ? <div className="challenge-panel__history" aria-label="Previous challenge outcomes">{prior.map((challenge) => <div key={challenge.id}><strong>{challenge.status}</strong><span>{challenge.targetClaimText}</span></div>)}</div> : null}
      <button type="button" className="challenge-panel__submit" onClick={() => void submit()} disabled={!ready}>{status === "submitting" ? "Reviewing…" : "Submit challenge"}</button>
    </section>
  );
}

function EvidenceChoice({ item, checked, disabled, onChange }: { item: EvidenceItem; checked: boolean; disabled: boolean; onChange: () => void }) {
  return <label className="challenge-panel__evidence-item"><input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} /><span><strong>{item.provenance.reference || item.id}</strong><small>{item.provenance.kind} · {item.id}</small></span></label>;
}

function ChallengeResult({ challenge }: { challenge: MatchChallenge }) {
  const text = challenge.status === "resolved" ? challenge.adjudication?.reasoning : challenge.status === "unable" ? challenge.response?.kind === "unable" ? challenge.response.explanation ?? "The challenged model could not assess this claim." : "The challenged model could not assess this claim." : challenge.failureReason;
  return <div className={`challenge-panel__result challenge-panel__result--${challenge.status}`} role="status"><strong>{challenge.status === "resolved" ? "Review resolved" : challenge.status === "unable" ? "Unable to assess" : challenge.status === "expired" ? "Review expired" : challenge.status === "failed" ? "Review failed" : challenge.status}</strong>{text ? <p>{text}</p> : null}{challenge.adjudication?.evidenceAssessments.length ? <small>Evidence references: {challenge.adjudication.evidenceAssessments.map((item) => item.evidenceId).join(", ")}</small> : null}<small>Model-assessed only. The original verdict remains authoritative.</small></div>;
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `challenge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
