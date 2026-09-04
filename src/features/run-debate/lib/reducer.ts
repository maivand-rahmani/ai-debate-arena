/**
 * Client-side reducer for the debate streaming UI.
 *
 * The reducer is intentionally narrow: it mirrors the server event order
 * (phase → tokens → turn → judge-start → verdict → done) so each event
 * produces a deterministic state mutation without timers or mocks.
 */

import type { DebateSide } from "@/entities/debate";
import type {
  DebateStreamEvent,
  DebateStreamPhase,
  DebateStreamTurn,
  DebateStreamVerdict,
} from "@/shared/api/debate-stream";

// --- Public types -----------------------------------------------------------

export interface SpeechPanel {
  /** Stable identifier: `side:phase` (e.g. `A:OPENING_A`). */
  readonly id: string;
  readonly side: DebateSide;
  readonly phase: SpeechPhase;
  /** Streaming content; replaced with the canonical turn content on `turn`. */
  readonly content: string;
  /** True once a `turn` event has sealed this panel. */
  readonly sealed: boolean;
  readonly model?: string;
}

export type SpeechPhase = Exclude<DebateStreamPhase, "CREATED" | "FINISHED">;

export interface DebateRuntimeState {
  readonly status: "idle" | "starting" | "streaming" | "judging" | "finished" | "error";
  readonly topic?: string;
  readonly mode: "quick";
  readonly currentPhase: DebateStreamPhase;
  readonly currentSide: DebateSide | null;
  readonly judgeActive: boolean;
  readonly judgeReasoning: string;
  readonly panels: readonly SpeechPanel[];
  readonly verdict?: DebateStreamVerdict;
  readonly errorMessage?: string;
}

export const initialRuntimeState: DebateRuntimeState = {
  status: "idle",
  mode: "quick",
  currentPhase: "CREATED",
  currentSide: null,
  judgeActive: false,
  judgeReasoning: "",
  panels: [],
};

// --- Actions ----------------------------------------------------------------

export type DebateRuntimeAction =
  | { readonly type: "start"; readonly topic: string }
  | { readonly type: "stream-event"; readonly event: DebateStreamEvent }
  | { readonly type: "stream-error"; readonly message: string }
  | { readonly type: "abort" }
  | { readonly type: "reset" };

// --- Reducer ----------------------------------------------------------------

export function reduceDebateRuntime(
  state: DebateRuntimeState,
  action: DebateRuntimeAction,
): DebateRuntimeState {
  switch (action.type) {
    case "start":
      return {
        ...initialRuntimeState,
        status: "starting",
        topic: action.topic,
      };
    case "stream-event":
      return applyStreamEvent(state, action.event);
    case "stream-error":
      return { ...state, status: "error", errorMessage: action.message };
    case "abort":
      return { ...state, status: "idle", errorMessage: undefined };
    case "reset":
      return initialRuntimeState;
    default:
      return state;
  }
}

function applyStreamEvent(state: DebateRuntimeState, event: DebateStreamEvent): DebateRuntimeState {
  switch (event.type) {
    case "phase":
      return {
        ...state,
        status: isAgentPhase(event.phase) ? "streaming" : event.phase === "JUDGING" ? "judging" : state.status,
        currentPhase: event.phase,
        currentSide: event.side,
      };
    case "token":
      return appendToken(state, event.side, event.text, deriveSpeechPhase(state.currentPhase));
    case "turn":
      return sealTurn(state, event.turn);
    case "judge-start":
      return {
        ...state,
        status: "judging",
        judgeActive: true,
        judgeReasoning: "",
        currentPhase: "JUDGING",
        currentSide: null,
      };
    case "verdict":
      return {
        ...state,
        status: "finished",
        verdict: event.verdict,
        judgeActive: false,
        currentPhase: "FINISHED",
        currentSide: null,
      };
    case "error":
      return { ...state, status: "error", errorMessage: event.message };
    case "done":
      if (state.status === "finished") return state;
      // A judge/server failure must survive `done`: never overwrite an error
      // with a graceful finish, otherwise the UI would render a fake verdict.
      if (state.status === "error") return state;
      if (state.verdict) {
        return { ...state, status: "finished", currentPhase: "FINISHED", currentSide: null };
      }
      // Server said done but produced no verdict and no error — surface a safe
      // error instead of a finish so callers cannot fabricate a draw.
      return {
        ...state,
        status: "error",
        errorMessage: state.errorMessage ?? "Match ended without a verdict",
        judgeActive: false,
        currentSide: null,
      };
    default:
      return state;
  }
}

function appendToken(
  state: DebateRuntimeState,
  side: DebateSide,
  text: string,
  phase: SpeechPhase | null,
): DebateRuntimeState {
  if (!phase) return state;
  const id = panelId(side, phase);
  const existing = state.panels.find((panel) => panel.id === id);
  if (existing) {
    return {
      ...state,
      panels: state.panels.map((panel) => (panel.id === id ? { ...panel, content: panel.content + text } : panel)),
    };
  }
  const panel: SpeechPanel = { id, side, phase, content: text, sealed: false };
  return { ...state, panels: [...state.panels, panel] };
}

function sealTurn(state: DebateRuntimeState, turn: DebateStreamTurn): DebateRuntimeState {
  const id = panelId(turn.side, turn.phase);
  const existing = state.panels.find((panel) => panel.id === id);
  const next: SpeechPanel = {
    id,
    side: turn.side,
    phase: turn.phase,
    content: turn.content,
    sealed: true,
    model: turn.model ?? existing?.model,
  };
  if (existing) {
    return {
      ...state,
      panels: state.panels.map((panel) => (panel.id === id ? next : panel)),
    };
  }
  return { ...state, panels: [...state.panels, next] };
}

function isAgentPhase(phase: DebateStreamPhase): boolean {
  return phase === "OPENING_A" || phase === "OPENING_B" || phase === "REBUTTAL_A" || phase === "REBUTTAL_B";
}

function deriveSpeechPhase(phase: DebateStreamPhase): SpeechPhase | null {
  if (phase === "OPENING_A" || phase === "OPENING_B" || phase === "REBUTTAL_A" || phase === "REBUTTAL_B") {
    return phase;
  }
  return null;
}

export function panelId(side: DebateSide, phase: SpeechPhase): string {
  return `${side}:${phase}`;
}

// --- Display helpers --------------------------------------------------------

export interface PhaseRound {
  readonly key: SpeechPhase;
  readonly label: string;
  readonly side: DebateSide;
  readonly round: 1 | 2;
  readonly stage: "opening" | "rebuttal";
}

export const PHASE_ROUNDS: readonly PhaseRound[] = [
  { key: "OPENING_A", label: "Opening A", side: "A", round: 1, stage: "opening" },
  { key: "OPENING_B", label: "Opening B", side: "B", round: 1, stage: "opening" },
  { key: "REBUTTAL_A", label: "Rebuttal A", side: "A", round: 2, stage: "rebuttal" },
  { key: "REBUTTAL_B", label: "Rebuttal B", side: "B", round: 2, stage: "rebuttal" },
];

export function panelsForSide(state: DebateRuntimeState, side: DebateSide): readonly SpeechPanel[] {
  return state.panels.filter((panel) => panel.side === side);
}

export function currentSidePanel(state: DebateRuntimeState): SpeechPanel | null {
  if (!state.currentSide || !isAgentPhase(state.currentPhase)) return null;
  const id = panelId(state.currentSide, state.currentPhase as SpeechPhase);
  return state.panels.find((panel) => panel.id === id) ?? null;
}

export function statusLineFor(state: DebateRuntimeState): string {
  switch (state.status) {
    case "idle":
      return "Ready.";
    case "starting":
      return "Contacting the arena…";
    case "streaming": {
      const phase = isAgentPhase(state.currentPhase)
        ? PHASE_ROUNDS.find((round) => round.key === state.currentPhase)
        : undefined;
      const side = state.currentSide;
      if (phase && side) {
        return side === "A"
          ? `Agent A is speaking — Round ${phase.round} · ${phase.stage === "opening" ? "Opening" : "Rebuttal"}`
          : `Agent B is speaking — Round ${phase.round} · ${phase.stage === "opening" ? "Opening" : "Rebuttal"}`;
      }
      return "Streaming…";
    }
    case "judging":
      return state.judgeActive ? "Judge is evaluating…" : "Waiting for the judge…";
    case "finished":
      return state.verdict ? "Verdict reached." : "Match complete.";
    case "error":
      return state.errorMessage ?? "Something went wrong.";
    default:
      return "";
  }
}
