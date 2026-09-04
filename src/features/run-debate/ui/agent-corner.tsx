"use client";

import type { DebateSide } from "@/entities/debate";
import type { RedactedProvider } from "@/shared/api/providers";
import { PHASE_ROUNDS, type SpeechPanel } from "../lib/reducer";
import { Caret } from "./atoms";

interface AgentCornerProps {
  readonly side: DebateSide;
  readonly tone: "coral" | "violet";
  readonly identity: string;
  readonly provider?: RedactedProvider;
  readonly model?: string;
  readonly position: "FOR" | "AGAINST";
  readonly panels: readonly SpeechPanel[];
  readonly currentSide: DebateSide | null;
}

export function AgentCorner({
  side,
  tone,
  identity,
  provider,
  model,
  position,
  panels,
  currentSide,
}: AgentCornerProps) {
  const accentDot = tone === "coral" ? "bg-arena-coral-300" : "bg-arena-violet-300";
  const labelText = tone === "coral" ? "text-arena-coral-200" : "text-arena-violet-100";
  const isSpeaking = currentSide === side;
  const roundsForSide = PHASE_ROUNDS.filter((round) => round.side === side);

  return (
    <section
      aria-label={`Agent ${side}`}
      className={`agent-card ${tone === "coral" ? "agent-coral" : "agent-violet"} flex h-full flex-col gap-5`}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="agent-mark" aria-hidden="true">
            {side}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-300">
              Contender {side}
            </p>
            <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-arena-50">
              {identity}
            </h2>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span
            className={`inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] ${labelText}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${accentDot}`} />
            {position === "FOR" ? "Arguing for" : "Arguing against"}
          </span>
          {isSpeaking ? (
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-arena-gold-100">
              Speaking
            </span>
          ) : null}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-[11px] text-arena-300">
        <div>
          <dt className="text-[9px] font-bold uppercase tracking-[0.22em] text-arena-400">Provider</dt>
          <dd className="mt-1 font-medium text-arena-100">{provider?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[9px] font-bold uppercase tracking-[0.22em] text-arena-400">Model</dt>
          <dd className="mt-1 truncate font-medium text-arena-100" title={model ?? ""}>
            {model ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-4">
        {roundsForSide.map((round) => {
          const panel = panels.find((p) => p.id === `${side}:${round.key}`);
          const isActive = Boolean(panel && !panel.sealed && isSpeaking);
          return (
            <SpeechPanelView
              key={round.key}
              tone={tone}
              side={side}
              round={round}
              panel={panel}
              isActive={isActive}
            />
          );
        })}
      </div>
    </section>
  );
}

interface SpeechPanelViewProps {
  readonly tone: "coral" | "violet";
  readonly side: DebateSide;
  readonly round: { key: string; label: string; round: 1 | 2; stage: "opening" | "rebuttal" };
  readonly panel?: SpeechPanel;
  readonly isActive: boolean;
}

function SpeechPanelView({ tone, side, round, panel, isActive }: SpeechPanelViewProps) {
  const accentText = tone === "coral" ? "text-arena-coral-100" : "text-arena-violet-100";
  const accentBorder = tone === "coral" ? "border-arena-coral-300/40" : "border-arena-violet-300/40";
  const accentGlow = tone === "coral" ? "shadow-[0_18px_60px_-24px_rgba(255,108,80,0.5)]" : "shadow-[0_18px_60px_-24px_rgba(169,140,255,0.5)]";

  if (!panel) {
    return (
      <div
        className={`rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-arena-400`}
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.2em]">
          Round {round.round} · {round.stage === "opening" ? "Opening" : "Rebuttal"}
        </p>
        <p className="mt-3 text-xs">Awaiting…</p>
      </div>
    );
  }

  return (
    <article
      className={`rounded-xl border ${accentBorder} bg-white/[0.04] p-5 transition animate-panel-enter ${isActive ? `${accentGlow}` : ""}`}
      aria-label={`${side} ${round.label}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[10px] font-bold uppercase tracking-[0.22em] ${accentText}`}>
          Round {round.round} · {round.stage === "opening" ? "Opening" : "Rebuttal"}
        </p>
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-arena-400">
          {panel.sealed ? "Sealed" : "Streaming"}
        </span>
      </div>
      <div className="mt-3 whitespace-pre-wrap font-body text-[15px] leading-relaxed text-arena-50">
        {panel.content}
        {!panel.sealed ? <Caret className={`ml-1 ${tone === "coral" ? "text-arena-coral-200" : "text-arena-violet-100"}`} /> : null}
      </div>
    </article>
  );
}
