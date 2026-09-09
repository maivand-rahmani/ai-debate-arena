/**
 * Client-side reducer for the debate streaming UI.
 *
 * The reducer is intentionally narrow: it mirrors the server event order
 * (phase → tokens → turn → judge-start → verdict → done) so each event
 * produces a deterministic state mutation without timers or mocks.
 *
 * Terminal states follow a strict precedence: `error` wins over `cancelled`,
 * and `finished` (a real verdict) wins over `cancelled`. Cancellation only
 * sticks when the match ended cleanly from the user's side; we never want to
 * hide a provider failure or fabricate a draw.
 */

import type { DebateSide } from "@arena/debate-engine";
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

export type DebateRuntimeStatus =
  | "idle"
  | "starting"
  | "streaming"
  | "judging"
  | "finished"
  | "error"
  | "cancelled";

export interface DebateRuntimeState {
  readonly status: DebateRuntimeStatus;
  readonly topic?: string;
  readonly mode: "quick";
  readonly currentPhase: DebateStreamPhase;
  readonly currentSide: DebateSide | null;
  readonly judgeActive: boolean;
  readonly judgeReasoning: string;
  readonly panels: readonly SpeechPanel[];
  readonly verdict?: DebateStreamVerdict;
  readonly errorMessage?: string;
  /**
   * Server-assigned id for the live match (v1 stream envelope). Captured
   * lazily from the first enveloped event so the judge-panel footer can
   * issue per-match actions (Export / Re-judge) without re-fetching.
   */
  readonly matchId?: string;
  /**
   * ISO timestamp from the most recent successful re-judge for the live
   * match, or `undefined` for the original verdict. Drives the
   * "re-judged" indicator on the current judge panel.
   */
  readonly judgedAt?: string;
  /**
   * Set when the user ended the match via the UI before a verdict arrived.
   * Preserves the in-flight panels/topic so the cancelled screen can show
   * what had been streamed so far.
   */
  readonly cancelled: boolean;
}

export const initialRuntimeState: DebateRuntimeState = {
  status: "idle",
  mode: "quick",
  currentPhase: "CREATED",
  currentSide: null,
  judgeActive: false,
  judgeReasoning: "",
  panels: [],
  matchId: undefined,
  judgedAt: undefined,
  cancelled: false,
};

// --- Actions ----------------------------------------------------------------

export type DebateRuntimeAction =
  | { readonly type: "start"; readonly topic: string }
  | { readonly type: "stream-event"; readonly event: DebateStreamEvent }
  | { readonly type: "stream-error"; readonly message: string }
  /** Internal silent cleanup — does not surface a cancelled screen. */
  | { readonly type: "abort" }
  /** User-initiated stop — drives the calm cancelled presentation. */
  | { readonly type: "cancel" }
  /** Re-judge for the live match completed successfully; replace verdict. */
  | { readonly type: "rejudge-success"; readonly verdict: DebateStreamVerdict; readonly judgedAt: string }
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
      return { ...state, status: "error", cancelled: false, errorMessage: action.message };
    case "cancel":
      return applyCancel(state);
    case "abort":
      // Silent cleanup (e.g. on unmount); never surfaces cancelled to the UI.
      return { ...state, status: "idle", cancelled: false, errorMessage: undefined };
    case "rejudge-success":
      return applyRejudgeSuccess(state, action);
    case "reset":
      return initialRuntimeState;
    default:
      return state;
  }
}

function applyCancel(state: DebateRuntimeState): DebateRuntimeState {
  // Error beats cancelled: never let a successful user stop hide a real
  // failure that the server reported.
  if (state.status === "error") return state;
  // A real verdict beats cancelled: if the judge already decided, show the
  // verdict, not the "ended before verdict" screen.
  if (state.status === "finished" || state.verdict) return state;
  // Already cancelled: keep it idempotent (e.g. abort fires twice).
  if (state.cancelled) return state;
  return {
    ...state,
    status: "cancelled",
    cancelled: true,
    judgeActive: false,
    currentSide: null,
  };
}

function applyStreamEvent(state: DebateRuntimeState, event: DebateStreamEvent): DebateRuntimeState {
  // Lazily capture the v1-envelope matchId so the judge-panel footer can
  // reach back into the saved record without an extra round-trip. We only
  // capture the first id we see; later events carry the same id.
  const withMatchId = captureMatchId(state, event);
  switch (event.type) {
    case "phase":
      return {
        ...withMatchId,
        status: isAgentPhase(event.phase) ? "streaming" : event.phase === "JUDGING" ? "judging" : withMatchId.status,
        currentPhase: event.phase,
        currentSide: event.side,
      };
    case "token":
      return appendToken(withMatchId, event.side, event.text, deriveSpeechPhase(withMatchId.currentPhase));
    case "turn":
      return sealTurn(withMatchId, event.turn);
    case "judge-start":
      return {
        ...withMatchId,
        status: "judging",
        judgeActive: true,
        judgeReasoning: "",
        cancelled: false,
        currentPhase: "JUDGING",
        currentSide: null,
      };
    case "verdict":
      return {
        ...withMatchId,
        status: "finished",
        verdict: event.verdict,
        judgeActive: false,
        cancelled: false,
        currentPhase: "FINISHED",
        currentSide: null,
      };
    case "error":
      return { ...withMatchId, status: "error", cancelled: false, errorMessage: event.message };
    case "done":
      if (withMatchId.status === "finished") return withMatchId;
      // A judge/server failure must survive `done`: never overwrite an error
      // with a graceful finish, otherwise the UI would render a fake verdict.
      if (withMatchId.status === "error") return withMatchId;
      // Cancellation must also survive `done`: if the user stopped the match
      // we should not flip back to a (potentially fabricated) finished state.
      if (withMatchId.cancelled || withMatchId.status === "cancelled") return withMatchId;
      if (withMatchId.verdict) {
        return { ...withMatchId, status: "finished", currentPhase: "FINISHED", currentSide: null };
      }
      // Server said done but produced no verdict and no error — surface a safe
      // error instead of a finish so callers cannot fabricate a draw.
      return {
        ...withMatchId,
        status: "error",
        cancelled: false,
        errorMessage: withMatchId.errorMessage ?? "Match ended without a verdict",
        judgeActive: false,
        currentSide: null,
      };
    default:
      return withMatchId;
  }
}

function captureMatchId(state: DebateRuntimeState, event: DebateStreamEvent): DebateRuntimeState {
  if (state.matchId) return state;
  const id = event.matchId;
  if (typeof id === "string" && id.length > 0) {
    return { ...state, matchId: id };
  }
  return state;
}

function applyRejudgeSuccess(
  state: DebateRuntimeState,
  action: Extract<DebateRuntimeAction, { type: "rejudge-success" }>,
): DebateRuntimeState {
  // The live panel always carries the latest verdict once the user has asked
  // for a re-judge. Cancellation/error precedence is preserved: a real error
  // already on screen wins over a stale verdict; an existing verdict still
  // wins over a later cancelled status (which shouldn't happen mid-rejudge).
  if (state.status === "error") return state;
  return {
    ...state,
    status: "finished",
    verdict: action.verdict,
    judgedAt: action.judgedAt,
    judgeActive: false,
    cancelled: false,
    currentPhase: "FINISHED",
    currentSide: null,
    errorMessage: undefined,
  };
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
    case "cancelled":
      return "Match ended before a verdict.";
    case "error":
      return state.errorMessage ?? "Something went wrong.";
    default:
      return "";
  }
}

/** True when the runtime is in a "match in progress" view (not a terminal screen). */
export function isInMatch(state: DebateRuntimeState): boolean {
  return (
    state.status === "starting" ||
    state.status === "streaming" ||
    state.status === "judging" ||
    state.status === "finished" ||
    state.status === "cancelled" ||
    state.status === "error"
  );
}

/** How far the match progressed before it stopped — used by the cancelled screen. */
export function lastReachedPhase(state: DebateRuntimeState): DebateStreamPhase {
  return state.currentPhase;
}

