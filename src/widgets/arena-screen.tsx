"use client";

import { useCallback, useMemo, useState } from "react";
import type { RedactedProvider } from "@/shared/api/providers";
import type { DebateStreamRequest } from "@/shared/api/debate-stream";
import {
  fetchMatch,
  rejudgeMatch,
  MatchesApiError,
} from "@/shared/api/matches";
import { useProviders } from "@/features/create-debate/use-providers";
import type { MatchDraft } from "@/features/create-debate/draft";
import { useDebateStream } from "@/features/run-debate/lib/use-debate-stream";
import {
  isInMatch,
  statusLineFor,
  type DebateRuntimeState,
} from "@/features/run-debate/lib/reducer";
import { MatchHistoryDrawer } from "@/features/run-debate/ui/match-history/match-history-drawer";
import { exportJsonBlob } from "@/features/run-debate/ui/match-history/match-actions";
import type { RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";
import { BroadcastStage } from "@/widgets/broadcast-stage";

/**
 * The arena is the first impression and main interface — there is no
 * separate dashboard layout. The BroadcastStage owns the banner, backdrop,
 * three-character set, teleprompter / verdict / idle-setup slot, and the
 * curated reactions overlay. This screen only orchestrates the runtime
 * lifecycle, provider lookup, history drawer, re-judge state, and the
 * mute toggle.
 */
export default function ArenaScreen() {
  const { providers } = useProviders();
  const { state, start, reset, cancel, dispatch } = useDebateStream();
  const [matchDraft, setMatchDraft] = useState<MatchDraft | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rejudgeStatus, setRejudgeStatus] = useState<RejudgeStatus>("idle");
  const [rejudgeError, setRejudgeError] = useState<string | undefined>(undefined);
  const [reactionsMuted, setReactionsMuted] = useState(false);

  const inMatch = isInMatch(state);

  const handleStart = useCallback(
    (draft: MatchDraft) => {
      setMatchDraft(draft);
      setRejudgeStatus("idle");
      setRejudgeError(undefined);
      start(toRequest(draft));
    },
    [start],
  );

  const handleNewMatch = useCallback(() => {
    reset();
    setMatchDraft(null);
    setRejudgeStatus("idle");
    setRejudgeError(undefined);
  }, [reset]);

  const handleEndMatch = useCallback(() => {
    if (state.status === "cancelled" || state.status === "finished") {
      reset();
      setMatchDraft(null);
      setRejudgeStatus("idle");
      setRejudgeError(undefined);
      return;
    }
    cancel();
  }, [cancel, reset, state.status]);

  const handleRunAgain = useCallback(() => {
    if (!matchDraft) return;
    setRejudgeStatus("idle");
    setRejudgeError(undefined);
    start(toRequest(matchDraft));
  }, [matchDraft, start]);

  const handleOpenHistory = useCallback(() => setHistoryOpen(true), []);
  const handleCloseHistory = useCallback(() => setHistoryOpen(false), []);
  const handleToggleMute = useCallback(() => setReactionsMuted((m) => !m), []);

  const handleExportJson = useCallback(async (matchId: string) => {
    try {
      const record = await fetchMatch(matchId);
      exportJsonBlob(record, matchId);
    } catch (error) {
      setRejudgeStatus("error");
      setRejudgeError(messageFromError(error));
    }
  }, []);

  const handleRejudge = useCallback(
    async (matchId: string) => {
      setRejudgeStatus("flying");
      setRejudgeError(undefined);
      try {
        const result = await rejudgeMatch(matchId);
        const record = await fetchMatch(matchId);
        if (record.verdict) {
          dispatch({
            type: "rejudge-success",
            verdict: record.verdict,
            judgedAt: result.judgedAt,
          });
        }
        setRejudgeStatus("idle");
        return { judgedAt: result.judgedAt, winner: result.summary.winner };
      } catch (error) {
        setRejudgeStatus("error");
        setRejudgeError(messageFromError(error));
        throw error;
      }
    },
    [dispatch],
  );

  const topic = matchDraft?.topic ?? state.topic ?? "";
  const agentA = useMemo(
    () => providerById(providers, matchDraft?.sideA.providerId),
    [providers, matchDraft],
  );
  const agentB = useMemo(
    () => providerById(providers, matchDraft?.sideB.providerId),
    [providers, matchDraft],
  );

  // The judge provider/model is intentionally not in the runtime state — for
  // the local Quick demo, the judge re-uses the first configured provider
  // and its default model. This keeps the existing v0.2 contract (no new
  // judge wiring required) and stays server-only.
  const judgeProvider = providers[0];
  const judgeModel = judgeProvider?.model;

  const tone = statusToneFor(state);
  const footer = state.matchId
    ? {
        matchId: state.matchId,
        canRejudge: state.status === "finished" || state.status === "error" || state.status === "cancelled",
        rejudgeStatus,
        rejudgeError,
        judgedAt: state.judgedAt,
        onExportJson: handleExportJson,
        onRejudge: handleRejudge,
      }
    : undefined;

  const showStatusLine = inMatch;

  return (
    <main className="min-h-screen overflow-x-hidden" style={{ background: "#0c0a07" }}>
      <div className="ambient-glow" aria-hidden="true" />
      <div className="relative z-10 mx-auto w-full max-w-[1280px] px-4 pb-12 pt-4 sm:px-6 lg:px-8">
        <BroadcastStage
          topic={topic}
          state={state}
          agentA={agentA}
          agentB={agentB}
          judgeProvider={judgeProvider}
          judgeModel={judgeModel}
          draftSideAModel={matchDraft?.sideA.model}
          draftSideBModel={matchDraft?.sideB.model}
          draftSideAPosition={matchDraft?.sideA.position}
          draftSideBPosition={matchDraft?.sideB.position}
          footer={footer}
          onNewMatch={handleNewMatch}
          inMatch={inMatch}
          onEndMatch={handleEndMatch}
          onOpenHistory={handleOpenHistory}
          onStart={handleStart}
          busy={state.status === "starting"}
          errorMessage={state.status === "error" && !inMatch ? state.errorMessage : undefined}
          reactionsMuted={reactionsMuted}
          onToggleMute={handleToggleMute}
        />

        {showStatusLine ? (
          <div
            className={`status-strip status-strip--${tone}`}
            role="status"
            aria-live="polite"
            style={{ marginTop: "12px" }}
          >
            <span className="pulse-dot" aria-hidden="true" />
            <span>{statusLineFor(state)}</span>
          </div>
        ) : null}

        {inMatch ? (
          <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginTop: "12px" }}>
            <ActionButton
              label={
                state.status === "cancelled" || state.status === "finished"
                  ? "New match"
                  : state.status === "error" && matchDraft
                    ? "Run again"
                    : "End match"
              }
              handler={
                state.status === "cancelled" || state.status === "finished"
                  ? handleNewMatch
                  : state.status === "error" && matchDraft
                    ? handleRunAgain
                    : handleEndMatch
              }
              emphasis={state.status === "cancelled" || state.status === "finished" || (state.status === "error" && matchDraft) ? "primary" : "ghost"}
            />
          </div>
        ) : null}
      </div>
      <footer className="relative z-10 border-t px-5 py-5 text-center text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ borderColor: "rgba(184,162,133,.18)", color: "#8a7a64" }}>
        A calm place for strong opinions · Local demo mode
      </footer>
      <MatchHistoryDrawer open={historyOpen} onClose={handleCloseHistory} />
    </main>
  );
}

function statusToneFor(state: DebateRuntimeState): "neutral" | "judge" | "error" | "cancelled" {
  switch (state.status) {
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    case "judging":
    case "finished":
      return "judge";
    default:
      return "neutral";
  }
}

// --- Helpers ----------------------------------------------------------------

function toRequest(draft: MatchDraft): DebateStreamRequest {
  return {
    topic: draft.topic.trim(),
    mode: "quick",
    agentA: {
      providerId: draft.sideA.providerId,
      model: draft.sideA.model,
      position: draft.sideA.position,
    },
    agentB: {
      providerId: draft.sideB.providerId,
      model: draft.sideB.model,
      position: draft.sideB.position,
    },
  };
}

function providerById(providers: readonly RedactedProvider[], id?: string): RedactedProvider | undefined {
  if (!id) return undefined;
  return providers.find((provider) => provider.id === id);
}

function messageFromError(error: unknown): string {
  if (error instanceof MatchesApiError) return error.message;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Something went wrong.";
}

interface ActionButtonProps {
  readonly label: string;
  readonly handler: () => void;
  readonly emphasis: "primary" | "ghost";
}

function ActionButton({ label, handler, emphasis }: ActionButtonProps) {
  const base = "rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition";
  const cls =
    emphasis === "primary"
      ? `${base} border border-arena-coral-300/40 bg-arena-coral-300/[0.08] text-arena-coral-100 hover:border-arena-coral-300/70 hover:text-arena-50`
      : `${base} border border-white/10 text-arena-200 hover:border-white/25 hover:text-arena-50`;
  return (
    <button type="button" onClick={handler} className={cls}>
      {label}
    </button>
  );
}
