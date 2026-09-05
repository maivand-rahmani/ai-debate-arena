"use client";

import type { DebateSide } from "@arena/debate-engine";
import type { RedactedProvider } from "@/shared/api/providers";
import type { SpeechPanel } from "@/features/run-debate/lib/reducer";

interface TeleprompterProps {
  readonly side: DebateSide;
  readonly tone: "coral" | "violet";
  readonly identity: string;
  readonly provider?: RedactedProvider;
  readonly model?: string;
  readonly position: "FOR" | "AGAINST";
  readonly panels: readonly SpeechPanel[];
  readonly currentSide: DebateSide | null;
}

/**
 * Broadcast teleprompter rail for one contender. Renders the live streaming
 * panel as the headline (with a blinking caret when unsealed) and sealed
 * turns as the rolling transcript below. First-class HTML — never hidden
 * inside an SVG.
 */
export function Teleprompter({
  side,
  tone,
  identity,
  provider,
  model,
  position,
  panels,
  currentSide,
}: TeleprompterProps) {
  const ordered = [...panels].sort((a, b) => phaseOrder(a.phase) - phaseOrder(b.phase));
  const isSpeaking = currentSide === side;
  const monitorTitle = provider?.name ?? "Provider —";
  const monitorMeta = model ?? "Model —";

  return (
    <section className={`teleprompter teleprompter--${tone}`} aria-label={`${identity} teleprompter`}>
      <header className="teleprompter__head">
        <span className="teleprompter__head-mark">
          <span className="teleprompter__head-dot" aria-hidden="true" />
          <span>Contender {side}</span>
        </span>
        <span className="teleprompter__head-round">
          {position === "FOR" ? "Arguing for" : "Arguing against"} · {monitorTitle} · {monitorMeta}
        </span>
      </header>

      <div className="teleprompter__rails">
        {ordered.length === 0 ? (
          <p className="teleprompter__empty" aria-live="polite">
            {isSpeaking
              ? "Listening for the first words…"
              : "Standing by — the floor is the other side's."}
          </p>
        ) : (
          ordered.map((panel) => {
            const isLive = !panel.sealed && isSpeaking && panel.side === side;
            const label = panelLabel(panel.phase);
            return (
              <article
                key={panel.id}
                className="teleprompter__line"
                aria-label={`${side} ${label}`}
                aria-live={isLive ? "polite" : "off"}
              >
                <p className="teleprompter__line-label">
                  {label} · {panel.sealed ? "Sealed" : "Live"}
                </p>
                <div className="teleprompter__line-text">
                  {panel.content || (isLive ? "…" : "")}
                  {isLive ? <span className="caret" aria-hidden="true" /> : null}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function phaseOrder(phase: SpeechPanel["phase"]): number {
  switch (phase) {
    case "OPENING_A":
    case "OPENING_B":
      return 1;
    case "REBUTTAL_A":
    case "REBUTTAL_B":
      return 2;
    default:
      return 3;
  }
}

function panelLabel(phase: SpeechPanel["phase"]): string {
  switch (phase) {
    case "OPENING_A":
    case "OPENING_B":
      return "Round 1 · Opening";
    case "REBUTTAL_A":
    case "REBUTTAL_B":
      return "Round 2 · Rebuttal";
    default:
      return phase;
  }
}

