import type { DebateSide } from "@arena/types";

/** The two positions an agent can hold on a motion. */
export type DebatePosition = "FOR" | "AGAINST";

/**
 * Sides are fixed by the product: the Challenger (side A) argues FOR the
 * motion and the Advocate (side B) argues AGAINST it. This is the single
 * source of truth for setup, request building, and the API route so user
 * input (or stale/legacy draft data) can never swap them.
 */
export const SIDE_POSITIONS: Readonly<Record<DebateSide, DebatePosition>> = {
  A: "FOR",
  B: "AGAINST",
};

/** User-facing role names for each fixed side. */
export const SIDE_ROLE_LABELS: Readonly<Record<DebateSide, string>> = {
  A: "The Challenger",
  B: "The Advocate",
};
