"use client";

import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { CancelledPanel } from "@/features/run-debate/ui/cancelled-panel";
import { ErrorPanel } from "@/features/run-debate/ui/error-panel";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import type { RedactedProvider } from "@/shared/api/providers";
import { BroadcastBanner } from "./broadcast-banner";
import type { JudgePanelFooter } from "./verdict/verdict-reveal";
import { VerdictEvaluating } from "./verdict/verdict-reveal";
import { AgentDesk } from "./desks/agent-desk";
import { JudgePlinth } from "./desks/judge-plinth";
import { LiveCaption, VerdictCard } from "@/features/arena/captions";
import { MatchProgress } from "@/features/arena/match/match-progress";
import { PlaybackControls } from "@/features/arena/match/playback-controls";
import type { MatchPlayback } from "@/features/arena/match/use-match-playback";
import { StageBackdrop } from "./backdrop/stage-backdrop";
import { ReactionOverlay } from "./reactions/reaction-overlay";
import { deriveStageView, isBroadcastLiveStatus, shouldShowLiveCaptionStatus } from "./stage-state";

export type { JudgePanelFooter } from "./verdict/verdict-reveal";

export interface BroadcastStageProps {
  readonly topic: string;
  readonly state: DebateRuntimeState;
  readonly agentA?: RedactedProvider;
  readonly agentB?: RedactedProvider;
  readonly judgeProvider?: RedactedProvider;
  readonly judgeModel?: string;
  readonly draftSideAModel?: string;
  readonly draftSideBModel?: string;
  readonly draftSideAPosition?: "FOR" | "AGAINST";
  readonly draftSideBPosition?: "FOR" | "AGAINST";
  /** Footer forwarded to the verdict surface when the verdict is revealed. */
  readonly footer?: JudgePanelFooter;
  /** Optional handler for the "cancelled" terminal screen. */
  readonly onNewMatch?: () => void;
  readonly inMatch: boolean;
  readonly onEndMatch?: () => void;
  readonly onOpenHistory?: () => void;
  readonly reactionsMuted?: boolean;
  /** Spectator-controlled presentation; generation keeps running independently. */
  readonly playback?: MatchPlayback;
  /** Equal Standard resource limits chosen in setup, for the public HUD. */
  readonly standardLimits?: {
    readonly startingCredits?: number;
    readonly maxToolsPerMove?: number;
    readonly toolTimeoutMs?: number;
  };
}

/**
 * The v0.3 broadcast composition. The Arena is the first impression and the
 * main interface: broadcast banner + cyclorama backdrop, two contender
 * desks, a central Judge plinth, the bottom-center live caption + compact
 * status chip, and either a cancelled panel or a dramatic verdict reveal.
 * State comes only from {@link DebateRuntimeState}; the
 * {@link deriveStageView} pure mapping projects that state into
 * data-attributes that the CSS module uses to light up spotlights, shift
 * the camera, animate mascots, and pop reactions.
 *
 * Idle setup lives in the SetupModal (opened from the idle hero) — this
 * stage never renders a setup form. The hook / reducer / stream lifecycle
 * is untouched: this widget only changes presentation.
 */
export function BroadcastStage({
  topic,
  state,
  agentA,
  agentB,
  judgeProvider,
  judgeModel,
  draftSideAModel,
  draftSideBModel,
  draftSideAPosition,
  draftSideBPosition,
  footer,
  onNewMatch,
  onEndMatch,
  onOpenHistory,
  reactionsMuted = false,
  playback,
}: BroadcastStageProps) {
  const view = deriveStageView(state, playback?.focusedPanel ?? null);

  const showCancelled = state.status === "cancelled";
  const showError = state.status === "error";
  const viewerIsReadingSpeech = playback?.focusedPanel !== null && playback?.focusedPanel !== undefined;
  const showJudge = !viewerIsReadingSpeech && !playback?.holdTerminal && (state.status === "judging" || state.status === "finished");
  const showLiveCaption = shouldShowLiveCaptionStatus(state.status);
  const showPlaybackCaption = showLiveCaption || viewerIsReadingSpeech || playback?.holdTerminal;
  const broadcastLive = isBroadcastLiveStatus(state.status);
  const judgeState =
    state.status === "judging" ? "evaluating" : state.status === "finished" ? "revealed" : null;

  const verdict = state.verdict as DebateStreamVerdict | undefined;

  const monitorModelA = draftSideAModel ?? state.panels.find((p) => p.side === "A")?.model;
  const monitorModelB = draftSideBModel ?? state.panels.find((p) => p.side === "B")?.model;

  return (
    <section
      className="broadcast-stage"
      {...view.rootDataAttributes}
      aria-label="Live debate broadcast"
    >
      <StageBackdrop view={view} />

      <BroadcastBanner
        topic={topic}
        mode={state.mode}
        status={state.status}
        onEndMatch={broadcastLive ? onEndMatch : undefined}
        onOpenHistory={onOpenHistory}
      />

      <div className="broadcast-stage__composition">
        <div className="broadcast-stage__set" aria-hidden={showCancelled ? "true" : "false"}>
          <AgentDesk
            side="A"
            tone="coral"
            identity="Ember"
            position={draftSideAPosition ?? "FOR"}
            provider={agentA}
            model={monitorModelA}
            activity={view.sideAActivity}
            mood={view.moods.a}
            view={view}
            className="broadcast-stage__desk broadcast-stage__desk--a"
          />

          <div className="broadcast-stage__center">
            <JudgePlinth
              judgeProvider={judgeProvider}
              judgeModel={judgeModel}
              activity={view.judgeActivity}
              mood={view.moods.judge}
              view={view}
              className="broadcast-stage__plinth"
            />
          </div>

          <AgentDesk
            side="B"
            tone="violet"
            identity="Vesper"
            position={draftSideBPosition ?? "AGAINST"}
            provider={agentB}
            model={monitorModelB}
            activity={view.sideBActivity}
            mood={view.moods.b}
            view={view}
            className="broadcast-stage__desk broadcast-stage__desk--b"
          />
        </div>

        <ReactionOverlay
          reaction={state.status === "error" || state.status === "cancelled" ? null : view.reaction}
          muted={reactionsMuted}
          position="top-right"
        />
      </div>

      {/* The contender rails are owned by ArenaFrame, which omits them on the
          terminal frame so they can never cover the verdict surface. */}

      {broadcastLive ? (
        <div className="broadcast-stage__round--progress">
          <MatchProgress state={state} viewingPhase={playback?.focusedPanel?.phase} />
        </div>
      ) : null}

      {state.status === "streaming" && !playback?.focusedPanel && view.activeSide ? (
        <LiveMatchCallout side={view.activeSide} responseRole={view.currentTurn?.role} />
      ) : null}

      {showPlaybackCaption ? (
        <div className="broadcast-stage__caption">
          <LiveCaption state={state} focusedPanel={playback?.focusedPanel} />
          {playback ? <PlaybackControls state={state} playback={playback} /> : null}
        </div>
      ) : null}

      {showError ? (
        onNewMatch ? (
          <div className="broadcast-stage__caption">
            <ErrorPanel state={state} onNewMatch={onNewMatch} />
          </div>
        ) : null
      ) : showCancelled ? (
        onNewMatch ? <CancelledPanel state={state} onNewMatch={onNewMatch} /> : null
      ) : showJudge ? (
        judgeState === "revealed" && verdict ? (
          <div className="broadcast-stage__caption">
            <VerdictCard
              verdict={verdict}
              topic={state.topic ?? topic}
              sideAPosition={draftSideAPosition}
              sideBPosition={draftSideBPosition}
              onNewMatch={onNewMatch}
              footer={footer ? { ...footer, matchId: state.matchId ?? footer.matchId } : undefined}
            />
          </div>
        ) : (
          <VerdictEvaluating footer={footer} />
        )
      ) : null}
    </section>
  );
}

function LiveMatchCallout({
  side,
  responseRole,
}: {
  readonly side: "A" | "B";
  readonly responseRole?: "opening" | "response";
}) {
  const name = side === "A" ? "Ember" : "Vesper";
  const role = side === "A" ? "Challenger" : "Advocate";
  const next = side === "A" ? "Vesper" : "Ember";
  const phase = responseRole === "response" ? "rebuttal" : "opening";

  return (
    <div className={`live-match-callout live-match-callout--${side.toLowerCase()}`} aria-live="polite">
      <span className="live-match-callout__eyebrow">Now on air</span>
      <strong className="live-match-callout__speaker">
        {name}<span>{role}</span>
      </strong>
      <span className="live-match-callout__next">
        <span>Next response</span>
        <b>{next} answers the {phase}</b>
      </span>
    </div>
  );
}
