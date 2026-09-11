/**
 * Pure projection of the debate runtime state into a single
 * "what-to-show-in-the-caption" view.
 *
 * The owner directive: the live text becomes the star. So the caption
 * surface carries ONE stream at a time, not two side-by-side rails.
 * When a speaker is mid-turn, we show their name + phase chip + the
 * streaming text + blinking caret. When the run is between turns
 * (judging, verdict reveal, cancelled, error), we show the relevant
 * status with the last completed line still readable. When the run
 * hasn't started, the caption is hidden entirely.
 */

import type { DebateSide } from "@arena/debate-engine";
import { findMatchTurn } from "@arena/types";
import type {
  DebateRuntimeState,
  SpeechPanel,
  SpeechPhase,
} from "@/features/run-debate/lib/reducer";

export type CaptionTone = "coral" | "violet" | "honey" | "neutral";

export type CaptionKind =
  | { readonly kind: "speaker"; readonly side: DebateSide; readonly phase: SpeechPhase; readonly sealed: boolean }
  | { readonly kind: "judge-evaluating" }
  | { readonly kind: "verdict" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error"; readonly message: string };

export interface CaptionView {
  /** What to render. `null` when nothing should be shown (idle + no content yet). */
  readonly kind: CaptionKind | null;
  /** Speaker label for the current/last line. */
  readonly speakerLabel: string;
  /** Round + phase label (e.g. "Round 1 · Opening"). */
  readonly phaseLabel: string;
  /** Text body — streamed or sealed. */
  readonly text: string;
  /** Tone drives chip + accent colour. */
  readonly tone: CaptionTone;
  /** True when the speaker is mid-turn and a caret should render. */
  readonly isLive: boolean;
  /** True when the speech surface should be visible at all. */
  readonly visible: boolean;
}

const SPEAKER_LABEL: Readonly<Record<DebateSide, string>> = {
  A: "The Challenger",
  B: "The Advocate",
};

/**
 * Sort panels in the natural debate order: openings before rebuttals,
 * A before B within a round. Used so the "last line" pick is the
 * most recent thing the audience just heard.
 */
function panelOrder(panel: SpeechPanel): number {
  return findMatchTurn("quick", panel.phase)?.order ?? Number.MAX_SAFE_INTEGER;
}

function phaseLabel(phase: SpeechPhase): string {
  const legacy: Readonly<Record<string, string>> = {
    OPENING_A: "Round 1 · Opening",
    OPENING_B: "Round 1 · Opening",
    REBUTTAL_A: "Round 2 · Rebuttal",
    REBUTTAL_B: "Round 2 · Rebuttal",
  };
  if (legacy[phase]) return legacy[phase];
  const turn = findMatchTurn("quick", phase);
  if (!turn) return phase;
  return `Turn ${turn.order} · ${turn.role === "opening" ? "Opening" : "Response"}`;
}

function lastPanel(state: DebateRuntimeState): SpeechPanel | null {
  if (state.panels.length === 0) return null;
  const sorted = [...state.panels].sort((a, b) => panelOrder(a) - panelOrder(b));
  return sorted[sorted.length - 1] ?? null;
}

export function deriveCaptionView(state: DebateRuntimeState, focusedPanel?: SpeechPanel | null): CaptionView {
  // A viewer-selected sealed turn takes precedence over the network's current
  // phase. The engine still streams ahead; only the presentation is held.
  if (focusedPanel) {
    const isCurrent =
      state.status === "streaming" &&
      state.currentSide === focusedPanel.side &&
      state.currentPhase === focusedPanel.phase;
    return {
      kind: { kind: "speaker", side: focusedPanel.side, phase: focusedPanel.phase, sealed: focusedPanel.sealed },
      speakerLabel: SPEAKER_LABEL[focusedPanel.side],
      phaseLabel: phaseLabel(focusedPanel.phase),
      text: focusedPanel.content,
      tone: focusedPanel.side === "A" ? "coral" : "violet",
      isLive: isCurrent && !focusedPanel.sealed,
      visible: true,
    };
  }

  // ---- Live streaming: show the active panel for whichever side the
  //      server is currently streaming. If tokens have started but the
  //      sealed `turn` event hasn't arrived, we still surface the
  //      half-streamed content.
  if (state.status === "streaming" && state.currentSide) {
    const phase = isAgentPhase(state.currentPhase) ? state.currentPhase : null;
    if (phase) {
      const id = `${state.currentSide}:${phase}`;
      const panel = state.panels.find((entry) => entry.id === id);
      return {
        kind: { kind: "speaker", side: state.currentSide, phase, sealed: panel?.sealed === true },
        speakerLabel: SPEAKER_LABEL[state.currentSide],
        phaseLabel: phaseLabel(phase),
        text: panel?.content ?? "",
        tone: state.currentSide === "A" ? "coral" : "violet",
        isLive: panel?.sealed !== true,
        visible: true,
      };
    }
  }

  // ---- Judge evaluating: the judge gets the same surface, with the
  //      last sealed line still readable underneath the status.
  if (state.status === "judging" || (state.judgeActive && state.status !== "finished")) {
    const last = lastPanel(state);
    if (last) {
      return {
        kind: { kind: "judge-evaluating" },
        speakerLabel: SPEAKER_LABEL[last.side],
        phaseLabel: phaseLabel(last.phase),
        text: last.content,
        tone: last.side === "A" ? "coral" : "violet",
        isLive: false,
        visible: true,
      };
    }
    return {
      kind: { kind: "judge-evaluating" },
      speakerLabel: "The Judge",
      phaseLabel: "Final word",
      text: "Listening to the closing arguments…",
      tone: "honey",
      isLive: false,
      visible: true,
    };
  }

  // ---- Verdict: show the judge's reasoning (when present) using the
  //      same caption treatment so the user doesn't see two
  //      completely different surfaces.
  if (state.status === "finished" && state.verdict) {
    const reasoning = state.verdict.reasoning?.trim() ?? "";
    if (reasoning.length > 0) {
      return {
        kind: { kind: "verdict" },
        speakerLabel: "The Judge",
        phaseLabel: "Reasoning",
        text: reasoning,
        tone: "honey",
        isLive: false,
        visible: true,
      };
    }
    const last = lastPanel(state);
    return {
      kind: { kind: "verdict" },
      speakerLabel: last ? SPEAKER_LABEL[last.side] : "The Judge",
      phaseLabel: last ? phaseLabel(last.phase) : "Verdict",
      text: last?.content ?? "The judge has reached a verdict.",
      tone: "honey",
      isLive: false,
      visible: true,
    };
  }

  // ---- Cancelled: keep the last line readable so the user knows what
  //      was last said.
  if (state.status === "cancelled") {
    const last = lastPanel(state);
    if (last) {
      return {
        kind: { kind: "cancelled" },
        speakerLabel: SPEAKER_LABEL[last.side],
        phaseLabel: phaseLabel(last.phase),
        text: last.content,
        tone: last.side === "A" ? "coral" : "violet",
        isLive: false,
        visible: true,
      };
    }
    return {
      kind: { kind: "cancelled" },
      speakerLabel: "Match ended",
      phaseLabel: "—",
      text: state.errorMessage ?? "The match ended before a verdict.",
      tone: "neutral",
      isLive: false,
      visible: true,
    };
  }

  // ---- Error: surface the error message through the caption so the
  //      modal verdict panel doesn't have to be the only place errors
  //      show up.
  if (state.status === "error") {
    const last = lastPanel(state);
    if (last) {
      return {
        kind: { kind: "error", message: state.errorMessage ?? "Something went wrong." },
        speakerLabel: SPEAKER_LABEL[last.side],
        phaseLabel: phaseLabel(last.phase),
        text: last.content,
        tone: "coral",
        isLive: false,
        visible: true,
      };
    }
    return {
      kind: { kind: "error", message: state.errorMessage ?? "Something went wrong." },
      speakerLabel: "Match error",
      phaseLabel: "—",
      text: state.errorMessage ?? "Something went wrong.",
      tone: "neutral",
      isLive: false,
      visible: true,
    };
  }

  return {
    kind: null,
    speakerLabel: "",
    phaseLabel: "",
    text: "",
    tone: "neutral",
    isLive: false,
    visible: false,
  };
}

function isAgentPhase(phase: DebateRuntimeState["currentPhase"]): phase is SpeechPhase {
  return findMatchTurn("quick", phase) !== undefined;
}
