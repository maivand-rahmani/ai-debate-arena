"use client";

import { useCallback, useMemo, useState } from "react";
import type { RedactedProvider } from "@/shared/api/providers";
import type { DebateStreamRequest } from "@/shared/api/debate-stream";
import { SetupForm } from "@/features/create-debate/setup-form";
import { useProviders } from "@/features/create-debate/use-providers";
import type { MatchDraft } from "@/features/create-debate/draft";
import { useDebateStream } from "@/features/run-debate/lib/use-debate-stream";
import { AgentCorner } from "@/features/run-debate/ui/agent-corner";
import { CancelledPanel } from "@/features/run-debate/ui/cancelled-panel";
import { JudgePanel } from "@/features/run-debate/ui/judge-panel";
import { MatchHeader, StatusLine } from "@/features/run-debate/ui/match-header";
import { isInMatch, panelsForSide, statusLineFor } from "@/features/run-debate/lib/reducer";

const TOP_STRIP_LINKS = [
  { label: "How it works", primary: false },
];

export default function ArenaScreen() {
  const { providers } = useProviders();
  const { state, start, reset, cancel } = useDebateStream();
  const [matchDraft, setMatchDraft] = useState<MatchDraft | null>(null);

  // Cancelled is a terminal *presentation* — the live arena keeps rendering
  // so the user can see what was streamed — but it is no longer "in match"
  // from a control-flow perspective. We still want the End-match button to
  // work (it just bounces through `cancel` again, which is a no-op).
  const inMatch = isInMatch(state);

  const handleStart = useCallback(
    (draft: MatchDraft) => {
      setMatchDraft(draft);
      const request = toRequest(draft);
      start(request);
    },
    [start],
  );

  const handleNewMatch = useCallback(() => {
    // From any terminal state we drop the saved draft so the next setup
    // form is freshly derived from the providers list.
    reset();
    setMatchDraft(null);
  }, [reset]);

  const handleEndMatch = useCallback(() => {
    if (state.status === "cancelled" || state.status === "finished") {
      // Already terminal — nothing to abort; just clear.
      reset();
      setMatchDraft(null);
      return;
    }
    cancel();
  }, [cancel, reset, state.status]);

  const handleRunAgain = useCallback(() => {
    if (!matchDraft) return;
    start(toRequest(matchDraft));
  }, [matchDraft, start]);

  const topic = matchDraft?.topic ?? state.topic ?? "";
  const agentA = useMemo(() => providerById(providers, matchDraft?.sideA.providerId), [providers, matchDraft]);
  const agentB = useMemo(() => providerById(providers, matchDraft?.sideB.providerId), [providers, matchDraft]);

  return (
    <main className="min-h-screen overflow-hidden bg-arena-900 text-arena-50">
      <div className="ambient-glow" aria-hidden="true" />
      <Nav inMatch={inMatch} onEndMatch={handleEndMatch} />
      <div className="relative z-10 mx-auto w-full max-w-[1240px] px-5 pb-20 pt-8 sm:px-8 lg:px-10">
        {inMatch ? (
          <LiveArena
            topic={topic}
            state={state}
            agentA={agentA}
            agentB={agentB}
            draft={matchDraft}
            onAbort={handleEndMatch}
            onNewMatch={handleNewMatch}
            onRunAgain={handleRunAgain}
          />
        ) : (
          <SetupHero
            onStart={handleStart}
            errorMessage={state.errorMessage}
            canRunAgain={Boolean(matchDraft)}
            onRunAgain={handleRunAgain}
          />
        )}
      </div>
      <footer className="relative z-10 border-t border-white/[0.06] px-5 py-5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-arena-400">
        A calm place for strong opinions · Local demo mode
      </footer>
    </main>
  );
}

// --- Sub-screens ------------------------------------------------------------

function Nav({ inMatch, onEndMatch }: { inMatch: boolean; onEndMatch: () => void }) {
  return (
    <nav className="relative z-10 mx-auto flex w-full max-w-[1240px] items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
      <a href="#top" className="flex items-center gap-2.5" aria-label="Arena home">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-arena-coral-300 text-arena-900">
          <BrandSpark className="h-4 w-4" />
        </span>
        <span className="font-display text-sm font-bold tracking-tight text-arena-50">
          DEBATE<span className="text-arena-coral-200">/</span>ARENA
        </span>
      </a>
      <div className="hidden items-center gap-7 text-[10px] font-bold uppercase tracking-[0.2em] text-arena-300 sm:flex">
        {TOP_STRIP_LINKS.map((link) => (
          <span key={link.label} className={link.primary ? "text-arena-50" : ""}>
            {link.label}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <i className="h-1.5 w-1.5 rounded-full bg-arena-success" /> Systems online
        </span>
      </div>
      <button
        type="button"
        onClick={onEndMatch}
        disabled={!inMatch}
        className="rounded-full border border-white/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-arena-200 transition hover:border-white/25 hover:text-arena-50 disabled:cursor-default disabled:opacity-60"
      >
        {inMatch ? "End match" : "About"}
      </button>
    </nav>
  );
}

interface SetupHeroProps {
  readonly onStart: (draft: MatchDraft) => void;
  readonly errorMessage?: string;
  readonly canRunAgain: boolean;
  readonly onRunAgain: () => void;
}

function SetupHero({ onStart, errorMessage, canRunAgain, onRunAgain }: SetupHeroProps) {
  return (
    <>
      <header className="mb-12 max-w-3xl pt-6 sm:pt-12">
        <div className="mb-5 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.25em] text-arena-coral-200">
          <span className="h-px w-8 bg-arena-coral-300" /> Live simulation
        </div>
        <h1 className="font-display text-[clamp(2.6rem,6.4vw,5.6rem)] font-bold leading-[0.92] tracking-[-0.05em] text-arena-50">
          Make a case.
          <br />
          <span className="text-arena-400">Watch it clash.</span>
        </h1>
        <p className="mt-7 max-w-md text-sm leading-6 text-arena-300">
          Pit two AI minds against each other. Set the terms, press play, and let the strongest argument emerge.
        </p>
      </header>
      {errorMessage ? (
        <div
          className="topic-panel mb-6 border-arena-coral-300/30 bg-arena-coral-300/[0.07]"
          role="alert"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
                Match could not start
              </p>
              <p className="mt-2 text-sm text-arena-100">{errorMessage}</p>
            </div>
            {canRunAgain ? (
              <button
                type="button"
                onClick={onRunAgain}
                className="rounded-lg border border-arena-coral-300/40 bg-arena-coral-300/[0.08] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-arena-coral-100 transition hover:border-arena-coral-300/70 hover:text-arena-50"
              >
                Run again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <SetupForm onStart={onStart} />
    </>
  );
}

interface LiveArenaProps {
  readonly topic: string;
  readonly state: ReturnType<typeof useDebateStream>["state"];
  readonly agentA?: RedactedProvider;
  readonly agentB?: RedactedProvider;
  readonly draft: MatchDraft | null;
  readonly onAbort: () => void;
  readonly onNewMatch: () => void;
  readonly onRunAgain: () => void;
}

function LiveArena({ topic, state, agentA, agentB, draft, onAbort, onNewMatch, onRunAgain }: LiveArenaProps) {
  const showJudge = state.status === "judging" || state.status === "finished";
  const judgeState =
    state.status === "judging" ? "evaluating" : state.status === "finished" ? "revealed" : null;
  const showCancelled = state.status === "cancelled";
  const showErrorMidMatch = state.status === "error";
  const tone =
    state.status === "error"
      ? "error"
      : state.status === "cancelled"
        ? "cancelled"
        : state.status === "judging" || state.status === "finished"
          ? "judge"
          : "neutral";

  const action =
    showCancelled
      ? { label: "New match", handler: onNewMatch, emphasis: "primary" as const }
      : showErrorMidMatch && draft
        ? { label: "Run again", handler: onRunAgain, emphasis: "primary" as const }
        : { label: "End match", handler: onAbort, emphasis: "ghost" as const };

  return (
    <div className="grid gap-8">
      <MatchHeader
        topic={topic || "Untitled motion"}
        currentPhase={state.currentPhase}
        mode={state.mode}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <AgentCorner
          side="A"
          tone="coral"
          identity="The Challenger"
          provider={agentA}
          model={draft?.sideA.model ?? state.panels.find((p) => p.side === "A")?.model}
          position={draft?.sideA.position ?? "FOR"}
          panels={panelsForSide(state, "A")}
          currentSide={state.currentSide}
        />
        <VSPillar
          currentPhase={state.currentPhase}
          finished={state.status === "finished"}
          cancelled={showCancelled}
        />
        <AgentCorner
          side="B"
          tone="violet"
          identity="The Advocate"
          provider={agentB}
          model={draft?.sideB.model ?? state.panels.find((p) => p.side === "B")?.model}
          position={draft?.sideB.position ?? "AGAINST"}
          panels={panelsForSide(state, "B")}
          currentSide={state.currentSide}
        />
      </div>

      {showCancelled ? (
        <CancelledPanel state={state} onNewMatch={onNewMatch} />
      ) : showJudge ? (
        <JudgePanel
          state={judgeState ?? "evaluating"}
          reasoning={state.verdict?.reasoning}
          verdict={state.verdict}
          errorMessage={state.errorMessage}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusLine tone={tone}>{statusLineFor(state)}</StatusLine>
        <ActionButton {...action} />
      </div>
    </div>
  );
}

interface ActionButtonProps {
  readonly label: string;
  readonly handler: () => void;
  readonly emphasis: "primary" | "ghost";
}

function ActionButton({ label, handler, emphasis }: ActionButtonProps) {
  const base =
    "rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition";
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

function VSPillar({ currentPhase, finished, cancelled }: { currentPhase: string; finished: boolean; cancelled: boolean }) {
  const stageLabel = cancelled
    ? "Ended"
    : finished
      ? "Finished"
      : currentPhase === "JUDGING"
        ? "Judge"
        : currentPhase === "CREATED"
          ? "Ready"
          : currentPhase === "FINISHED"
            ? "Complete"
            : "Round";
  return (
    <div className="hidden flex-col items-center justify-center self-stretch lg:flex">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <span
          aria-hidden="true"
          className={`font-display text-[clamp(3rem,5vw,4.5rem)] font-bold tracking-[-0.08em] ${
            cancelled ? "text-gold-100" : finished ? "text-gold-100" : currentPhase === "JUDGING" ? "text-gold-100" : "text-arena-400"
          }`}
        >
          VS
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-arena-300">{stageLabel}</span>
      </div>
    </div>
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

function BrandSpark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 13.8 10l7.7 2-7.7 2-1.8 7.5-1.8-7.5-7.7-2 7.7-2L12 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
