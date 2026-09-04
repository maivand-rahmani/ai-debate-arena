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
} from "./draft";
import { ProvidersEmptyState } from "./providers-empty-state";
import { useProviders } from "./use-providers";

interface SetupFormProps {
  readonly onStart: (draft: MatchDraft) => void;
  readonly busy?: boolean;
}

export function SetupForm({ onStart, busy = false }: SetupFormProps) {
  const { status, providers, errorMessage, reload } = useProviders();
  // `userDraft` is null until the user actually edits the form. Until then,
  // `effectiveDraft` is derived from the loaded providers so the form renders
  // sensible defaults without forcing a synchronous setState inside an effect.
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
        body={errorMessage ?? "The provider endpoint is unreachable."}
        commandLabel="Retry"
        onCommand={reload}
      />
    );
  }

  if (status === "missing" || status === "idle" || status === "loading") {
    return <ProvidersEmptyState loading={status === "loading"} onReload={reload} />;
  }

  const issues = validateDraft(effectiveDraft);
  const ready = isDraftReady(effectiveDraft) && !busy && status === "ready";

  const updateTopic = (value: string) =>
    applyChange((current) => ({ ...current, topic: value.slice(0, TOPIC_MAX_LENGTH) }));
  const updateAProvider = (id: string) => applyChange((current) => applyProviderChange(current, "A", id, providers));
  const updateBProvider = (id: string) => applyChange((current) => applyProviderChange(current, "B", id, providers));
  const updateAModel = (model: string) => applyChange((current) => ({ ...current, sideA: { ...current.sideA, model } }));
  const updateBModel = (model: string) => applyChange((current) => ({ ...current, sideB: { ...current.sideB, model } }));
  const updateAPosition = (position: Position) => applyChange((current) => applyPositionChange(current, "A", position));
  const updateBPosition = (position: Position) =>
    applyChange((current) => applyPositionChange(current, "B", position, /* mirror */ false));

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    onStart(effectiveDraft);
  };

  return (
    <form onSubmit={submit} className="grid gap-8" aria-busy={busy}>
      <TopicField value={effectiveDraft.topic} onChange={updateTopic} />
      <div className="grid gap-6 lg:grid-cols-2">
        <AgentCard
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
        <AgentCard
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
      <Issues issues={issues} />
      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <p className="max-w-md text-xs text-arena-300">
          Pick two contrasting models, press start, then sit back as the arguments unfold.
        </p>
        <button type="submit" disabled={!ready} className="start-button">
          <span>{busy ? "Starting…" : "Start match"}</span>
          <span aria-hidden="true" className="font-display text-base leading-none">
            →
          </span>
        </button>
      </div>
    </form>
  );
}

// --- Sub-components ---------------------------------------------------------

function TopicField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <section className="topic-panel" aria-labelledby={`${id}-label`}>
      <div className="mb-4 flex items-center justify-between">
        <label
          id={`${id}-label`}
          htmlFor={id}
          className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200"
        >
          01 · The motion
        </label>
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-arena-300">
          {value.length}/{TOPIC_MAX_LENGTH}
        </span>
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        maxLength={TOPIC_MAX_LENGTH}
        placeholder="Should AI-generated art be eligible for copyright?"
        className="block w-full resize-none border-0 bg-transparent font-display text-2xl font-bold leading-snug tracking-tight text-arena-50 placeholder:text-arena-400 focus:outline-none sm:text-3xl"
      />
    </section>
  );
}

interface AgentCardProps {
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

function AgentCard({
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
}: AgentCardProps) {
  const titleId = useId();
  return (
    <section
      className={`agent-card ${tone === "coral" ? "agent-coral" : "agent-violet"}`}
      aria-labelledby={titleId}
    >
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="agent-mark" aria-hidden="true">
            {side}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-300">
              Contender {side}
            </p>
            <h3 id={titleId} className="mt-1 font-display text-xl font-bold text-arena-50">
              {identity}
            </h3>
          </div>
        </div>
        <span
          aria-hidden="true"
          className={`mt-1 h-2 w-2 rounded-full ${
            tone === "coral" ? "bg-arena-coral-300" : "bg-arena-violet-300"
          } opacity-80`}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Provider"
          value={providerId}
          onChange={onProviderChange}
          options={providers.map((provider) => ({ value: provider.id, label: provider.name }))}
        />
        <TextField label="Model" value={model} onChange={onModelChange} placeholder="e.g. gpt-4o" />
      </div>
      <div className="mt-5">
        <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-arena-300">
          Position
        </span>
        <PositionToggle tone={tone} value={position} onChange={onPositionChange} />
      </div>
    </section>
  );
}

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface SelectFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
}

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  const id = useId();
  return (
    <label htmlFor={id} className="relative block">
      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-arena-300">
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full appearance-none rounded-lg border border-white/10 bg-white/[0.06] px-3.5 text-sm text-arena-50 outline-none transition hover:border-white/25 focus:border-arena-coral-300 focus:ring-2 focus:ring-arena-coral-300/20"
      >
        {options.length === 0 ? <option value="">No providers</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-arena-700 text-arena-50">
            {option.label}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-4 top-[39px] text-arena-300">
        ⌄
      </span>
    </label>
  );
}

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}

function TextField({ label, value, onChange, placeholder }: TextFieldProps) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-arena-300">
        {label}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 text-sm text-arena-50 placeholder:text-arena-400 outline-none transition hover:border-white/25 focus:border-arena-coral-300 focus:ring-2 focus:ring-arena-coral-300/20"
      />
    </label>
  );
}

function PositionToggle({
  tone,
  value,
  onChange,
}: {
  tone: "coral" | "violet";
  value: Position;
  onChange: (value: Position) => void;
}) {
  const groupId = useId();
  return (
    <div role="radiogroup" id={groupId} aria-label="Position" className="flex gap-2">
      {(["FOR", "AGAINST"] as const).map((option) => {
        const active = option === value;
        const toneClass = active
          ? tone === "coral"
            ? "border-arena-coral-300/70 bg-arena-coral-300/15 text-arena-coral-100"
            : "border-arena-violet-300/70 bg-arena-violet-300/15 text-arena-violet-100"
          : "border-white/[0.08] bg-white/[0.025] text-arena-300 hover:bg-white/[0.07]";
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`flex-1 rounded-lg border py-2.5 text-xs font-semibold tracking-[0.14em] uppercase transition ${toneClass}`}
          >
            {option === "FOR" ? "For" : "Against"}
          </button>
        );
      })}
    </div>
  );
}

function ModeRow() {
  return (
    <section className="topic-panel" aria-label="Match mode">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-arena-coral-200">
          02 · Match mode
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-arena-300">
          Quick enabled · others coming soon
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {MODE_OPTIONS.map((mode) => (
          <button
            key={mode.id}
            type="button"
            disabled={!mode.enabled}
            aria-pressed={mode.id === "quick"}
            className={`flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition ${
              mode.id === "quick"
                ? "border-arena-coral-300/50 bg-arena-coral-300/10 text-arena-50"
                : "border-white/[0.07] bg-white/[0.02] text-arena-300"
            } ${mode.enabled ? "hover:border-white/25" : "cursor-not-allowed opacity-55"}`}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${mode.id === "quick" ? "bg-arena-coral-300" : "bg-arena-300"}`}
              />
              <span className="font-display text-sm font-bold tracking-tight">{mode.label}</span>
              {!mode.enabled ? (
                <span className="ml-1 rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-arena-300">
                  Coming soon
                </span>
              ) : null}
            </span>
            <span className="text-[11px] leading-snug text-arena-300">{mode.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Issues({ issues }: { issues: readonly { field: string; message: string }[] }) {
  if (issues.length === 0) return null;
  return (
    <ul role="list" className="flex flex-wrap gap-2 text-[11px] text-arena-coral-200" aria-label="Form issues">
      {issues.map((issue) => (
        <li
          key={issue.field}
          className="rounded-full border border-arena-coral-300/30 bg-arena-coral-300/10 px-3 py-1 uppercase tracking-[0.16em]"
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
