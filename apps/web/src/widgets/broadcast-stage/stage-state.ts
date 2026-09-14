/**
 * Pure mapping from the debate runtime state to the visual stage view.
 *
 * The widget never inspects the runtime state directly — it asks
 * {@link deriveStageView} for a small, immutable snapshot and uses that to
 * drive CSS data-attributes (and a tiny bit of inline rendering). This keeps
 * the stage a presentation concern: it cannot mutate the reducer, invent a
 * winner, or fabricate a round number.
 *
 * The mapping is intentionally narrow:
 * - `mode` is the broad UI mode (idle | speaking | judging | verdict | cancelled | error)
 * - `camera` is the discrete camera framing (idle | a | b | rebuttal | judge | verdict)
 * - `round` is "1" for opening turns, "2" for rebuttal turns, "none" otherwise
 * - `activeSide` is whichever contender the viewer is currently presented with:
 *   the live streaming side by default, or the viewer-selected speech panel
 *   when one is focused (see {@link StageFocus})
 * - per-element activity flags (`sideAActivity`, `sideBActivity`, `judgeActivity`)
 *   let each desk light up independently of the other
 * - `moods` + `reaction` come from sibling pure projections and are forwarded
 *   here as additional data-attributes for the CSS to consume.
 *
 * Focus plumbing: `deriveStageView` accepts an optional viewer-selected speech
 * panel. While a panel is focused the presentation (camera, active side, round,
 * label, turn metadata) follows that panel's side. With no focused panel the
 * live current-side / judge / verdict behavior is unchanged.
 */

import type { DebateSide } from "@arena/debate-engine";
import { findMatchTurn, type MatchTurnSpec } from "@arena/types";
import type { DebateRuntimeState, DebateRuntimeStatus } from "@/features/run-debate/lib/reducer";
import { deriveMoods, type MoodView } from "./mood";
import { deriveReaction, type ReactionView } from "./reaction";

/**
 * Extra presentation routing owned by the viewer playback layer. When the
 * viewer has not yet reached the terminal frame, the stage must not reveal
 * winner-specific presentation even though the runtime may have finished
 * judging in the background.
 */
export interface StageViewOptions {
  /** Defaults to true so non-playback callers keep the verdict behavior. */
  readonly isTerminalFrame?: boolean;
}

export type StageMode =
  | "idle"
  | "speaking"
  | "judging"
  | "verdict"
  | "cancelled"
  | "error";

export type StageCamera =
  | "idle"
  | "a"
  | "b"
  | "rebuttal"
  | "judge"
  | "verdict";

export type StageRound = "1" | "2" | "none";

export type StageSideActivity = "active" | "idle";

/**
 * Viewer-selected speech panel. Structurally compatible with the reducer's
 * `SpeechPanel` (`id`, `side`, `phase`, `content`, `sealed`, `turn?`), so
 * `use-match-playback`'s `playback.focusedPanel` can be forwarded directly.
 *
 * When provided, presentation follows this panel instead of the live stream.
 */
export interface StageFocus {
  readonly side: DebateSide;
  readonly phase: string;
  readonly turn?: MatchTurnSpec;
}

export interface StageView {
  readonly mode: StageMode;
  readonly camera: StageCamera;
  readonly round: StageRound;
  readonly activeSide: DebateSide | null;
  readonly stageLabel: string;
  readonly rootDataAttributes: Readonly<Record<string, string>>;
  readonly sideAActivity: StageSideActivity;
  readonly sideBActivity: StageSideActivity;
  readonly judgeActivity: StageSideActivity;
  readonly moods: MoodView;
  readonly reaction: ReactionView | null;
  /** Format-owned metadata for the active speaking turn, when present. */
  readonly currentTurn?: MatchTurnSpec;
}

/** The broadcast controls stay live only while the match can still advance. */
export function isBroadcastLiveStatus(status: DebateRuntimeStatus): boolean {
  return status === "starting" || status === "streaming" || status === "judging";
}

/** A caption surface belongs only to an active stream. Errors get one terminal panel. */
export function shouldShowLiveCaptionStatus(status: DebateRuntimeStatus): boolean {
  return status === "streaming";
}

export function deriveStageView(
  state: DebateRuntimeState,
  focus: StageFocus | null = null,
  options: StageViewOptions = {},
): StageView {
  const isTerminalFrame = options.isTerminalFrame ?? true;
  const presented = resolveFocus(state, focus);
  const mode = computeMode(state, presented, isTerminalFrame);
  const currentTurn = presented
    ? presented.turn ?? findMatchTurn(state.mode, presented.phase)
    : findMatchTurn(state.mode, state.currentPhase);
  const camera = computeCamera(state, mode, presented);
  const round = computeRound(currentTurn);
  const activeSide = computeActiveSide(state, mode, presented);
  const stageLabel = computeStageLabel(state, mode, round, presented);
  const moods = deriveMoods(state, presented, isTerminalFrame);
  const reaction = deriveReaction(state, presented, isTerminalFrame);

  return {
    mode,
    camera,
    round,
    activeSide,
    stageLabel,
    rootDataAttributes: {
      "data-stage": mode,
      "data-camera": camera,
      "data-round": round,
      "data-active-side": activeSide ? activeSide.toLowerCase() : "none",
      "data-mood-a": moods.a,
      "data-mood-b": moods.b,
      "data-mood-judge": moods.judge,
      "data-reaction": reaction?.id ?? "none",
    },
    sideAActivity: activeSide === "A" ? "active" : "idle",
    sideBActivity: activeSide === "B" ? "active" : "idle",
    judgeActivity:
      mode === "judging" || mode === "verdict"
        ? "active"
        : "idle",
    moods,
    reaction,
    currentTurn,
  };
}

function computeMode(
  state: DebateRuntimeState,
  focus: StageFocus | null,
  isTerminalFrame: boolean,
): StageMode {
  switch (state.status) {
    case "cancelled":
      return "cancelled";
    case "error":
      return "error";
    case "finished":
      // A focused panel means the viewer is still reading a speech, so the
      // stage presents that speech instead of the verdict (the caption surface
      // already hides the judge/verdict while a panel is focused). If the
      // runtime finished but the viewer has not reached the terminal frame,
      // never present the verdict mode.
      return focus ? "speaking" : isTerminalFrame ? "verdict" : "judging";
    case "judging":
      return focus ? "speaking" : "judging";
    case "streaming":
      return "speaking";
    case "starting":
    case "idle":
    default:
      return "idle";
  }
}

function computeCamera(
  state: DebateRuntimeState,
  mode: StageMode,
  focus: StageFocus | null,
): StageCamera {
  if (mode === "verdict") return "verdict";
  if (mode === "judging") return "judge";
  if (mode === "speaking") {
    const phase = focus?.phase ?? state.currentPhase;
    const turn = focus?.turn ?? findMatchTurn(state.mode, phase);
    if (turn?.role === "response") {
      return "rebuttal";
    }
    const side = focus?.side ?? state.currentSide;
    if (side === "A") return "a";
    if (side === "B") return "b";
  }
  return "idle";
}

function computeRound(turn: MatchTurnSpec | undefined): StageRound {
  if (turn?.role === "opening") return "1";
  if (turn?.role === "response") return "2";
  return "none";
}

function computeActiveSide(
  state: DebateRuntimeState,
  mode: StageMode,
  focus: StageFocus | null,
): DebateSide | null {
  if (mode !== "speaking") return null;
  return focus?.side ?? state.currentSide;
}

function computeStageLabel(
  state: DebateRuntimeState,
  mode: StageMode,
  round: StageRound,
  focus: StageFocus | null,
): string {
  if (mode === "cancelled") return "Match ended";
  if (mode === "error") return state.errorMessage ?? "Match error";
  if (mode === "judging") return "Judge is evaluating";
  if (mode === "verdict") return state.verdict ? "Verdict reached" : "Match complete";
  if (mode === "speaking") {
    const side = focus?.side ?? state.currentSide;
    const roundNumber = round === "2" ? "2" : "1";
    const roundWord = round === "2" ? "Rebuttal" : "Opening";
    if (side === "A") return `Agent A · Round ${roundNumber} · ${roundWord}`;
    if (side === "B") return `Agent B · Round ${roundNumber} · ${roundWord}`;
  }
  return "Ready";
}

/**
 * A viewer-focused panel only wins over presentation for states the caption
 * surface can actually override. Terminal cancel/error screens keep their own
 * framing; otherwise (speaking, judging, finished) the focused panel is honored.
 */
function resolveFocus(state: DebateRuntimeState, focus: StageFocus | null): StageFocus | null {
  if (!focus) return null;
  if (state.status === "cancelled" || state.status === "error") return null;
  return focus;
}

