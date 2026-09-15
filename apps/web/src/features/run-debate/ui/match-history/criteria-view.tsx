"use client";

import type { MatchRecord } from "@/shared/api/matches";
import { buildCriteriaRows } from "./format-helpers";

interface CriteriaViewProps {
  readonly record: MatchRecord;
}

/**
 * "Why this verdict" panel: 4 paired A-vs-B bars (one per rubric criterion),
 * the judge's reasoning prose, and the rubric / prompt-version labels so the
 * reader can tell which generation of the judge produced the score.
 */
export function CriteriaView({ record }: CriteriaViewProps) {
  const rows = buildCriteriaRows(record);
  return (
    <section aria-label="Verdict rationale" className="criteria-view">
      <div className="criteria-view__intro">
        <p className="criteria-view__kicker">Why this verdict</p>
        <p className="criteria-view__intro-copy">
          The judge scored each side against a four-criterion rubric. Wider
          bars mean a stronger showing on that criterion; the prose below
          explains the call.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="criteria-view__empty">No criteria recorded for this match.</p>
      ) : (
        <div className="criteria-view__rows" role="list" aria-label="Judge scores by criterion">
          <div className="criteria-view__column-head" aria-hidden="true">
            <span>Criterion</span><span>Ember · Challenger</span><span>Vesper · Advocate</span>
          </div>
          {rows.map((row) => (
            <CriteriaRow key={row.title} {...row} />
          ))}
        </div>
      )}

      {record.verdict ? (
        <div className="criteria-view__reasoning">
          <p className="criteria-view__kicker">Judge’s rationale</p>
          <p className="criteria-view__reasoning-copy">
            {record.verdict.reasoning || "No rationale was provided."}
          </p>
        </div>
      ) : null}

      <dl className="criteria-view__versions">
        <VersionRow label="Agent prompt" value={record.promptVersions.agent} />
        <VersionRow label="Judge prompt" value={record.promptVersions.judge} />
        <VersionRow label="Rubric" value={record.rubricVersion} />
        <VersionRow label="Contract" value={String(record.version)} />
      </dl>
    </section>
  );
}

function CriteriaRow({
  title,
  left,
  right,
}: {
  title: string;
  leftLabel: string;
  rightLabel: string;
  left: number;
  right: number;
}) {
  return (
    <article className="criteria-view__row" role="listitem">
      <h3>{title}</h3>
      <ScoreBar side="ember" label="Ember · Challenger" value={left} leading={left >= right} />
      <ScoreBar side="vesper" label="Vesper · Advocate" value={right} leading={right >= left} />
    </article>
  );
}

function ScoreBar({
  side,
  label,
  value,
  leading,
}: {
  readonly side: "ember" | "vesper";
  readonly label: string;
  readonly value: number;
  readonly leading: boolean;
}) {
  const safeValue = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className={`criteria-view__score criteria-view__score--${side}${leading ? " is-leading" : ""}`}>
      <div className="criteria-view__score-head">
        <span>{label}</span><strong>{value}</strong>
      </div>
      <div className="criteria-view__bar" aria-hidden="true">
        <span style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>v{value}</dd>
    </div>
  );
}
