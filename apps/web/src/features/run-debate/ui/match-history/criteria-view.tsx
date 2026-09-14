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
    <section
      aria-label="Verdict rationale"
      className="grid gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
    >
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
          Why this verdict
        </p>
        <p className="mt-2 text-sm leading-relaxed text-arena-300">
          The judge scored each side against a four-criterion rubric. Wider
          bars mean a stronger showing on that criterion; the prose below
          explains the call.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-arena-400">No criteria recorded for this match.</p>
      ) : (
        <div className="criteria-table-wrap">
          <table className="criteria-table">
            <caption className="sr-only">Judge scores by criterion</caption>
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">Challenger</th>
                <th scope="col">Advocate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CriteriaRow key={row.title} {...row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {record.verdict ? (
        <div className="border-t border-white/[0.08] pt-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
            Reasoning
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-arena-100">
            {record.verdict.reasoning || "No reasoning was provided."}
          </p>
        </div>
      ) : null}

      <dl className="grid gap-2 border-t border-white/[0.08] pt-4 text-[11px] uppercase tracking-[0.18em] text-arena-300 sm:grid-cols-2">
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
    <tr>
      <th scope="row">{title}</th>
      <td className={left >= right ? "is-leading" : ""}>{left}</td>
      <td className={right >= left ? "is-leading" : ""}>{right}</td>
    </tr>
  );
}

function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-arena-400">{label}</dt>
      <dd className="font-medium text-arena-100">v{value}</dd>
    </div>
  );
}
