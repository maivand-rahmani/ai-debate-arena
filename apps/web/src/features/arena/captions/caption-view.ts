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

const PHASE_LABEL: Readonly<Record<SpeechPhase, string>> = {
  OPENING_A: "Round 1 · Opening",
  OPENING_B: "Round 1 · Opening",
  REBUTTAL_A: "Round 2 · Rebuttal",
  REBUTTAL_B: "Round 2 · Rebuttal",
  // The reducer narrows `SpeechPhase` to the four agent phases; the
  // extra `JUDGING` entry here exists only to satisfy the type system
  // (it is never looked up by the runtime because `isAgentPhase`
  // gates the lookup at runtime).
  JUDGING: "Judge",
};

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
  if (panel.phase === "OPENING_A") return 0;
  if (panel.phase === "OPENING_B") return 1;
  if (panel.phase === "REBUTTAL_A") return 2;
  if (panel.phase === "REBUTTAL_B") return 3;
  return 4;
}

function lastPanel(state: DebateRuntimeState): SpeechPanel | null {
  if (state.panels.length === 0) return null;
  const sorted = [...state.panels].sort((a, b) => panelOrder(a) - panelOrder(b));
  return sorted[sorted.length - 1] ?? null;
}

export function deriveCaptionView(state: DebateRuntimeState): CaptionView {
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
        phaseLabel: PHASE_LABEL[phase],
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
        phaseLabel: PHASE_LABEL[last.phase],
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
      phaseLabel: last ? PHASE_LABEL[last.phase] : "Verdict",
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
        phaseLabel: PHASE_LABEL[last.phase],
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
        phaseLabel: PHASE_LABEL[last.phase],
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
  return (
    phase === "OPENING_A" ||
    phase === "OPENING_B" ||
    phase === "REBUTTAL_A" ||
    phase === "REBUTTAL_B"
  );
}
