/**
 * Pure mapping from runtime state to per-mascot mood.
 *
 * Mood is derived deterministically from existing state — no AI call. The
 * reducer / hook lifecycle is unchanged: mood is a presentation concern, so
 * the widget asks `deriveMoods` for an immutable snapshot and renders it as
 * the `data-mood-a` / `data-mood-b` / `data-mood-judge` data attributes.
 *
 * The mapping is intentionally narrow:
 *   - A/B moods: thinking | speaking | listening | confident | heated |
 *                 confused | impressed | victorious | defeated | panicking
 *   - Judge moods: standing-by | evaluating | revealed | impressed |
 *                   not-impressed | stoic | dismayed
 */

import type { DebateRuntimeState, SpeechPanel } from "@/features/run-debate/lib/reducer";

export type ContenderMood =
  | "thinking"
  | "speaking"
  | "listening"
  | "confident"
  | "heated"
  | "confused"
  | "impressed"
  | "victorious"
  | "defeated"
  | "panicking";

export type JudgeMood =
  | "standing-by"
  | "evaluating"
  | "revealed"
  | "impressed"
  | "not-impressed"
  | "stoic"
  | "dismayed";

export interface MoodView {
  readonly a: ContenderMood;
  readonly b: ContenderMood;
  readonly judge: JudgeMood;
}

const IDLE_MOOD_A: ContenderMood = "thinking";
const IDLE_MOOD_B: ContenderMood = "thinking";
const IDLE_JUDGE: JudgeMood = "standing-by";

const VERDICT_DRAW: ContenderMood = "confused";

/**
 * Compute the active side's latest speech panel so we can derive a more
 * specific mood (e.g. long streaming token bursts → heated / panicking).
 */
function latestPanel(panels: readonly SpeechPanel[], side: "A" | "B"): SpeechPanel | undefined {
  let latest: SpeechPanel | undefined;
  for (const panel of panels) {
    if (panel.side !== side) continue;
    if (!latest || panel.phase >= latest.phase) latest = panel;
  }
  return latest;
}

export function deriveMoods(state: DebateRuntimeState): MoodView {
  // Terminal / non-speaking states first — they win over per-turn heuristics.
  if (state.status === "error") {
    return {
      a: "panicking",
      b: "panicking",
      judge: "dismayed",
    };
  }

  if (state.status === "cancelled") {
    return {
      a: "defeated",
      b: "defeated",
      judge: "stoic",
    };
  }

  if (state.status === "judging") {
    return {
      a: "listening",
      b: "listening",
      judge: state.judgeActive ? "evaluating" : "standing-by",
    };
  }

  if (state.status === "finished") {
    const verdict = state.verdict;
    if (!verdict) {
      return { a: IDLE_MOOD_A, b: IDLE_MOOD_B, judge: "standing-by" };
    }
    return {
      a: verdictMoodForSide(verdict.winner, "A"),
      b: verdictMoodForSide(verdict.winner, "B"),
      judge: judgeVerdictMood(verdict),
    };
  }

  // Streaming / starting / idle — fall through to per-side heuristics.
  // (All other statuses were handled in the early-return block above.)
  const side = state.currentSide;
  const a = streamingMoodForSide(state, "A", side);
  const b = streamingMoodForSide(state, "B", side);
  const judge = IDLE_JUDGE;
  return { a, b, judge };
}

function verdictMoodForSide(
  winner: "A" | "B" | "DRAW",
  side: "A" | "B",
): ContenderMood {
  if (winner === "DRAW") return VERDICT_DRAW;
  if (winner === side) return "victorious";
  return "defeated";
}

function judgeVerdictMood(verdict: NonNullable<unknown>): JudgeMood {
  // Margin-aware judge mood: a close verdict = impressed; a lopsided verdict
  // = stoic / not-impressed. Anything broken-looking = dismayed.
  const scoreA = typeof (verdict as { scoreA?: unknown }).scoreA === "number"
    ? (verdict as { scoreA: number }).scoreA
    : 50;
  const scoreB = typeof (verdict as { scoreB?: unknown }).scoreB === "number"
    ? (verdict as { scoreB: number }).scoreB
    : 50;
  const margin = Math.abs(scoreA - scoreB);
  if (margin <= 4) return "impressed";
  if (margin >= 25) return "not-impressed";
  return "stoic";
}

function streamingMoodForSide(
  state: DebateRuntimeState,
  side: "A" | "B",
  activeSide: DebateRuntimeState["currentSide"],
): ContenderMood {
  if (state.status === "idle" || state.status === "starting") {
    return IDLE_MOOD_A; // same for both sides — both are waiting
  }

  // Terminal statuses (error / cancelled / finished) are handled in
  // `deriveMoods` itself; by the time we reach here the runtime is either
  // `streaming` or `judging` (the latter still has `activeSide === null`).
  if (state.status === "judging") return "listening";

  const isActive = activeSide === side;
  const panel = latestPanel(state.panels, side);

  if (!isActive) {
    return "listening";
  }

  // Active side during streaming — default to "speaking" until the panel
  // exists. A panel with very short content flips to "thinking" so the
  // mascot reads as still warming up. Longer content escalates mood.
  if (!panel) return "speaking";
  if (panel.sealed) return "confident";

  const length = panel.content.length;
  if (length === 0) return "thinking";
  if (length < 20) return "thinking";
  if (length < 200) return "speaking";
  if (length < 500) return "confident";
  if (length < 1500) return "heated";
  return "panicking";
}
