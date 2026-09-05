import { CONTRACT_VERSION, type MatchRecord } from "../../../entities/debate/contract";

export interface MatchSummary {
  readonly id: string;
  readonly topic: string;
  readonly date: string;
  readonly mode: MatchRecord["mode"];
  readonly winner: "A" | "B" | "DRAW" | null;
  readonly terminal: MatchRecord["terminal"];
  readonly judgedAt?: string;
}

/** List/get summary for a stored record (winner or pending). */
export function matchSummary(record: MatchRecord): MatchSummary {
  const summary: MatchSummary = {
    id: record.matchId,
    topic: record.topic,
    date: record.startedAt,
    mode: record.mode,
    winner: record.verdict?.winner ?? null,
    terminal: record.terminal,
  };
  return record.judgedAt === undefined ? summary : { ...summary, judgedAt: record.judgedAt };
}

/** Redacted JSON export: the record as stored (already secret-free) plus export metadata. */
export function exportMatchJson(record: MatchRecord): string {
  return JSON.stringify(
    {
      ...record,
      exportedAt: new Date().toISOString(),
      contractVersion: CONTRACT_VERSION,
    },
    null,
    2,
  );
}

/** Human-readable Markdown export of a stored record. */
export function exportMatchMarkdown(record: MatchRecord): string {
  const lines: string[] = [];
  lines.push(`# Debate: ${record.topic}`, "");
  lines.push(`- Mode: ${record.mode}`, `- Date: ${record.startedAt}`, `- Terminal: ${record.terminal}`, "");
  lines.push("## Sides", "");
  lines.push("| Side | Provider | Model | Position |", "|------|----------|-------|----------|");
  for (const side of ["A", "B"] as const) {
    const entry = record.sides[side];
    lines.push(`| ${side} | ${entry.providerName} | ${entry.modelId} | ${entry.position} |`);
  }
  lines.push("", "## Transcript", "");
  if (record.transcript.length === 0) {
    lines.push("_No turns recorded._", "");
  } else {
    for (const turn of record.transcript) {
      lines.push(`### ${turn.phase} — Side ${turn.side}`, "", turn.content, "");
    }
  }
  lines.push("## Verdict", "");
  if (record.verdict) {
    const verdict = record.verdict;
    lines.push(`Winner: ${verdict.winner} (${verdict.scoreA}–${verdict.scoreB})`, "");
    lines.push("| Criterion | A | B |", "|-----------|---|---|");
    lines.push(
      `| Argument quality | ${verdict.criteria.argumentQualityA} | ${verdict.criteria.argumentQualityB} |`,
      `| Rebuttal | ${verdict.criteria.rebuttalA} | ${verdict.criteria.rebuttalB} |`,
      `| Consistency | ${verdict.criteria.consistencyA} | ${verdict.criteria.consistencyB} |`,
      `| Relevance | ${verdict.criteria.relevanceA} | ${verdict.criteria.relevanceB} |`,
    );
    lines.push("", `Reasoning: ${verdict.reasoning}`, "");
  } else {
    lines.push("No verdict reached.", "");
  }
  lines.push(
    "---",
    `Exported from match ${record.matchId} · agent prompt v${record.promptVersions.agent} · ` +
      `judge prompt v${record.promptVersions.judge} · rubric v${record.rubricVersion} · contract v${record.version}`,
  );
  return lines.join("\n");
}
