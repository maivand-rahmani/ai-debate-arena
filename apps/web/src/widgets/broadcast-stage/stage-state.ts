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
 * - `activeSide` is whichever contender the server currently says is speaking
 * - per-element activity flags (`sideAActivity`, `sideBActivity`, `judgeActivity`)
 *   let each desk light up independently of the other
 * - `moods` + `reaction` come from sibling pure projections and are forwarded
 *   here as additional data-attributes for the CSS to consume.
 */

import type { DebateSide } from "@arena/debate-engine";
import type { DebateRuntimeState, DebateRuntimeStatus } from "@/features/run-debate/lib/reducer";
import { deriveMoods, type MoodView } from "./mood";
import { deriveReaction, type ReactionView } from "./reaction";

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
}

/** The broadcast controls stay live only while the match can still advance. */
export function isBroadcastLiveStatus(status: DebateRuntimeStatus): boolean {
  return status === "starting" || status === "streaming" || status === "judging";
}

/** A caption surface belongs only to an active stream. Errors get one terminal panel. */
export function shouldShowLiveCaptionStatus(status: DebateRuntimeStatus): boolean {
  return status === "streaming";
}

export function deriveStageView(state: DebateRuntimeState): StageView {
  const mode = computeMode(state);
  const camera = computeCamera(state, mode);
  const round = computeRound(state);
  const activeSide = computeActiveSide(state, mode);
  const stageLabel = computeStageLabel(state, mode, round);
  const moods = deriveMoods(state);
  const reaction = deriveReaction(state);

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
  };
}

function computeMode(state: DebateRuntimeState): StageMode {
  switch (state.status) {
    case "cancelled":
      return "cancelled";
    case "error":
      return "error";
    case "finished":
      return "verdict";
    case "judging":
      return "judging";
    case "streaming":
      return "speaking";
    case "starting":
    case "idle":
    default:
      return "idle";
  }
}

function computeCamera(state: DebateRuntimeState, mode: StageMode): StageCamera {
  if (mode === "verdict") return "verdict";
  if (mode === "judging") return "judge";
  if (mode === "speaking") {
    if (state.currentPhase === "REBUTTAL_A" || state.currentPhase === "REBUTTAL_B") {
      return "rebuttal";
    }
    if (state.currentSide === "A") return "a";
    if (state.currentSide === "B") return "b";
  }
  return "idle";
}

function computeRound(state: DebateRuntimeState): StageRound {
  const phase = state.currentPhase;
  if (phase === "OPENING_A" || phase === "OPENING_B") return "1";
  if (phase === "REBUTTAL_A" || phase === "REBUTTAL_B") return "2";
  return "none";
}

function computeActiveSide(state: DebateRuntimeState, mode: StageMode): DebateSide | null {
  if (mode !== "speaking") return null;
  return state.currentSide;
}

function computeStageLabel(
  state: DebateRuntimeState,
  mode: StageMode,
  round: StageRound,
): string {
  if (mode === "cancelled") return "Match ended";
  if (mode === "error") return state.errorMessage ?? "Match error";
  if (mode === "judging") return "Judge is evaluating";
  if (mode === "verdict") return state.verdict ? "Verdict reached" : "Match complete";
  if (mode === "speaking") {
    const side = state.currentSide;
    const roundNumber = round === "2" ? "2" : "1";
    const roundWord = round === "2" ? "Rebuttal" : "Opening";
    if (side === "A") return `Agent A · Round ${roundNumber} · ${roundWord}`;
    if (side === "B") return `Agent B · Round ${roundNumber} · ${roundWord}`;
  }
  return "Ready";
}

