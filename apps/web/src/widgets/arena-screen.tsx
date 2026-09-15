"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RedactedProvider } from "@/shared/api/providers";
import {
  fetchMatch,
  fetchMatchList,
  rejudgeMatch,
  MatchesApiError,
  type MatchSummary,
} from "@/shared/api/matches";
import { useProviders } from "@/features/create-debate/use-providers";
import { toDebateRequest, type MatchDraft } from "@/features/create-debate/draft";
import { SIDE_POSITIONS } from "@/shared/config/sides";
import { useDebateStream } from "@/features/run-debate/lib/use-debate-stream";
import { isInMatch } from "@/features/run-debate/lib/reducer";
import { performLiveRejudge } from "@/features/run-debate/lib/live-rejudge";
import { MatchHistoryDrawer } from "@/features/run-debate/ui/match-history/match-history-drawer";
import { exportJsonBlob } from "@/features/run-debate/ui/match-history/match-actions";
import type { ExportStatus, RejudgeStatus } from "@/features/run-debate/ui/match-history/match-actions";
import { IdleHero, RecentMatchesModal, SetupModal } from "@/features/arena/idle";
import { useMatchPlayback } from "@/features/arena/match/use-match-playback";
import { ArenaFrame } from "@/widgets/broadcast-stage";

/**
 * The arena is the first impression and main interface — there is no
 * separate dashboard layout. The ArenaFrame owns the 3D canvas (with the
 * original 2D CSS broadcast stage as the no-WebGL fallback) plus the HUD
 * overlay layer. This screen only orchestrates the runtime lifecycle,
 * provider lookup, history drawer, and re-judge state.
 */
export default function ArenaScreen() {
  const { providers } = useProviders();
  const {
    state,
    start,
    reset,
    cancel,
    dispatch,
    canAdvanceNextResponse,
    isWaitingForNextResponse,
    nextResponse,
  } = useDebateStream();
  const [matchDraft, setMatchDraft] = useState<MatchDraft | null>(null);
  const [rejudgeStatus, setRejudgeStatus] = useState<RejudgeStatus>("idle");
  const [rejudgeError, setRejudgeError] = useState<string | undefined>(undefined);
  const [refreshError, setRefreshError] = useState<string | undefined>(undefined);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportError, setExportError] = useState<string | undefined>(undefined);
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
  const streamPlayback = useMatchPlayback(state);
  // Standard has a stream-level reveal gate. The older panel playback would
  // otherwise select an earlier speech while the viewer waits for Next response.
  // Quick keeps its existing playback behavior.
  const playback = state.mode === "standard" ? undefined : streamPlayback;

  const handleStart = useCallback(
    (draft: MatchDraft) => {
      setMatchDraft(draft);
      setRejudgeStatus("idle");
      setRejudgeError(undefined);
      setRefreshError(undefined);
      setExportStatus("idle");
      setExportError(undefined);
      start(toDebateRequest(draft));
    },
    [start],
  );

  const handleNewMatch = useCallback(() => {
    reset();
    setMatchDraft(null);
    setRejudgeStatus("idle");
    setRejudgeError(undefined);
    setRefreshError(undefined);
    setExportStatus("idle");
    setExportError(undefined);
    setSetupOpen(true);
  }, [reset]);

  const handleEndMatch = useCallback(() => {
    if (state.status === "cancelled" || state.status === "finished") {
      reset();
      setMatchDraft(null);
      setRejudgeStatus("idle");
      setRejudgeError(undefined);
      setRefreshError(undefined);
      setExportStatus("idle");
      setExportError(undefined);
      return;
    }
    cancel();
  }, [cancel, reset, state.status]);

  const handleOpenHistory = useCallback(() => setDrawerOpen(true), []);
  const handleExportJson = useCallback(async (matchId: string) => {
    setExportStatus("flying");
    setExportError(undefined);
    try {
      const record = await fetchMatch(matchId);
      exportJsonBlob(record, matchId);
      setExportStatus("idle");
    } catch (error) {
      setExportStatus("error");
      setExportError(messageFromError(error));
    }
  }, []);

  const handleRejudge = useCallback(
    async (matchId: string) => {
      setRejudgeStatus("flying");
      setRejudgeError(undefined);
      setRefreshError(undefined);
      const result = await performLiveRejudge(matchId, {
        rejudge: rejudgeMatch,
        refresh: fetchMatch,
        onVerdict: (verdict, judgedAt) =>
          dispatch({ type: "rejudge-success", verdict, judgedAt }),
        onRefreshFailure: (error) => setRefreshError(messageFromError(error)),
        onFailure: (error) => setRejudgeError(messageFromError(error)),
      });
      setRejudgeStatus(result.ok ? "idle" : "error");
      return result.ok
        ? { judgedAt: result.judgedAt, winner: result.winner }
        : undefined;
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
        refreshError,
        exportStatus,
        exportError,
        judgedAt: state.judgedAt,
        onExportJson: handleExportJson,
        onRejudge: handleRejudge,
      }
    : undefined;

  return (
    <main className="arena-home">
        <ArenaFrame
          topic={topic}
          state={state}
          agentA={agentA}
          agentB={agentB}
          judgeProvider={judgeProvider}
          judgeModel={judgeModel}
          draftSideAModel={matchDraft?.sideA.model}
          draftSideBModel={matchDraft?.sideB.model}
          draftSideAPosition={SIDE_POSITIONS.A}
          draftSideBPosition={SIDE_POSITIONS.B}
          footer={footer}
          onNewMatch={handleNewMatch}
          inMatch={inMatch}
          onEndMatch={handleEndMatch}
          onOpenHistory={handleOpenHistory}
          playback={playback}
          standardLimits={matchDraft?.standard}
          onNextResponse={nextResponse}
          canAdvanceNextResponse={canAdvanceNextResponse}
          isWaitingForNextResponse={isWaitingForNextResponse}
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

function providerById(providers: readonly RedactedProvider[], id?: string): RedactedProvider | undefined {
  if (!id) return undefined;
  return providers.find((provider) => provider.id === id);
}

function messageFromError(error: unknown): string {
  if (error instanceof MatchesApiError) return error.message;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Something went wrong.";
}
