"use client";

export type StandardEvidenceCardStatus = "pending" | "success" | "failure";

export interface StandardEvidenceCardData {
  readonly callId: string;
  readonly side: "A" | "B";
  readonly tool: string;
  readonly query: string;
  readonly status: StandardEvidenceCardStatus;
  readonly output?: string;
  readonly error?: string;
}

interface StandardEvidenceCardProps {
  readonly card: StandardEvidenceCardData;
  readonly number: number;
  readonly moveLabel: string;
}

const statusCopy: Record<StandardEvidenceCardStatus, string> = {
  pending: "In progress",
  success: "Success",
  failure: "Failed",
};

export function StandardEvidenceCard({ card, number, moveLabel }: StandardEvidenceCardProps) {
  const accent = card.side === "A" ? "coral" : "plum";
  const toolLabel = formatToolName(card.tool);
  const query = limitText(card.query, 128);
  const source = card.output ? sourceFromResult(card.output) : null;
  const sourceLabel = source
    ?? (card.status === "pending" ? "Awaiting result" : card.status === "failure" ? "Unavailable" : "Search results");
  const resultText = card.status === "failure"
    ? limitText(joinFailureText(card.error, card.output), 220)
    : limitText(card.output ?? "Waiting for the tool to return a result.", 320);

  return (
    <article
      className={`standard-evidence-card standard-evidence-card--${accent} standard-evidence-card--${card.status}`}
      aria-label={`${sideLabel(card.side)} ${toolLabel} ${statusCopy[card.status]}`}
    >
      <header className="standard-evidence-card__topline">
        <div className="standard-evidence-card__identity">
          <span className="standard-evidence-card__side-mark" aria-hidden="true" />
          <span>Agent {card.side}</span>
          <span className="standard-evidence-card__number">Evidence {String(number).padStart(2, "0")}</span>
        </div>
        <span className="standard-evidence-card__status">
          <span className="standard-evidence-card__status-dot" aria-hidden="true" />
          {statusCopy[card.status]}
        </span>
      </header>

      <div className="standard-evidence-card__toolline">
        <span className="standard-evidence-card__tool-mark" aria-hidden="true">↗</span>
        <strong>{toolLabel}</strong>
        <span>public tool</span>
      </div>

      <div className="standard-evidence-card__query">
        <span className="standard-evidence-card__label">Query</span>
        <p>{query || "No query supplied"}</p>
      </div>

      <div className="standard-evidence-card__source">
        <span className="standard-evidence-card__label">Source</span>
        <span title={source ?? undefined}>{sourceLabel}</span>
      </div>

      <div className={`standard-evidence-card__result${card.status === "failure" ? " standard-evidence-card__result--failure" : ""}`}>
        <div className="standard-evidence-card__result-head">
          <span className="standard-evidence-card__label">{card.status === "failure" ? "Failure" : "Result excerpt"}</span>
          {card.status === "pending" ? <span>Listening…</span> : null}
        </div>
        <p>{resultText}</p>
      </div>

      <footer className="standard-evidence-card__move-link">
        <span aria-hidden="true">→</span>
        <span>{moveLabel}</span>
      </footer>
    </article>
  );
}

function sideLabel(side: StandardEvidenceCardData["side"]): string {
  return `Agent ${side}`;
}

function formatToolName(tool: string): string {
  return tool
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function limitText(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 1).trimEnd()}…`;
}

function sourceFromResult(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s)\]}]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function joinFailureText(error: string | undefined, output: string | undefined): string {
  if (error && output && error !== output) return `${error}: ${output}`;
  return error ?? output ?? "The tool did not return a result.";
}
