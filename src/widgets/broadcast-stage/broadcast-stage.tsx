"use client";

import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { CancelledPanel } from "@/features/run-debate/ui/cancelled-panel";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import type { RedactedProvider } from "@/shared/api/providers";
import { BroadcastBanner } from "./broadcast-banner";
import { IdleSetup } from "./idle/idle-setup";
import type { JudgePanelFooter } from "./verdict/verdict-reveal";
import { VerdictReveal, VerdictEvaluating } from "./verdict/verdict-reveal";
import { AgentDesk } from "./desks/agent-desk";
import { JudgePlinth } from "./desks/judge-plinth";
import { RoundMarker } from "./monitors/round-marker";
import { SpeechLayer } from "./speech/speech-layer";
import { StageBackdrop } from "./backdrop/stage-backdrop";
import { ReactionOverlay } from "./reactions/reaction-overlay";
import { deriveStageView } from "./stage-state";

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
  readonly onStart?: (draft: import("@/features/create-debate/draft").MatchDraft) => void;
  readonly busy?: boolean;
  readonly errorMessage?: string;
  readonly reactionsMuted: boolean;
  readonly onToggleMute?: () => void;
}

/**
 * The v0.3 broadcast composition. The Arena is the first impression and the
 * main interface: broadcast banner + cyclorama backdrop, two contender
 * desks, a central Judge plinth, the teleprompter speech layer, and either
 * an idle setup surface or a dramatic verdict reveal. State comes only
 * from {@link DebateRuntimeState}; the {@link deriveStageView} pure mapping
 * projects that state into data-attributes that the CSS module uses to
 * light up spotlights, shift the camera, animate mascots, and pop reactions.
 *
 * The hook / reducer / stream lifecycle is untouched: this widget only
 * changes presentation.
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
  inMatch,
  onEndMatch,
  onOpenHistory,
  onStart,
  busy = false,
  errorMessage,
  reactionsMuted,
  onToggleMute,
}: BroadcastStageProps) {
  const view = deriveStageView(state);

  const showCancelled = state.status === "cancelled";
  const showJudge = state.status === "judging" || state.status === "finished";
  const judgeState =
    state.status === "judging" ? "evaluating" : state.status === "finished" ? "revealed" : null;

  const verdict = state.verdict as DebateStreamVerdict | undefined;

  const monitorModelA = draftSideAModel ?? state.panels.find((p) => p.side === "A")?.model;
  const monitorModelB = draftSideBModel ?? state.panels.find((p) => p.side === "B")?.model;

  const showSetup = !inMatch && Boolean(onStart);

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
        inMatch={inMatch}
        onEndMatch={onEndMatch}
        onOpenHistory={onOpenHistory}
        reactionsMuted={reactionsMuted}
        onToggleMute={onToggleMute}
      />

      <div className="broadcast-stage__composition">
        <div className="broadcast-stage__header">
          <RoundMarker view={view} />
        </div>

        <div className="broadcast-stage__set" aria-hidden={showCancelled ? "true" : "false"}>
          <AgentDesk
            side="A"
            tone="coral"
            identity="The Challenger"
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
            identity="The Advocate"
            position={draftSideBPosition ?? "AGAINST"}
            provider={agentB}
            model={monitorModelB}
            activity={view.sideBActivity}
            mood={view.moods.b}
            view={view}
            className="broadcast-stage__desk broadcast-stage__desk--b"
          />
        </div>

        <ReactionOverlay reaction={view.reaction} muted={reactionsMuted} position="top-right" />
      </div>

      {inMatch ? (
        <SpeechLayer
          state={state}
          agentA={agentA}
          agentB={agentB}
          draftSideAModel={draftSideAModel}
          draftSideBModel={draftSideBModel}
          draftSideAPosition={draftSideAPosition}
          draftSideBPosition={draftSideBPosition}
        />
      ) : null}

      {showCancelled ? (
        onNewMatch ? <CancelledPanel state={state} onNewMatch={onNewMatch} /> : null
      ) : showJudge ? (
        judgeState === "revealed" && verdict ? (
          <VerdictReveal verdict={verdict} reasoning={verdict.reasoning} footer={footer} />
        ) : (
          <VerdictEvaluating footer={footer} />
        )
      ) : showSetup && onStart ? (
        <IdleSetup onStart={onStart} busy={busy} errorMessage={errorMessage} />
      ) : null}
    </section>
  );
}
