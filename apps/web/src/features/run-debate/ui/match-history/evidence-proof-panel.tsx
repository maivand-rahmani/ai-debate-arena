"use client";

import { useMemo, useState } from "react";
import type { EvidenceItem, ProofResult } from "@arena/types";
import { MatchesApiError, requestMatchProof, type MatchRecord } from "@/shared/api/matches";

type ProofState = "idle" | "checking" | "verified" | "failed" | "unavailable" | "error";

export function EvidenceProofPanel({ record }: { readonly record: MatchRecord }) {
  const items = record.evidence?.items ?? [];
  const stored = useMemo(() => new Map((record.evidence?.proofs ?? []).map((proof) => [proof.evidenceId, proof])), [record.evidence?.proofs]);
  const [results, setResults] = useState<Readonly<Record<string, ProofResult>>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  if (items.length === 0) return null;

  const check = async (item: EvidenceItem) => {
    if (checkingId) return;
    setCheckingId(item.id);
    setErrors((current) => ({ ...current, [item.id]: "" }));
    try {
      const proof = await requestMatchProof(record.matchId, item.id);
      setResults((current) => ({ ...current, [item.id]: proof }));
    } catch (reason) {
      const message = reason instanceof MatchesApiError
        ? reason.status === 404 ? "Proof checking is unavailable for this match." : reason.status === 409 ? "This stored item cannot be checked right now." : "The integrity check could not be completed."
        : "The integrity check could not be completed.";
      setErrors((current) => ({ ...current, [item.id]: message }));
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <section className="evidence-proof-panel" aria-labelledby="match-evidence-proof-title">
      <div>
        <p className="evidence-proof-panel__eyebrow">Stored evidence</p>
        <h2 id="match-evidence-proof-title" className="evidence-proof-panel__title">Content integrity</h2>
        <p className="evidence-proof-panel__intro">Check that each saved item still matches its stored content hash. This checks stored content integrity only; it does not verify truth or source authenticity.</p>
      </div>
      <ul className="evidence-proof-panel__list" aria-label="Stored evidence integrity checks">
        {items.map((item) => {
          const proof = results[item.id] ?? stored.get(item.id);
          const state: ProofState = checkingId === item.id ? "checking" : proof?.status ?? (errors[item.id] ? "error" : "idle");
          return <li key={item.id} className={`evidence-proof-panel__item evidence-proof-panel__item--${state}`}>
            <div className="evidence-proof-panel__copy"><strong>{item.provenance.reference || item.id}</strong><small>{item.provenance.kind} · {item.id}</small>{proof ? <span role="status">{proofLabel(proof.status)}{proof.data?.message ? ` · ${proof.data.message}` : ""}</span> : null}{errors[item.id] ? <span role="alert">{errors[item.id]}</span> : null}</div>
            <button type="button" className="evidence-proof-panel__button" onClick={() => void check(item)} disabled={checkingId !== null} aria-label={`${proof || errors[item.id] ? "Check again" : "Check"} stored content integrity for ${item.provenance.reference || item.id}`}>
              {state === "checking" ? "Checking…" : proof || errors[item.id] ? "Check again" : "Check integrity"}
            </button>
          </li>;
        })}
      </ul>
    </section>
  );
}

function proofLabel(status: ProofResult["status"]): string {
  return status === "verified" ? "Integrity verified" : status === "failed" ? "Integrity check failed" : "Check unavailable";
}
