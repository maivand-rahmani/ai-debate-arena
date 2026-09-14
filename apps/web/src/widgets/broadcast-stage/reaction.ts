/**
 * Pure mapping from runtime state to a curated reaction sticker.
 *
 * Reactions are non-disruptive flavour: a small overlay that pops in for a
 * few seconds (driven by CSS animation) when the match state clearly fits
 * one of our curated copy lines. Mute and reduced-motion are honored at the
 * call site (`renderReaction`) — this module just decides which reaction,
 * if any, fits the state.
 *
 * The list (7 curated reactions):
 *   1. "Agent is cooking"      — long streaming turn (>= 400 chars)
 *   2. "Judge is not impressed"— lopsided finished verdict (margin >= 25)
 *   3. "Argument.exe stopped responding" — error
 *   4. "OBJECTION"             — rebuttal round
 *   5. "Technical timeout"     — cancelled
 *   6. "Agent is visibly panicking" — extremely long streaming turn
 *   7. "Verdict landed"        — finished
 */

import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { findMatchTurn, type DebateSide } from "@arena/types";

/** Minimal viewer-presented speech shape (structurally a `StageFocus`). */
export interface PresentedSpeech {
  readonly side: DebateSide;
}

export type ReactionId =
  | "cooking"
  | "judge-not-impressed"
  | "argument-stopped"
  | "objection"
  | "timeout"
  | "panicking"
  | "verdict-landed";

export type ReactionTone = "coral" | "violet" | "gold" | "warning";

export interface ReactionView {
  readonly id: ReactionId;
  readonly label: string;
  readonly tone: ReactionTone;
}

export const REACTIONS: Readonly<Record<ReactionId, ReactionView>> = {
  cooking:             { id: "cooking",            label: "Agent is cooking",            tone: "coral"  },
  panicking:           { id: "panicking",          label: "Agent is visibly panicking",  tone: "warning"},
  objection:           { id: "objection",          label: "OBJECTION",                   tone: "violet" },
  "judge-not-impressed": { id: "judge-not-impressed", label: "Judge is not impressed", tone: "gold"   },
  "argument-stopped":  { id: "argument-stopped",   label: "Argument.exe stopped responding", tone: "warning" },
  timeout:             { id: "timeout",            label: "Technical timeout",           tone: "warning"},
  "verdict-landed":    { id: "verdict-landed",     label: "Verdict landed",              tone: "gold"   },
};

const COOKING_LENGTH = 400;
const PANICKING_LENGTH = 1500;

/**
 * @param presented   Viewer-selected speech (when the audience is still
 *                    reading a speech rather than the terminal surface).
 * @param isTerminalFrame  False while the final speech is held. When false,
 *                    winner-specific verdict reactions stay hidden even if the
 *                    runtime already finished judging.
 */
export function deriveReaction(
  state: DebateRuntimeState,
  presented: PresentedSpeech | null = null,
  isTerminalFrame = true,
): ReactionView | null {
  // Priority order: terminal events first, then per-turn heuristics.
  if (state.status === "error") {
    return REACTIONS["argument-stopped"];
  }
  if (state.status === "cancelled") {
    return REACTIONS.timeout;
  }
  if (state.status === "finished") {
    // The verdict sticker is a winner-specific effect: hold it until the
    // viewer has advanced past the final speech to the terminal frame.
    if (presented !== null || !isTerminalFrame) return null;
    const verdict = state.verdict;
    if (!verdict) return null;
    const margin = Math.abs(verdict.scoreA - verdict.scoreB);
    if (margin >= 25) return REACTIONS["judge-not-impressed"];
    return REACTIONS["verdict-landed"];
  }
  if (state.status === "judging") {
    // Avoid stacking reactions on the judge-evaluating screen — the verdict
    // reveal already carries the climax.
    return null;
  }

  // Streaming / starting / idle — per-turn length-driven reactions.
  if (state.status === "streaming" && state.currentSide) {
    const side = state.currentSide;
    const activePanel = state.panels.find((panel) => panel.side === side);
    if (activePanel && !activePanel.sealed) {
      const len = activePanel.content.length;
      if (len >= PANICKING_LENGTH) return REACTIONS.panicking;
      if (len >= COOKING_LENGTH) return REACTIONS.cooking;
    }
    const turn = findMatchTurn(state.mode, state.currentPhase);
    if (turn?.role === "response") {
      return REACTIONS.objection;
    }
  }

  return null;
}
