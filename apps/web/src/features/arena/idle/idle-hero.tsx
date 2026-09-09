"use client";

interface IdleHeroProps {
  readonly onStart: () => void;
  readonly onOpenHistory: () => void;
  readonly recentCount?: number;
  readonly busy?: boolean;
  readonly reducedMotion?: boolean;
}

/**
 * Minimal idle surface — the v0.3.1 rest landing page. The arena used
 * to dump a full setup form here; the owner feedback was that this
 * competes with the 3D stage and is too much for a hero. The setup
 * form now opens as a modal (see <SetupModal />); "Recent matches"
 * opens the recent-matches modal; the 3D scene + title stay
 * visible behind both.
 */
export function IdleHero({ onStart, onOpenHistory, recentCount = 0, busy = false, reducedMotion = false }: IdleHeroProps) {
  return (
    <section className="idle-hero" aria-label="Arena idle" data-reduced-motion={reducedMotion || undefined}>
      <div className="idle-hero__inner">
        <p className="idle-hero__eyebrow">A live argument, composed</p>
        <h1 className="idle-hero__title">AI Debate Arena</h1>
        <p className="idle-hero__sub">Two minds. One question. Let them argue.</p>

        <div className="idle-hero__cta">
          <button
            type="button"
            onClick={onStart}
            disabled={busy}
            className="start-button idle-hero__start"
            aria-busy={busy || undefined}
          >
            <span>{busy ? "Opening the console…" : "Start new debate"}</span>
            <span aria-hidden="true" className="font-display" style={{ fontSize: "1.1rem", lineHeight: 1 }}>
              →
            </span>
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="idle-hero__history"
            aria-label={recentCount > 0 ? `View ${recentCount} recent matches` : "View recent matches"}
          >
            <span aria-hidden="true" className="idle-hero__history-dot" />
            <span>
              {recentCount > 0
                ? `Recent matches · ${recentCount}`
                : "Recent matches"}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
