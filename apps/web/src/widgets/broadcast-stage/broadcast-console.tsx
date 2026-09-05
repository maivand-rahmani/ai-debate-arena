"use client";

import { useId, useMemo, useState } from "react";
import type { RedactedProvider } from "@/shared/api/providers";
import {
  applyPositionChange,
  applyProviderChange,
  emptyDraft,
  isDraftReady,
  MODE_OPTIONS,
  TOPIC_MAX_LENGTH,
  validateDraft,
  type MatchDraft,
  type Position,
} from "@/features/create-debate/draft";
import { ProvidersEmptyState } from "@/features/create-debate/providers-empty-state";
import { useProviders } from "@/features/create-debate/use-providers";

interface BroadcastConsoleProps {
  readonly onStart: (draft: MatchDraft) => void;
  readonly errorMessage?: string;
  readonly busy?: boolean;
}

/**
 * The 3D-aware idle console that replaces {@link IdleSetup} when the
 * R3F canvas is rendering. Same draft logic + draft helpers + provider
 * semantics — only the presentation changes:
 *
 *   - A show-desk panel ("broadcast-console") framing the form so it
 *     reads as belonging to the studio rather than the v0.2 dashboard.
 *   - The Topic input is rendered as a marquee-style headline (the same
 *     surface the speech teleprompter anchors to).
 *   - Provider + model + position controls are chips laid out as if a
 *     stage manager were filling out a sound-check sheet.
 *
 * Keyboard accessibility preserved: every chip wraps a real
 * `<button type="button">` or `<input>` so screen-reader order + tab focus
 * behave like the original IdleSetup (just inside a richer chrome).
 *
 * The 2D BroadcastStage keeps rendering the original IdleSetup in the
 * no-WebGL fallback (see `broadcast-stage.tsx`).
 */
export function BroadcastConsole({
  onStart,
  errorMessage,
  busy = false,
}: BroadcastConsoleProps) {
  const { status, providers, errorMessage: providerError, reload } = useProviders();
  const [userDraft, setUserDraft] = useState<MatchDraft | null>(null);

  const effectiveDraft = useMemo<MatchDraft>(() => {
    if (userDraft !== null) return userDraft;
    if (status !== "ready" || providers.length === 0) return emptyDraft();
    const a = providers[0];
    const b = providers[1] ?? providers[0];
    return {
      topic: "",
      mode: "quick",
      sideA: { providerId: a.id, model: a.model, position: "FOR" },
      sideB: { providerId: b.id, model: b.model, position: "AGAINST" },
    };
  }, [userDraft, providers, status]);

  const applyChange = (mutator: (current: MatchDraft) => MatchDraft) => {
    setUserDraft((current) => mutator(current ?? effectiveDraft));
  };

  if (status === "error") {
    return (
      <ProvidersEmptyState
        title="Show desk offline"
        body={providerError ?? "The provider endpoint is unreachable."}
        commandLabel="Retry"
        onCommand={reload}
      />
    );
  }
  if (status === "missing" || status === "idle" || status === "loading") {
    return <ProvidersEmptyState loading={status === "loading"} onReload={reload} />;
  }

  const issues = validateDraft(effectiveDraft);
  const ready = isDraftReady(effectiveDraft) && !busy;

  const updateTopic = (value: string) =>
    applyChange((current) => ({ ...current, topic: value.slice(0, TOPIC_MAX_LENGTH) }));
  const updateAProvider = (id: string) =>
    applyChange((current) => applyProviderChange(current, "A", id, providers));
  const updateBProvider = (id: string) =>
    applyChange((current) => applyProviderChange(current, "B", id, providers));
  const updateAModel = (model: string) =>
    applyChange((current) => ({ ...current, sideA: { ...current.sideA, model } }));
  const updateBModel = (model: string) =>
    applyChange((current) => ({ ...current, sideB: { ...current.sideB, model } }));
  const updateAPosition = (position: Position) =>
    applyChange((current) => applyPositionChange(current, "A", position));
  const updateBPosition = (position: Position) =>
    applyChange((current) => applyPositionChange(current, "B", position, false));

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    onStart(effectiveDraft);
  };

  return (
    <form className="broadcast-console" aria-label="Match console" onSubmit={submit}>
      <div className="broadcast-console__panel" role="group" aria-label="Topic">
        <header className="broadcast-console__panel-head">
          <span className="broadcast-console__eyebrow">{"Tonight\u2019s motion"}</span>
          <h2 className="broadcast-console__panel-title">Open the show</h2>
        </header>
        <ConsoleTopicInput value={effectiveDraft.topic} onChange={updateTopic} />
      </div>

      <div className="broadcast-console__row">
        <ContenderChip
          side="A"
          tone="coral"
          identity="The Challenger"
          providers={providers}
          providerId={effectiveDraft.sideA.providerId}
          model={effectiveDraft.sideA.model}
          position={effectiveDraft.sideA.position}
          onProviderChange={updateAProvider}
          onModelChange={updateAModel}
          onPositionChange={updateAPosition}
        />
        <ContenderChip
          side="B"
          tone="violet"
          identity="The Advocate"
          providers={providers}
          providerId={effectiveDraft.sideB.providerId}
          model={effectiveDraft.sideB.model}
          position={effectiveDraft.sideB.position}
          onProviderChange={updateBProvider}
          onModelChange={updateBModel}
          onPositionChange={updateBPosition}
        />
      </div>

      <ModeRow />

      <div className="broadcast-console__footer">
        <p className="broadcast-console__hint">
          Two contrasting models + a sharp motion — the strongest arguments emerge from the friction.
        </p>
        <div className="broadcast-console__cta">
          {issues.length > 0 ? (
            <ul className="broadcast-console__issues" aria-label="Form issues">
              {issues.map((issue) => (
                <li key={issue.field}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
          <div className="broadcast-console__form">
            {errorMessage ? (
              <div className="broadcast-console__error" role="alert">
                {errorMessage}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={!ready}
              aria-disabled={!ready}
              className="start-button broadcast-console__start"
            >
              <span>{busy ? "Starting…" : "Start match"}</span>
              <span aria-hidden="true" className="font-display" style={{ fontSize: "1.1rem", lineHeight: 1 }}>
                →
              </span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

/* --- topic input --------------------------------------------------------- */

function ConsoleTopicInput({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="broadcast-console__topic-label">
      <span className="sr-only">Topic</span>
      <textarea
        id={id}
        rows={2}
        maxLength={TOPIC_MAX_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Should AI-generated art be eligible for copyright?"
        className="broadcast-console__topic-textarea"
      />
    </label>
  );
}

/* --- contender chip ----------------------------------------------------- */

interface ContenderChipProps {
  readonly side: "A" | "B";
  readonly tone: "coral" | "violet";
  readonly identity: string;
  readonly providers: readonly RedactedProvider[];
  readonly providerId: string;
  readonly model: string;
  readonly position: Position;
  readonly onProviderChange: (id: string) => void;
  readonly onModelChange: (model: string) => void;
  readonly onPositionChange: (position: Position) => void;
}

function ContenderChip({
  side,
  tone,
  identity,
  providers,
  providerId,
  model,
  position,
  onProviderChange,
  onModelChange,
  onPositionChange,
}: ContenderChipProps) {
  const selectId = useId();
  const modelId = useId();
  return (
    <section
      className={`broadcast-console__chip broadcast-console__chip--${tone}`}
      aria-label={`Contender ${side}`}
    >
      <header className="broadcast-console__chip-head">
        <span className={`broadcast-console__chip-mark broadcast-console__chip-mark--${tone}`}>
          {side}
        </span>
        <div>
          <p className="broadcast-console__chip-sub">Contender {side}</p>
          <h3 className="broadcast-console__chip-title">{identity}</h3>
        </div>
      </header>

      <div className="broadcast-console__chip-grid">
        <label htmlFor={selectId} className="broadcast-console__chip-field">
          <span>Provider</span>
          <select
            id={selectId}
            value={providerId}
            onChange={(event) => onProviderChange(event.target.value)}
            className="broadcast-console__chip-input"
          >
            {providers.length === 0 ? <option value="">No providers</option> : null}
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={modelId} className="broadcast-console__chip-field">
          <span>Model</span>
          <input
            id={modelId}
            type="text"
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            placeholder="e.g. gpt-4o"
            autoComplete="off"
            spellCheck={false}
            className="broadcast-console__chip-input"
          />
        </label>
      </div>

      <div className="broadcast-console__chip-position" role="radiogroup" aria-label="Position">
        <span className="broadcast-console__chip-field-label">Position</span>
        <div className="broadcast-console__chip-position-row">
          {(["FOR", "AGAINST"] as const).map((option) => {
            const active = option === position;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPositionChange(option)}
                className={`broadcast-console__chip-position-btn broadcast-console__chip-position-btn--${tone}${active ? " is-active" : ""}`}
              >
                {option === "FOR" ? "For" : "Against"}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* --- mode row ----------------------------------------------------------- */

function ModeRow() {
  return (
    <div className="broadcast-console__mode" role="radiogroup" aria-label="Match mode">
      {MODE_OPTIONS.map((mode) => {
        const active = mode.id === "quick";
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={!mode.enabled}
            className="broadcast-console__mode-btn"
          >
            <span className="broadcast-console__mode-btn-title">{mode.label}</span>
            <span className="broadcast-console__mode-btn-hint">{mode.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
