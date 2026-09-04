"use client";

import { useCallback, useMemo, useState } from "react";
import type { RedactedProvider } from "@/shared/api/providers";
import type { DebateStreamRequest } from "@/shared/api/debate-stream";
import { SetupForm } from "@/features/create-debate/setup-form";
import { useProviders } from "@/features/create-debate/use-providers";
import type { MatchDraft } from "@/features/create-debate/draft";
import { useDebateStream } from "@/features/run-debate/lib/use-debate-stream";
import { AgentCorner } from "@/features/run-debate/ui/agent-corner";
import { JudgePanel } from "@/features/run-debate/ui/judge-panel";
import { MatchHeader, StatusLine } from "@/features/run-debate/ui/match-header";
import { panelsForSide, statusLineFor } from "@/features/run-debate/lib/reducer";

const TOP_STRIP_LINKS = [
  { label: "How it works", primary: false },
];

export default function ArenaScreen() {
  const { providers } = useProviders();
  const { state, start, reset } = useDebateStream();
  const [matchDraft, setMatchDraft] = useState<MatchDraft | null>(null);

  const inMatch = state.status !== "idle" && state.status !== "error";

  const handleStart = useCallback(
    (draft: MatchDraft) => {
      setMatchDraft(draft);
      const request = toRequest(draft);
      start(request);
    },
    [start],
  );

  const handleNewMatch = useCallback(() => {
    reset();
    setMatchDraft(null);
  }, [reset]);

  const topic = matchDraft?.topic ?? state.topic ?? "";
  const agentA = useMemo(() => providerById(providers, matchDraft?.sideA.providerId), [providers, matchDraft]);
  const agentB = useMemo(() => providerById(providers, matchDraft?.sideB.providerId), [providers, matchDraft]);

  return (
    <main className="min-h-screen overflow-hidden bg-arena-900 text-arena-50">
      <div className="ambient-glow" aria-hidden="true" />
      <Nav inMatch={inMatch} onEndMatch={handleNewMatch} />
      <div className="relative z-10 mx-auto w-full max-w-[1240px] px-5 pb-20 pt-8 sm:px-8 lg:px-10">
        {inMatch ? (
          <LiveArena
            topic={topic}
            state={state}
            agentA={agentA}
            agentB={agentB}
            draft={matchDraft}
            onAbort={handleNewMatch}
          />
        ) : (
          <SetupHero onStart={handleStart} errorMessage={state.errorMessage} />
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

function SetupHero({ onStart, errorMessage }: { onStart: (draft: MatchDraft) => void; errorMessage?: string }) {
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
        <div className="topic-panel mb-6 border-arena-coral-300/30 bg-arena-coral-300/[0.07]" role="alert">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
            Match could not start
          </p>
          <p className="mt-2 text-sm text-arena-100">{errorMessage}</p>
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
}

function LiveArena({ topic, state, agentA, agentB, draft, onAbort }: LiveArenaProps) {
  const showJudge = state.status === "judging" || state.status === "finished";
  const judgeState = state.status === "judging" ? "evaluating" : state.status === "finished" ? "revealed" : null;
  const tone = state.status === "error" ? "error" : state.status === "judging" || state.status === "finished" ? "judge" : "neutral";

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

      {showJudge ? (
        <JudgePanel
          state={judgeState ?? "evaluating"}
          reasoning={state.verdict?.reasoning}
          verdict={state.verdict}
          errorMessage={state.errorMessage}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusLine tone={tone}>{statusLineFor(state)}</StatusLine>
        <button
          type="button"
          onClick={onAbort}
          className="rounded-lg border border-white/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-arena-200 transition hover:border-white/25 hover:text-arena-50"
        >
          End match
        </button>
      </div>
    </div>
  );
}

function VSPillar({ currentPhase, finished }: { currentPhase: string; finished: boolean }) {
  const stageLabel =
    finished
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
            finished ? "text-arena-gold-100" : currentPhase === "JUDGING" ? "text-arena-gold-100" : "text-arena-400"
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
