"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RedactedProvider } from "@/shared/api/providers";
import type { DebateStreamRequest } from "@/shared/api/debate-stream";
import {
  fetchMatch,
  fetchMatchList,
  rejudgeMatch,
  MatchesApiError,
  type MatchSummary,
} from "@/shared/api/matches";
import { useProviders } from "@/features/create-debate/use-providers";
import type { MatchDraft } from "@/features/create-debate/draft";
import { useDebateStream } from "@/features/run-debate/lib/use-debate-stream";
import { isInMatch } from "@/features/run-debate/lib/reducer";
import { MatchHistoryDrawer } from "@/features/run-debate/ui/match-history/match-history-drawer";
import { exportJsonBlob } from "@/features/run-debate/ui/match-history/match-actions";
import type { RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";
import { IdleHero, RecentMatchesModal, SetupModal } from "@/features/arena/idle";
import { ArenaFrame } from "@/widgets/broadcast-stage";

/**
 * The arena is the first impression and main interface — there is no
 * separate dashboard layout. The ArenaFrame owns the 3D canvas (with the
 * original 2D CSS broadcast stage as the no-WebGL fallback) plus the HUD
 * overlay layer. This screen only orchestrates the runtime lifecycle,
 * provider lookup, history drawer, re-judge state, and the mute toggle.
 */
export default function ArenaScreen() {
  const { providers } = useProviders();
  const { state, start, reset, cancel, dispatch } = useDebateStream();
  const [matchDraft, setMatchDraft] = useState<MatchDraft | null>(null);
  const [rejudgeStatus, setRejudgeStatus] = useState<RejudgeStatus>("idle");
  const [rejudgeError, setRejudgeError] = useState<string | undefined>(undefined);
  const [reactionsMuted, setReactionsMuted] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentCount, setRecentCount] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);

  const openSetup = useCallback(() => setSetupOpen(true), []);
  const closeSetup = useCallback(() => setSetupOpen(false), []);
  const openRecent = useCallback(() => setRecentOpen(true), []);
  const closeRecent = useCallback(() => setRecentOpen(false), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Count recent matches once on mount so the idle hero can hint at
  // "Recent matches · N" without forcing the user to open the modal.
  useEffect(() => {
    let cancelled = false;
    fetchMatchList()
      .then((matches: readonly MatchSummary[]) => {
        if (cancelled) return;
        setRecentCount(matches.length);
      })
      .catch(() => {
        if (cancelled) return;
        setRecentCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleOpenHistory = useCallback(() => setDrawerOpen(true), []);
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

  const judgeProvider = providers[0];
  const judgeModel = judgeProvider?.model;

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

  return (
    <main className="arena-home" style={{ background: "#0c0a07" }}>
        <ArenaFrame
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
          reactionsMuted={reactionsMuted}
          onToggleMute={handleToggleMute}
        />
        {/* v0.3.1 idle: minimal hero with one CTA + a small
            recent-matches link. Both open modals that sit on top of
            the 3D stage instead of dumping the full setup form on
            the landing page. */}
        {!inMatch ? (
          <IdleHero
            onStart={openSetup}
            onOpenHistory={openRecent}
            recentCount={recentCount}
            busy={state.status === "starting"}
            reducedMotion={reducedMotion}
          />
        ) : null}

      <SetupModal
        open={setupOpen}
        onClose={closeSetup}
        onStart={(draft) => {
          closeSetup();
          handleStart(draft);
        }}
        busy={state.status === "starting"}
        errorMessage={state.status === "error" && !inMatch ? state.errorMessage : undefined}
      />
      <RecentMatchesModal open={recentOpen} onClose={closeRecent} />
      <MatchHistoryDrawer open={drawerOpen} onClose={closeDrawer} />
    </main>
  );
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
