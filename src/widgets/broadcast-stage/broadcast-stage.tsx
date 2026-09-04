"use client";

import type { DebateRuntimeState } from "@/features/run-debate/lib/reducer";
import { CancelledPanel } from "@/features/run-debate/ui/cancelled-panel";
import { JudgePanel } from "@/features/run-debate/ui/judge-panel";
import { MatchHeader } from "@/features/run-debate/ui/match-header";
import type { DebateStreamVerdict } from "@/shared/api/debate-stream";
import type { RedactedProvider } from "@/shared/api/providers";
import { AgentDesk } from "./desks/agent-desk";
import { JudgePlinth } from "./desks/judge-plinth";
import { RoundMarker } from "./monitors/round-marker";
import { SpeechLayer } from "./speech/speech-layer";
import { StageBackdrop } from "./backdrop/stage-backdrop";
import { deriveStageView } from "./stage-state";
import type { RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";

interface JudgePanelFooter {
  readonly matchId?: string;
  readonly canRejudge: boolean;
  readonly rejudgeStatus: RejudgeStatus;
  readonly rejudgeError?: string;
  readonly judgedAt?: string;
  readonly onExportJson: (matchId: string) => void | Promise<unknown>;
  readonly onRejudge: (matchId: string) => void | Promise<unknown>;
}

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
  /** Footer forwarded to the `JudgePanel` when the verdict is revealed. */
  readonly footer?: JudgePanelFooter;
  /** Optional handler for the "cancelled" terminal screen. */
  readonly onNewMatch?: () => void;
}

/**
 * The R1 v0.3 broadcast composition. A new reusable widget that replaces the
 * flat "VSPillar + AgentCorners" layout with a cinematic 3D-feeling CSS stage:
 * backdrop + floor with perspective, two contender desks with geometric
 * mascots and monitors, a central Judge plinth, and a round marker above —
 * followed by the existing speech layer and judge panel, untouched.
 *
 * State comes only from {@link DebateRuntimeState}; the {@link deriveStageView}
 * pure mapping projects that state into data-attributes (and per-element
 * activity flags) that the CSS module uses to light up spotlights, shift the
 * camera, and animate the round indicator.
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
}: BroadcastStageProps) {
  const view = deriveStageView(state);

  const showJudge = state.status === "judging" || state.status === "finished";
  const judgeState =
    state.status === "judging" ? "evaluating" : state.status === "finished" ? "revealed" : null;
  const showCancelled = state.status === "cancelled";

  const verdict = state.verdict as DebateStreamVerdict | undefined;

  return (
    <section
      className="broadcast-stage"
      {...view.rootDataAttributes}
      aria-label="Live debate broadcast"
    >
      <StageBackdrop view={view} />

      <div className="broadcast-stage__composition">
        <div className="broadcast-stage__header">
          <MatchHeader topic={topic || "Untitled motion"} currentPhase={state.currentPhase} mode={state.mode} />
          <RoundMarker view={view} />
        </div>

        <div className="broadcast-stage__set" aria-hidden={showCancelled ? "true" : "false"}>
          <AgentDesk
            side="A"
            tone="coral"
            identity="The Challenger"
            position={draftSideAPosition ?? "FOR"}
            provider={agentA}
            model={draftSideAModel ?? state.panels.find((p) => p.side === "A")?.model}
            activity={view.sideAActivity}
            view={view}
            className="broadcast-stage__desk broadcast-stage__desk--a"
          />

          <div className="broadcast-stage__center">
            <JudgePlinth
              judgeProvider={judgeProvider}
              judgeModel={judgeModel}
              activity={view.judgeActivity}
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
            model={draftSideBModel ?? state.panels.find((p) => p.side === "B")?.model}
            activity={view.sideBActivity}
            view={view}
            className="broadcast-stage__desk broadcast-stage__desk--b"
          />
        </div>
      </div>

      <div className="broadcast-stage__speech">
        <SpeechLayer
          state={state}
          topic={topic}
          agentA={agentA}
          agentB={agentB}
          draftSideAModel={draftSideAModel}
          draftSideBModel={draftSideBModel}
          draftSideAPosition={draftSideAPosition}
          draftSideBPosition={draftSideBPosition}
        />
      </div>

      {showCancelled ? (
        onNewMatch ? <CancelledPanel state={state} onNewMatch={onNewMatch} /> : null
      ) : showJudge ? (
        <JudgePanel
          state={(judgeState ?? "evaluating") as "evaluating" | "revealed"}
          reasoning={verdict?.reasoning}
          verdict={verdict}
          errorMessage={state.errorMessage}
          footer={footer}
        />
      ) : null}
    </section>
  );
}
