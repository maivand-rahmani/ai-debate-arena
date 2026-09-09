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
 * The match-setup dialog opened from the idle hero. Reuses the
 * existing draft helpers + provider semantics from
 * `@/features/create-debate/draft` so the validation, position
 * mirroring, and provider-change behaviour all stay in one place.
 * The form layout is a condensed version of the old IdleSetup /
 * BroadcastConsole so it reads well inside the modal width.
 */
export function SetupModal({ open, onClose, onStart, busy = false, errorMessage }: SetupModalProps) {
  return (
    <Modal open={open} onClose={onClose} panelClassName="modal--wide" ariaLabel="Set up a debate">
      <SetupModalBody onClose={onClose} onStart={onStart} busy={busy} errorMessage={errorMessage} />
    </Modal>
  );
}

function SetupModalBody({ onClose, onStart, busy, errorMessage }: Omit<SetupModalProps, "open">) {
  const titleId = useId();
  const { status, providers, errorMessage: providerError, reload } = useProviders();
  const [userDraft, setUserDraft] = useState<MatchDraft | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

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

  const updateTopic = (value: string) =>
    applyChange((current) => ({ ...current, topic: value.slice(0, TOPIC_MAX_LENGTH) }));
  const updateAProvider = (id: string) => applyChange((current) => applyProviderChange(current, "A", id, providers));
  const updateBProvider = (id: string) => applyChange((current) => applyProviderChange(current, "B", id, providers));
  const updateAModel = (model: string) => applyChange((current) => ({ ...current, sideA: { ...current.sideA, model } }));
  const updateBModel = (model: string) => applyChange((current) => ({ ...current, sideB: { ...current.sideB, model } }));
  const updateAPosition = (position: Position) => applyChange((current) => applyPositionChange(current, "A", position));
  const updateBPosition = (position: Position) =>
    applyChange((current) => applyPositionChange(current, "B", position, false));

  const submit = () => {
    if (!ready) return;
    onStart(effectiveDraft);
  };

  return (
    <>
      <ModalHeader
        eyebrow="New debate"
        title="Set the motion. Pick the contenders."
        sub="Choose a topic and two contrasting models. The stage, lighting, and Judge power on automatically when you press Start."
      />
      <ModalBody>
        <form
          className="setup-form"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          aria-labelledby={titleId}
        >
          <section className="setup-form__topic">
            <div className="setup-form__row-head">
              <span className="setup-form__eyebrow">01 · The motion</span>
              <span className="setup-form__counter">
                {effectiveDraft.topic.length}/{TOPIC_MAX_LENGTH}
              </span>
            </div>
            <textarea
              rows={2}
              maxLength={TOPIC_MAX_LENGTH}
              value={effectiveDraft.topic}
              onChange={(event) => updateTopic(event.target.value)}
              placeholder="Should AI-generated art be eligible for copyright?"
              className="setup-form__topic-textarea"
            />
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

          <section className="setup-form__mode" aria-label="Match mode">
            <span className="setup-form__eyebrow">02 · Match mode</span>
            <div className="setup-form__mode-row" role="radiogroup" aria-label="Match mode">
              {MODE_OPTIONS.map((mode) => {
                const active = mode.id === "quick";
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!mode.enabled}
                    className={`setup-form__mode-btn${active ? " is-active" : ""}`}
                  >
                    <span className="setup-form__mode-btn-title">{mode.label}</span>
                    <span className="setup-form__mode-btn-hint">{mode.hint}</span>
                    {!mode.enabled ? (
                      <span className="setup-form__mode-chip">Coming soon</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          {errorMessage ? (
            <p className="setup-form__error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          {issues.length > 0 ? (
            <ul className="setup-form__issues" aria-label="Form issues">
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
    <section className={`setup-form__contender setup-form__contender--${tone}`} aria-label={`Contender ${side}`}>
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

      <div className="setup-form__position" role="radiogroup" aria-label="Position">
        <span className="setup-form__field-label">Position</span>
        <div className="setup-form__position-row">
          {(["FOR", "AGAINST"] as const).map((option) => {
            const active = option === position;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
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
