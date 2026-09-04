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

interface IdleSetupProps {
  readonly onStart: (draft: MatchDraft) => void;
  readonly errorMessage?: string;
  readonly busy?: boolean;
}

/**
 * The integrated setup panel that lives inside the broadcast stage's idle
 * state. The topic input, the two contender cards, the Quick mode pill,
 * the validation issues, and the Start Match button all sit on the same
 * surface that becomes the live arena once a match starts. The behavior
 * mirrors the existing `SetupForm` (same draft helpers, validation, and
 * provider semantics) — only the presentation changes.
 */
export function IdleSetup({ onStart, errorMessage, busy = false }: IdleSetupProps) {
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
        title="Could not load providers"
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
    applyChange((current) => applyPositionChange(current, "B", position, /* mirror */ false));

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    onStart(effectiveDraft);
  };

  return (
    <form className="idle-setup" onSubmit={submit} aria-busy={busy} aria-label="Match setup">
      <header className="idle-setup__head">
        <p className="idle-setup__eyebrow">Tonight on the Arena</p>
        <h2 className="idle-setup__title">Set the motion. Pick the contenders. Roll tape.</h2>
        <p className="idle-setup__sub">
          Choose a topic and two contrasting models. The stage, lighting,
          and Judge power on automatically when you press Start.
        </p>
      </header>

      {errorMessage ? (
        <div className="idle-setup__error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <div className="idle-setup__topic">
        <label className="idle-setup__topic-label" htmlFor="idle-topic">
          <span>01 · The motion</span>
          <span>{effectiveDraft.topic.length}/{TOPIC_MAX_LENGTH}</span>
        </label>
        <textarea
          id="idle-topic"
          rows={2}
          maxLength={TOPIC_MAX_LENGTH}
          value={effectiveDraft.topic}
          onChange={(event) => updateTopic(event.target.value)}
          placeholder="Should AI-generated art be eligible for copyright?"
          className="idle-setup__topic-textarea"
        />
      </div>

      <div className="idle-setup__contenders">
        <ContenderCard
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
        <ContenderCard
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

      <div className="idle-setup__footer">
        <p className="idle-setup__hint">
          Pick two contrasting models and a sharp motion — the strongest
          arguments emerge from the friction.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-end" }}>
          {issues.length > 0 ? (
            <ul className="idle-setup__issues" aria-label="Form issues">
              {issues.map((issue) => (
                <li key={issue.field}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
          <button type="submit" disabled={!ready} className="start-button" aria-disabled={!ready}>
            <span>{busy ? "Starting…" : "Start match"}</span>
            <span aria-hidden="true" className="font-display" style={{ fontSize: "1.1rem", lineHeight: 1 }}>
              →
            </span>
          </button>
        </div>
      </div>
    </form>
  );
}

interface ContenderCardProps {
  readonly side: "A" | "B";
  readonly tone: "coral" | "violet";
  readonly identity: string;
  readonly providers: readonly RedactedProvider[];
  readonly providerId: string;
  readonly model: string;
  readonly position: Position;
  readonly onProviderChange: (providerId: string) => void;
  readonly onModelChange: (model: string) => void;
  readonly onPositionChange: (position: Position) => void;
}

function ContenderCard({
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
}: ContenderCardProps) {
  const selectId = useId();
  const modelId = useId();
  return (
    <section className={`contender-card contender-card--${tone}`} aria-label={`Contender ${side}`}>
      <div className="contender-card__head">
        <div className="contender-card__head-left">
          <span className="contender-card__mark" aria-hidden="true">{side}</span>
          <div>
            <p className="contender-card__sub">Contender {side}</p>
            <h3 className="contender-card__title">{identity}</h3>
          </div>
        </div>
        <span className="contender-card__swatch" aria-hidden="true" />
      </div>

      <div className="contender-card__grid">
        <div className="contender-card__field">
          <label htmlFor={selectId} className="contender-card__field-label">Provider</label>
          <select
            id={selectId}
            value={providerId}
            onChange={(event) => onProviderChange(event.target.value)}
            className="contender-card__field-select"
          >
            {providers.length === 0 ? <option value="">No providers</option> : null}
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>
        <div className="contender-card__field">
          <label htmlFor={modelId} className="contender-card__field-label">Model</label>
          <input
            id={modelId}
            type="text"
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            placeholder="e.g. gpt-4o"
            autoComplete="off"
            spellCheck={false}
            className="contender-card__field-input"
          />
        </div>
      </div>

      <div>
        <span className="contender-card__field-label" style={{ marginBottom: "6px", display: "block" }}>Position</span>
        <div className="contender-card__position" role="radiogroup" aria-label="Position">
          {(["FOR", "AGAINST"] as const).map((option) => {
            const active = option === position;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPositionChange(option)}
                className="contender-card__position-btn"
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

function ModeRow() {
  return (
    <div className="idle-setup__mode" role="radiogroup" aria-label="Match mode">
      {MODE_OPTIONS.map((mode) => {
        const active = mode.id === "quick";
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={!mode.enabled}
            className="idle-setup__mode-btn"
          >
            <span className="idle-setup__mode-btn-title">{mode.label}</span>
            <span className="idle-setup__mode-btn-hint">{mode.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
