"use client";

import { useId, useMemo, useState } from "react";
import type { RedactedProvider } from "@/shared/api/providers";
import {
  applyPositionChange,
  applyProviderChange,
  emptyDraft,
  isDraftReady,
  isSameModelMatchup,
  MODE_OPTIONS,
  TOPIC_MAX_LENGTH,
  validateDraft,
  type MatchDraft,
  type Position,
} from "@/features/create-debate/draft";
import { useProviders } from "@/features/create-debate/use-providers";
import { ProvidersEmptyState } from "@/features/create-debate/providers-empty-state";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/shared/ui/modal";
import { ManageProvidersModal } from "@/features/manage-providers";

interface SetupModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onStart: (draft: MatchDraft) => void;
  readonly busy?: boolean;
  readonly errorMessage?: string;
}

/**
 * Standard's optional settings are added to the draft by the wire lane. Keep
 * this view tolerant while that lane evolves; Quick does not need the extra
 * object at all.
 */
interface StandardDraftFields {
  readonly startingCredits?: number;
  readonly maxToolsPerMove?: number;
  readonly toolTimeoutMs?: number;
}

type SetupDraft = MatchDraft & { readonly standard?: StandardDraftFields };

const STANDARD_BUDGET_DEFAULTS = {
  startingCredits: 12,
  maxToolsPerMove: 2,
  toolTimeoutMs: 8_000,
} as const;

/**
 * The match-setup dialog opened from the idle hero. Reuses the
 * existing draft helpers + provider semantics from
 * `@/features/create-debate/draft` so the validation, position
 * mirroring, and provider-change behaviour all stay in one place.
 * The form layout is a condensed version of the old IdleSetup /
 * BroadcastConsole so it reads well inside the modal width.
 */
export function SetupModal({ open, onClose, onStart, busy = false, errorMessage }: SetupModalProps) {
  return (
    <Modal open={open} onClose={onClose} panelClassName="modal--wide">
      <SetupModalBody onClose={onClose} onStart={onStart} busy={busy} errorMessage={errorMessage} />
    </Modal>
  );
}

function SetupModalBody({ onClose, onStart, busy, errorMessage }: Omit<SetupModalProps, "open">) {
  const topicId = useId();
  const modeId = useId();
  const { status, providers, errorMessage: providerError, reload } = useProviders();
  const [userDraft, setUserDraft] = useState<SetupDraft | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const effectiveDraft = useMemo<SetupDraft>(() => {
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

  const applyChange = (mutator: (current: SetupDraft) => SetupDraft) => {
    setUserDraft((current) => mutator(current ?? effectiveDraft));
  };

  if (status === "error") {
    return (
      <>
        <ModalHeader eyebrow="New debate" title="Set the motion. Pick the contenders." />
        <ModalBody>
          <ProvidersEmptyState
            title="Could not load providers"
            body={providerError ?? "The provider endpoint is unreachable."}
            commandLabel="Retry"
            onCommand={reload}
            onManageProviders={() => setManageOpen(true)}
          />
        </ModalBody>
        <ModalFooter>
          <span />
          <button type="button" onClick={onClose} className="modal__ghost">Close</button>
        </ModalFooter>
        <ManageProvidersModal open={manageOpen} onClose={() => setManageOpen(false)} />
      </>
    );
  }

  if (status === "missing" || status === "idle" || status === "loading") {
    return (
      <>
        <ModalHeader eyebrow="New debate" title="Set the motion. Pick the contenders." />
        <ModalBody>
          <ProvidersEmptyState
            loading={status === "loading"}
            onReload={reload}
            onManageProviders={() => setManageOpen(true)}
          />
        </ModalBody>
        <ModalFooter>
          <span />
          <button type="button" onClick={onClose} className="modal__ghost">Close</button>
        </ModalFooter>
        <ManageProvidersModal open={manageOpen} onClose={() => setManageOpen(false)} />
      </>
    );
  }

  const issues = validateDraft(effectiveDraft);
  const ready = isDraftReady(effectiveDraft) && !busy;
  const sameModelMatchup = isSameModelMatchup(effectiveDraft);

  const updateTopic = (value: string) =>
    applyChange((current) => ({ ...current, topic: value.slice(0, TOPIC_MAX_LENGTH) }));
  const updateAProvider = (id: string) => applyChange((current) => applyProviderChange(current, "A", id, providers));
  const updateBProvider = (id: string) => applyChange((current) => applyProviderChange(current, "B", id, providers));
  const updateAModel = (model: string) => applyChange((current) => ({ ...current, sideA: { ...current.sideA, model } }));
  const updateBModel = (model: string) => applyChange((current) => ({ ...current, sideB: { ...current.sideB, model } }));
  const updateAPosition = (position: Position) => applyChange((current) => applyPositionChange(current, "A", position));
  const updateBPosition = (position: Position) =>
    applyChange((current) => applyPositionChange(current, "B", position, false));
  const updateMode = (mode: MatchDraft["mode"]) =>
    applyChange((current) => ({
      ...current,
      mode,
      ...(mode === "standard" && !current.standard ? { standard: STANDARD_BUDGET_DEFAULTS } : {}),
    }));
  const standardBudget = standardBudgetFor(effectiveDraft);
  const updateStandardBudget = (
    field: keyof typeof STANDARD_BUDGET_DEFAULTS,
    rawValue: string,
    min: number,
    max: number,
    multiplier = 1,
  ) => {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed)) return;
    const value = Math.min(max, Math.max(min, parsed)) * multiplier;
    applyChange((current) => ({
      ...current,
      standard: { ...standardBudgetFor(current), [field]: value },
    }));
  };

  const submit = () => {
    if (!ready) return;
    onStart(effectiveDraft);
  };

  return (
    <>
      <ModalHeader
        eyebrow="New debate"
        title="Set the motion. Pick the contenders."
        sub="Quick is a six-turn first look. Standard is open-ended: each agent can research, adapt, and show its evidence before speaking."
      />
      <ModalBody>
        <form
          className="setup-form"
          aria-busy={busy}
          aria-describedby={issues.length > 0 ? "setup-form-issues" : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <section className="setup-form__topic">
            <div className="setup-form__row-head">
              <label className="setup-form__eyebrow" htmlFor={topicId}>The motion</label>
              <span className="setup-form__counter">
                {effectiveDraft.topic.length}/{TOPIC_MAX_LENGTH}
              </span>
            </div>
            <textarea
              rows={2}
              id={topicId}
              maxLength={TOPIC_MAX_LENGTH}
              value={effectiveDraft.topic}
              onChange={(event) => updateTopic(event.target.value)}
              placeholder="Should AI-generated art be eligible for copyright?"
              className="setup-form__topic-textarea"
              aria-invalid={issues.some((issue) => issue.field === "topic") || undefined}
              aria-describedby={issues.some((issue) => issue.field === "topic") ? "setup-topic-error" : undefined}
            />
            {issues.some((issue) => issue.field === "topic") ? (
              <p id="setup-topic-error" className="setup-form__field-error">
                {issues.find((issue) => issue.field === "topic")?.message}
              </p>
            ) : null}
          </section>

          <div className="setup-form__contenders">
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

          {sameModelMatchup ? (
            <p className="setup-form__baseline" role="status">
              <strong>Baseline match.</strong> The same model will argue both sides with opposing positions. Start it for a clean reasoning control, or pick a second model for a head-to-head.
            </p>
          ) : null}

          <section className="setup-form__mode" aria-labelledby={modeId}>
            <span id={modeId} className="setup-form__eyebrow">Match mode</span>
            <div
              className="setup-form__mode-row"
              role="radiogroup"
              aria-labelledby={modeId}
              onKeyDown={(event) => {
                const modes = MODE_OPTIONS.filter((option) => option.enabled);
                const currentIndex = modes.findIndex((option) => option.id === effectiveDraft.mode);
                const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1 : direction ? (currentIndex + direction + modes.length) % modes.length : -1;
                if (nextIndex >= 0) {
                  event.preventDefault();
                  const nextMode = modes[nextIndex].id;
                  updateMode(nextMode);
                  window.requestAnimationFrame(() => document.getElementById(`setup-mode-${nextMode}`)?.focus());
                }
              }}
            >
              {MODE_OPTIONS.filter((option) => option.enabled).map((mode) => {
                const active = mode.id === effectiveDraft.mode;
                return (
                  <button
                    key={mode.id}
                    id={`setup-mode-${mode.id}`}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => updateMode(mode.id)}
                    className={`setup-form__mode-btn${active ? " is-active" : ""}`}
                  >
                    <span className="setup-form__mode-btn-title">{mode.label}</span>
                    <span className="setup-form__mode-btn-hint">{mode.hint}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {effectiveDraft.mode === "standard" ? (
            <section className="setup-form__budgets" aria-labelledby="standard-budget-title">
              <div className="setup-form__budgets-head">
                <div>
                  <span className="setup-form__eyebrow">03 · Standard budget</span>
                  <h3 id="standard-budget-title">Same rules for both.</h3>
                </div>
                <span className="setup-form__budgets-chip">Equal budgets</span>
              </div>
              <p className="setup-form__budgets-copy">
                Both agents get these exact limits. Credits last across the match; the tool limit resets on each move.
              </p>
              <div className="setup-form__budget-grid">
                <BudgetField
                  id="standard-starting-credits"
                  label="Credits available to each side"
                  hint="Spent on speeches and research calls."
                  value={standardBudget.startingCredits}
                  min={1}
                  max={64}
                  suffix="credits"
                  onChange={(value) => updateStandardBudget("startingCredits", value, 1, 64)}
                />
                <BudgetField
                  id="standard-tools-per-move"
                  label="Tool calls per move"
                  hint="Maximum research calls before an argument."
                  value={standardBudget.maxToolsPerMove}
                  min={0}
                  max={4}
                  suffix="max"
                  onChange={(value) => updateStandardBudget("maxToolsPerMove", value, 0, 4)}
                />
                <BudgetField
                  id="standard-tool-timeout"
                  label="Time allowed per tool"
                  hint="A failed call still appears in the public record."
                  value={standardBudget.toolTimeoutMs / 1_000}
                  min={1}
                  max={60}
                  suffix="sec"
                  onChange={(value) => updateStandardBudget("toolTimeoutMs", value, 1, 60, 1_000)}
                />
              </div>
            </section>
          ) : null}

          {errorMessage ? (
            <p className="setup-form__error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          {issues.length > 0 ? (
            <ul id="setup-form-issues" className="setup-form__issues" aria-label="Form issues" role="alert">
              {issues.map((issue) => (
                <li key={issue.field}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <div className="setup-form__foot-hint">
          <button type="button" onClick={() => setManageOpen(true)} className="setup-form__manage-link">
            Manage providers
          </button>
        </div>
        <div className="setup-form__actions">
          <button type="button" onClick={onClose} className="setup-form__cancel" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            aria-disabled={!ready}
            className="start-button"
          >
            <span>{busy ? "Starting…" : "Start match"}</span>
            <span aria-hidden="true" className="font-display" style={{ fontSize: "1.1rem", lineHeight: 1 }}>
              →
            </span>
          </button>
        </div>
      </ModalFooter>
      <ManageProvidersModal open={manageOpen} onClose={() => setManageOpen(false)} />
    </>
  );
}

interface BudgetFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly suffix: string;
  readonly hint?: string;
  readonly onChange: (value: string) => void;
}

function BudgetField({ id, label, value, min, max, suffix, hint, onChange }: BudgetFieldProps) {
  return (
    <label className="setup-form__field" htmlFor={id}>
      <span>{label}</span>
      {hint ? <small className="setup-form__field-hint">{hint}</small> : null}
      <span className="setup-form__budget-input-wrap">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="setup-form__input setup-form__budget-input"
        />
        <span className="setup-form__budget-suffix" aria-hidden="true">{suffix}</span>
      </span>
    </label>
  );
}

function standardBudgetFor(draft: SetupDraft) {
  return {
    startingCredits: boundedValue(draft.standard?.startingCredits, STANDARD_BUDGET_DEFAULTS.startingCredits, 1, 64),
    maxToolsPerMove: boundedValue(draft.standard?.maxToolsPerMove, STANDARD_BUDGET_DEFAULTS.maxToolsPerMove, 0, 4),
    toolTimeoutMs: boundedValue(draft.standard?.toolTimeoutMs, STANDARD_BUDGET_DEFAULTS.toolTimeoutMs, 1_000, 60_000),
  };
}

function boundedValue(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
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
  return (
    <section className={`setup-form__contender setup-form__contender--${tone}`} aria-label={identity}>
      <header className="setup-form__contender-head">
        <span className={`setup-form__contender-mark setup-form__contender-mark--${tone}`}>{side}</span>
        <div>
          <p className="setup-form__contender-sub">Contender {side}</p>
          <h3 className="setup-form__contender-title">{identity}</h3>
        </div>
      </header>

      <div className="setup-form__contender-grid">
        <label className="setup-form__field">
          <span>Provider</span>
          <select
            value={providerId}
            onChange={(event) => onProviderChange(event.target.value)}
            className="setup-form__input"
          >
            {providers.length === 0 ? <option value="">No providers</option> : null}
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label className="setup-form__field">
          <span>Model</span>
          <input
            type="text"
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            placeholder="e.g. gpt-4o"
            autoComplete="off"
            spellCheck={false}
            className="setup-form__input"
          />
        </label>
      </div>

      <div
        className="setup-form__position"
        role="radiogroup"
        aria-label={`${identity} position`}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const nextPosition = position === "FOR" ? "AGAINST" : "FOR";
          onPositionChange(nextPosition);
          window.requestAnimationFrame(() => document.getElementById(`setup-position-${side}-${nextPosition}`)?.focus());
        }}
      >
        <span className="setup-form__field-label">Position</span>
        <div className="setup-form__position-row">
          {(["FOR", "AGAINST"] as const).map((option) => {
            const active = option === position;
            return (
              <button
                key={option}
                id={`setup-position-${side}-${option}`}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onPositionChange(option)}
                className={`setup-form__position-btn setup-form__position-btn--${tone}${active ? " is-active" : ""}`}
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
