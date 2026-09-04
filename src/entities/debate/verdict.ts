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
      value = JSON.parse(input);
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
