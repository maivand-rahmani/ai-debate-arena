import { z } from "zod";
import type { DebateCriteria, DebateVerdict } from "./types";

const scoreField = z.number().finite().min(0).max(100);
const criteriaField = z.number().finite().min(0).max(100);

export const debateCriteriaSchema = z.object({
  argumentQualityA: criteriaField,
  argumentQualityB: criteriaField,
  rebuttalA: criteriaField,
  rebuttalB: criteriaField,
  consistencyA: criteriaField,
  consistencyB: criteriaField,
  relevanceA: criteriaField,
  relevanceB: criteriaField,
});

export const debateVerdictSchema = z.object({
  winner: z.enum(["A", "B", "DRAW"]),
  scoreA: scoreField,
  scoreB: scoreField,
  criteria: debateCriteriaSchema,
  reasoning: z.string().trim().min(1),
});

const debateVerdictInputSchema = z.object({
  winner: z.enum(["A", "B", "DRAW"]),
  scoreA: z.number().finite().min(0).max(100),
  scoreB: z.number().finite().min(0).max(100),
  criteria: debateCriteriaSchema.partial().optional(),
  reasoning: z.string().trim().min(1),
});

export type VerdictParseResult =
  | { readonly success: true; readonly data: DebateVerdict }
  | { readonly success: false; readonly error: z.ZodError };

/**
 * Extract a JSON object from model text that may be plain JSON, wrapped in a
 * single ```json ... ``` (or ``` ... ```) fence, or embedded in prose.
 * Returns the outermost `{...}` slice when present, otherwise trimmed input.
 * Never invents scores — unparsable input is left for the caller to reject.
 */
export function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] ?? trimmed).trim();
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // Fall through to outermost-brace extraction below.
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return candidate.slice(start, end + 1);
  }
  return candidate;
}

function defaultCriteria(scoreA: number, scoreB: number): DebateCriteria {
  const a = Number.isFinite(scoreA) ? Math.min(100, Math.max(0, scoreA)) : 0;
  const b = Number.isFinite(scoreB) ? Math.min(100, Math.max(0, scoreB)) : 0;
  return {
    argumentQualityA: a,
    argumentQualityB: b,
    rebuttalA: a,
    rebuttalB: b,
    consistencyA: a,
    consistencyB: b,
    relevanceA: a,
    relevanceB: b,
  };
}

export function parseDebateVerdict(input: unknown): VerdictParseResult {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(extractJsonObject(input));
    } catch {
      const invalid = debateVerdictSchema.safeParse({});
      if (!invalid.success) return { success: false, error: invalid.error };
      throw new Error("Unexpected verdict validation result");
    }
  }
  const parsed = debateVerdictInputSchema.safeParse(value);
  if (!parsed.success) {
    const fallback = debateVerdictSchema.safeParse(value);
    if (!fallback.success) return { success: false, error: parsed.error };
    return { success: true, data: fallback.data };
  }
  const defaults = defaultCriteria(parsed.data.scoreA, parsed.data.scoreB);
  const data: DebateVerdict = {
    winner: parsed.data.winner,
    scoreA: parsed.data.scoreA,
    scoreB: parsed.data.scoreB,
    criteria: { ...defaults, ...parsed.data.criteria },
    reasoning: parsed.data.reasoning,
  };
  return { success: true, data };
}

export const parseVerdict = parseDebateVerdict;

/** Score gap at or below which a DRAW winner is preserved. */
export const DRAW_MAX_SCORE_GAP = 2;

/**
 * Derive the consistent winner from score difference.
 * DRAW is preserved only when scores are within 2 points.
 */
export function normalizeVerdictWinner(verdict: DebateVerdict): DebateVerdict {
  const diff = verdict.scoreA - verdict.scoreB;
  const winner = Math.abs(diff) <= DRAW_MAX_SCORE_GAP ? "DRAW" : diff > 0 ? "A" : "B";
  return winner === verdict.winner ? verdict : { ...verdict, winner };
}

/**
 * Degenerate output: both scores are 0 despite a non-empty transcript.
 * The model emitted placeholder zeros instead of judging; callers should
 * retry rather than emit this.
 */
export function isDegenerateVerdict(verdict: DebateVerdict, hasTurns: boolean): boolean {
  return hasTurns && verdict.scoreA === 0 && verdict.scoreB === 0;
}
