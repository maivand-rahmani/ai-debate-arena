"use client";

interface ProvidersEmptyStateProps {
  readonly loading?: boolean;
  readonly title?: string;
  readonly body?: string;
  readonly commandLabel?: string;
  readonly onCommand?: () => void;
  readonly onReload?: () => void;
  /**
   * Optional primary in-browser action — when provided, becomes the
   * main call-to-action and the CLI command drops to a documented
   * secondary line. Replaces the previous "run the CLI" dead-end with
   * a button that opens the provider management modal.
   */
  readonly onManageProviders?: () => void;
  readonly manageLabel?: string;
}

/**
 * Friendly fallback shown when no providers are configured. Two modes:
 *
 *   - With `onManageProviders` set: the primary button opens the
 *     in-browser provider manager and the CLI line is shown as a
 *     documented secondary fallback.
 *   - Without it (legacy / non-interactive contexts): the primary
 *     button surfaces the CLI command via `onCommand` (defaults to a
 *     reload-style "Run …" hint).
 *
 * The wording stays calm in both cases — no marketing language, no
 * exclamation points.
 */
export function ProvidersEmptyState({
  loading,
  title,
  body,
  commandLabel,
  onCommand,
  onReload,
  onManageProviders,
  manageLabel = "Connect a provider",
}: ProvidersEmptyStateProps) {
  if (loading) {
    return (
      <div className="topic-panel grid place-items-center text-center" role="status" aria-live="polite">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
          Loading providers
        </p>
        <p className="mt-3 max-w-sm text-sm text-arena-300">
          Asking the arena for the configured providers…
        </p>
      </div>
    );
  }

  const hasBrowserAction = typeof onManageProviders === "function";
  const primaryHandler = hasBrowserAction ? onManageProviders : (onCommand ?? onReload);
  const primaryLabel = hasBrowserAction
    ? manageLabel
    : (commandLabel ?? "Run npm run provider:add");

  return (
    <div className="topic-panel grid gap-6 text-center sm:text-left" role="status" aria-live="polite">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
          {title ?? "No providers configured"}
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-arena-50 sm:text-3xl">
          {body ?? "Add at least one AI provider to start a match."}
        </h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-arena-300">
          The arena stores credentials locally. Configure one provider to enable matches — you can swap
          models freely between rounds.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
        <button
          type="button"
          onClick={primaryHandler}
          className="start-button"
        >
          <span>{primaryLabel}</span>
          <span aria-hidden="true" className="font-display text-base leading-none">
            {hasBrowserAction ? "+" : "↗"}
          </span>
        </button>
        {onReload ? (
          <button
            type="button"
            onClick={onReload}
            className="rounded-lg border border-white/10 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-arena-200 transition hover:border-white/25 hover:text-arena-50"
          >
            Retry
          </button>
        ) : null}
      </div>
      {hasBrowserAction ? (
        <p className="mx-auto w-full max-w-md text-[11px] leading-relaxed text-arena-300 sm:mx-0">
          Prefer the terminal?{" "}
          <code className="rounded border border-white/10 bg-arena-900/80 px-1.5 py-0.5 font-mono text-[11px] text-arena-100">
            npm run provider:add
          </code>{" "}
          is still available for scripted setups.
        </p>
      ) : (
        <pre className="mx-auto w-full max-w-md overflow-x-auto rounded-lg border border-white/10 bg-arena-900/80 px-4 py-3 text-left text-[12px] leading-relaxed text-arena-100">
          <code>npm run provider:add</code>
        </pre>
      )}
    </div>
  );
}
