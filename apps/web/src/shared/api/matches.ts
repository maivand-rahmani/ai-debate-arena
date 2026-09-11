/**
 * Client-side helpers for the v0.2 match inspection API.
 *
 *  - `GET /api/matches` → list of saved-match summaries
 *  - `GET /api/matches/[id]` → full record (JSON or markdown download)
 *  - `POST /api/matches/[id]/rejudge` → updated summary + `judgedAt`
 *
 * All endpoints may be temporarily unavailable while the server side is in
 * flight; helpers degrade gracefully with typed errors so callers can render
 * an empty state instead of crashing.
 */

import type { DebateStreamVerdict } from "./debate-stream";
import type { MatchMode } from "@arena/types";
import type { EvidenceBundle, MatchChallenge, ProofResult } from "@arena/types";

// --- Public types -----------------------------------------------------------

export type MatchTerminal = "completed" | "error" | "cancelled";
export type { MatchMode };
export type MatchWinner = "A" | "B" | "DRAW";

export interface MatchSummary {
  readonly id: string;
  readonly topic: string;
  readonly date: string;
  readonly mode: MatchMode;
  readonly winner: MatchWinner | null;
  readonly terminal: MatchTerminal;
  readonly judgedAt?: string;
}

export interface MatchSideRecord {
  readonly providerName: string;
  readonly modelId: string;
  readonly position: "FOR" | "AGAINST";
}

export interface MatchJudgeRef {
  readonly providerId: string;
  readonly model: string;
}

export interface MatchPolicy {
  readonly mode: MatchMode;
  readonly enabled: boolean;
  readonly rounds: number;
  readonly agentMaxOutputTokens: number;
  readonly judgeMaxOutputTokens: number;
  readonly historyTurns: number;
  readonly maxContextCharsPerSide: number;
}

export interface MatchPromptVersions {
  readonly agent: string;
  readonly judge: string;
}

export interface TranscriptTurnRecord {
  readonly id: string;
  readonly agentId: string;
  readonly side: "A" | "B";
  readonly phase: string;
  readonly content: string;
  readonly model: string;
  readonly createdAt: string;
}

export interface MatchRecord {
  readonly version: number;
  readonly matchId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly topic: string;
  readonly mode: MatchMode;
  readonly sides: { readonly A: MatchSideRecord; readonly B: MatchSideRecord };
  readonly judge?: MatchJudgeRef;
  readonly judgedAt?: string;
  readonly policy: MatchPolicy;
  readonly promptVersions: MatchPromptVersions;
  readonly rubricVersion: string;
  readonly transcript: readonly TranscriptTurnRecord[];
  readonly verdict: DebateStreamVerdict | null;
  readonly terminal: MatchTerminal;
  readonly terminalReason: string | null;
  readonly evidence?: EvidenceBundle;
  readonly challenges?: readonly MatchChallenge[];
  readonly metrics: {
    readonly turnsMs: readonly number[];
    readonly totalMs: number;
    readonly judgeMs?: number;
    readonly usage?: { readonly promptTokens: number; readonly completionTokens: number };
  };
}

export interface ChallengeRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly target: { readonly turnId: string; readonly claimText: string };
  readonly evidenceIds: readonly string[];
}

export interface MatchProofRequest {
  readonly version: 1;
  readonly evidenceId: string;
}

export interface MatchSourceRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly adapterId: "srcadp_https";
  readonly adapterVersion: "1.0.0";
  readonly reference: string;
  readonly label?: string;
  readonly freshness: { readonly mode: "snapshot-only"; readonly maxAgeSeconds: 86400 };
  readonly confirm: true;
}

export interface MatchSourceCapture { readonly sourceSnapshot?: unknown; readonly evidence?: unknown; }

export async function requestMatchSource(id: string, input: { reference: string; label?: string }): Promise<MatchSourceCapture> {
  const request: MatchSourceRequest = {
    version: 1,
    requestId: `src_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
    adapterId: "srcadp_https", adapterVersion: "1.0.0", reference: input.reference,
    ...(input.label ? { label: input.label } : {}),
    freshness: { mode: "snapshot-only", maxAgeSeconds: 86400 }, confirm: true,
  };
  let response: Response;
  try { response = await fetch(`/api/matches/${encodeURIComponent(id)}/sources`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(request) }); }
  catch (error) { throw new MatchesApiError(toMessage(error), undefined, "missing"); }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new MatchesApiError("Source capture response was not valid JSON", response.status, "parse"); }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string" ? (payload as { error: string }).error : `Source capture unavailable (${response.status})`;
    throw new MatchesApiError(message, response.status, "http");
  }
  if (!payload || typeof payload !== "object") throw new MatchesApiError("Source capture response was incompatible", response.status, "incompatible");
  return payload as MatchSourceCapture;
}

/** Request the deterministic proof for content saved in a completed match. */
export async function requestMatchProof(id: string, evidenceId: string): Promise<ProofResult> {
  let response: Response;
  try {
    response = await fetch(`/api/matches/${encodeURIComponent(id)}/proofs`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ version: 1, evidenceId } satisfies MatchProofRequest),
    });
  } catch (error) {
    throw new MatchesApiError(toMessage(error), undefined, "missing");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MatchesApiError("Proof response was not valid JSON", response.status, "parse");
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `Server responded ${response.status} ${response.statusText}`.trim();
    throw new MatchesApiError(message, response.status, "http");
  }
  const proof = payload && typeof payload === "object" ? (payload as { proof?: unknown }).proof : undefined;
  if (!proof || typeof proof !== "object") {
    throw new MatchesApiError("Proof response was missing the proof", response.status, "incompatible");
  }
  const candidate = proof as Partial<ProofResult>;
  if (candidate.evidenceId !== evidenceId || !["verified", "failed", "unavailable"].includes(candidate.status ?? "") || typeof candidate.verifiedAt !== "string") {
    throw new MatchesApiError("Proof response was incompatible", response.status, "incompatible");
  }
  return proof as ProofResult;
}

export async function submitMatchChallenge(id: string, request: ChallengeRequest): Promise<MatchChallenge> {
  let response: Response;
  try {
    response = await fetch(`/api/matches/${encodeURIComponent(id)}/challenges`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new MatchesApiError(toMessage(error), undefined, "missing");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MatchesApiError("Challenge response was not valid JSON", response.status, "parse");
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `Server responded ${response.status} ${response.statusText}`.trim();
    throw new MatchesApiError(message, response.status, "http");
  }
  const challenge = payload && typeof payload === "object" ? (payload as { challenge?: unknown }).challenge : undefined;
  if (!challenge || typeof challenge !== "object") {
    throw new MatchesApiError("Challenge response was missing the challenge", response.status, "incompatible");
  }
  return challenge as MatchChallenge;
}

export interface RejudgeSuccess {
  readonly summary: MatchSummary;
  readonly judgedAt: string;
}

export class MatchesApiError extends Error {
  public readonly status?: number;
  public readonly code: "missing" | "http" | "parse" | "incompatible";
  constructor(message: string, status: number | undefined, code: MatchesApiError["code"]) {
    super(message);
    this.name = "MatchesApiError";
    this.status = status;
    this.code = code;
  }
}

// --- Network helpers --------------------------------------------------------

export async function fetchMatchList(): Promise<readonly MatchSummary[]> {
  let response: Response;
  try {
    response = await fetch("/api/matches", { method: "GET", headers: { accept: "application/json" }, cache: "no-store" });
  } catch (error) {
    throw new MatchesApiError(toMessage(error), undefined, "missing");
  }
  if (!response.ok) {
    throw new MatchesApiError(
      `Server responded ${response.status} ${response.statusText}`.trim(),
      response.status,
      response.status === 404 ? "missing" : "http",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MatchesApiError("Match list response was not valid JSON", response.status, "parse");
  }
  return parseMatchList(payload);
}

export async function fetchMatch(id: string): Promise<MatchRecord> {
  let response: Response;
  try {
    response = await fetch(`/api/matches/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    throw new MatchesApiError(toMessage(error), undefined, "missing");
  }
  if (!response.ok) {
    throw new MatchesApiError(
      `Server responded ${response.status} ${response.statusText}`.trim(),
      response.status,
      response.status === 404 ? "missing" : "http",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MatchesApiError("Match record response was not valid JSON", response.status, "parse");
  }
  return parseMatchRecord(payload);
}

export async function rejudgeMatch(id: string): Promise<RejudgeSuccess> {
  let response: Response;
  try {
    response = await fetch(`/api/matches/${encodeURIComponent(id)}/rejudge`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new MatchesApiError(toMessage(error), undefined, "missing");
  }
  if (!response.ok) {
    let serverMessage = `Server responded ${response.status} ${response.statusText}`.trim();
    try {
      const body = (await response.clone().json()) as { readonly error?: unknown };
      if (typeof body?.error === "string" && body.error.length > 0) {
        serverMessage = body.error;
      }
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new MatchesApiError(serverMessage, response.status, "http");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MatchesApiError("Re-judge response was not valid JSON", response.status, "parse");
  }
  const summary = parseMatchSummary(payload);
  if (!summary.judgedAt) {
    throw new MatchesApiError("Re-judge response was missing a `judgedAt`", response.status, "incompatible");
  }
  return { summary, judgedAt: summary.judgedAt };
}

/** Convenience: returns a URL the browser can navigate to for a markdown download. */
export function markdownDownloadUrl(id: string): string {
  return `/api/matches/${encodeURIComponent(id)}?format=markdown`;
}

// --- Pure parsers -----------------------------------------------------------

function parseMatchList(payload: unknown): readonly MatchSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { readonly matches?: unknown }).matches;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      try {
        return parseMatchSummary(item);
      } catch {
        return null;
      }
    })
    .filter((value): value is MatchSummary => value !== null);
}

function parseMatchSummary(value: unknown): MatchSummary {
  if (!value || typeof value !== "object") {
    throw new MatchesApiError("Summary was malformed", undefined, "parse");
  }
  const v = value as Record<string, unknown>;
  const id = stringField(v.id);
  const topic = stringField(v.topic);
  const date = stringField(v.date);
  const mode = stringField(v.mode);
  const terminal = stringField(v.terminal);
  const rawWinner = v.winner;
  const winner: MatchWinner | null =
    rawWinner === "A" || rawWinner === "B" || rawWinner === "DRAW" ? rawWinner : null;
  const judgedAt = typeof v.judgedAt === "string" && v.judgedAt.length > 0 ? v.judgedAt : undefined;
  if (
    !id ||
    !topic ||
    !date ||
    (mode !== "quick" && mode !== "standard" && mode !== "hardcore") ||
    (terminal !== "completed" && terminal !== "error" && terminal !== "cancelled")
  ) {
    throw new MatchesApiError("Summary was missing required fields", undefined, "parse");
  }
  return judgedAt === undefined
    ? { id, topic, date, mode, winner, terminal }
    : { id, topic, date, mode, winner, terminal, judgedAt };
}

function parseMatchRecord(value: unknown): MatchRecord {
  if (!value || typeof value !== "object") {
    throw new MatchesApiError("Match record was malformed", undefined, "parse");
  }
  // The server stores the full record; we only require what the UI needs.
  // We trust the shape because the server validates via Zod on save.
  return value as MatchRecord;
}

function stringField(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Network request failed";
}
