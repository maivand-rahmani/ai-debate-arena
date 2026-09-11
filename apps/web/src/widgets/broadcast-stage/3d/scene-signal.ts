/**
 * Pre-computed scene signal — the minimal projection of the debate runtime
 * state that the R3F scene tree needs to drive its directors (camera,
 * lighting, characters, confetti). Computed in `arena-frame.tsx` (a
 * `'use client'` component outside the 3d/ boundary) and forwarded via
 * {@link CanvasGate.canvasProps} so the canvas client receives a serializable
 * POJO without ever pulling three imports into the server tree.
 *
 * Pure: no three, no React. The shape mirrors just what the canvas-side
 * directors consume — no state internals leak through.
 */

import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import type { MatchTurnSpec } from "@arena/types";
import type {
  ContenderMood,
  JudgeMood,
  MoodView,
} from "@/widgets/broadcast-stage/mood";
import {
  deriveStageView,
  type StageCamera,
  type StageMode,
  type StageView,
} from "@/widgets/broadcast-stage/stage-state";

export interface SceneSignal {
  readonly mode: StageMode;
  readonly camera: StageCamera;
  readonly moods: MoodView;
  readonly verdictWinner: "A" | "B" | "DRAW" | null;
  readonly verdictReasoning: string | undefined;
  readonly status: DebateRuntimeState["status"];
  readonly reducedMotion: boolean;
  /**
   * Monotonic identifier the canvas-side uses to detect verdict transitions
   * (camera + lighting + confetti only trigger on the NEW verdict landing,
   * not on every re-render of an already-landed verdict).
   */
  readonly verdictStamp: string | null;
  /** Bounded entry scroll, additive to the existing camera director. */
  readonly heroProgress: number;
  /** Format-owned turn metadata for camera/lighting directors. */
  readonly turn: MatchTurnSpec | null;
}

const INITIAL_VIEW: StageView = {
  mode: "idle",
  camera: "idle",
  round: "none",
  activeSide: null,
  stageLabel: "Ready",
  rootDataAttributes: {
    "data-stage": "idle",
    "data-camera": "idle",
    "data-round": "none",
    "data-active-side": "none",
    "data-mood-a": "thinking",
    "data-mood-b": "thinking",
    "data-mood-judge": "standing-by",
    "data-reaction": "none",
  },
  sideAActivity: "idle",
  sideBActivity: "idle",
  judgeActivity: "idle",
  moods: { a: "thinking", b: "thinking", judge: "standing-by" },
  reaction: null,
};

/**
 * Reduce the debate runtime state to the scene signal consumed by the
 * R3F canvas side. The derivation is pure — its only branches are the
 * well-typed enum cases that already exist on `DebateRuntimeState` —
 * so it stays safely importable from any client-only module without
 * re-running reducer-side effects.
 */
export function deriveSceneSignal(
  state: DebateRuntimeState,
  reducedMotion: boolean,
  heroProgress = 1,
): SceneSignal {
  let view: StageView;
  try {
    view = deriveStageView(state);
  } catch {
    view = INITIAL_VIEW;
  }
  const mode = view.mode;
  const camera = view.camera;
  const moods = view.moods;
  const verdict =
    state.status === "finished" && state.verdict
      ? (state.verdict as DebateStreamVerdict)
      : null;
  const verdictWinner = verdict ? verdict.winner : null;
  // Stamp gives the canvas a stable identifier per verdict. `matchId|winner|scoreA-scoreB`
  // changes exactly when a fresh verdict lands (or re-judge updates it).
  const verdictStamp = verdict
    ? `${state.matchId ?? "none"}|${verdict.winner}|${verdict.scoreA}-${verdict.scoreB}`
    : null;
  return {
    mode,
    camera,
    moods,
    verdictWinner,
    verdictReasoning: verdict?.reasoning,
    status: state.status,
    reducedMotion,
    verdictStamp,
    heroProgress: Math.max(0, Math.min(1, Number.isFinite(heroProgress) ? heroProgress : 1)),
    turn: view.currentTurn ?? null,
  };
}

/**
 * Re-exported for convenience — the canvas-side hooks read these types
 * directly. Keeping them anchored here keeps the boundary narrow.
 */
export type { ContenderMood, JudgeMood };
