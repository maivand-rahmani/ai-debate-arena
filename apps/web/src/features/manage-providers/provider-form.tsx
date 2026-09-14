"use client";

import { useId, useState } from "react";
import {
  buildUpdatePayload,
  emptyProviderDraft,
  validateProviderDraft,
  type ProviderDraft,
} from "./provider-actions";
import type {
  ProviderApi,
  ProviderCreateInput,
  ProviderUpdateInput,
  ValidationIssue,
} from "@/shared/api/providers";

export interface ProviderFormSubmission {
  readonly draft: ProviderDraft;
  readonly payload: ProviderCreateInput | ProviderUpdateInput;
}

interface ProviderFormProps {
  readonly mode: "create" | "edit";
  readonly initial?: ProviderDraft;
  /** Server-side issues to overlay onto the field errors (e.g. from 400). */
  readonly serverIssues?: readonly ValidationIssue[];
  readonly busy?: boolean;
  readonly submitLabel: string;
  readonly onCancel: () => void;
  readonly onSubmit: (submission: ProviderFormSubmission) => void;
}

/**
 * The add / edit form for a single provider. Local state holds the draft
 * so the user can edit freely; the form reports validation issues
 * (combining client + server) and only sends a payload to `onSubmit`
 * when the draft is internally valid.
 */
export function ProviderForm({
  mode,
  initial,
  serverIssues = [],
  busy = false,
  submitLabel,
  onCancel,
  onSubmit,
}: ProviderFormProps) {
  const [draft, setDraft] = useState<ProviderDraft>(initial ?? emptyProviderDraft());
  const idIds = {
    id: useId(),
    name: useId(),
    baseUrl: useId(),
    model: useId(),
    api: useId(),
    apiKey: useId(),
  };
  const [showKey, setShowKey] = useState(false);

  const clientIssues = validateProviderDraft(draft, mode);
  const knownFields = ["id", "name", "baseUrl", "model", "api", "apiKey"] as const;
  const fieldErrors: Record<string, string> = {};
  for (const issue of clientIssues) {
    if (!fieldErrors[issue.field]) fieldErrors[issue.field] = issue.message;
  }
  for (const issue of serverIssues) {
    if (!fieldErrors[issue.field]) fieldErrors[issue.field] = issue.message;
  }
  const genericErrors: string[] = serverIssues
    .filter((issue) => !knownFields.includes(issue.field as (typeof knownFields)[number]))
    .map((issue) => issue.message);

  const ready = clientIssues.length === 0;

  const update = (patch: Partial<ProviderDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || busy) return;
    if (mode === "create") {
      onSubmit({
        draft,
        payload: {
          id: draft.id.trim(),
          name: draft.name.trim(),
          baseUrl: draft.baseUrl.trim(),
          model: draft.model.trim(),
          api: draft.api,
          apiKey: draft.apiKey,
        },
      });
    } else {
      onSubmit({ draft, payload: buildUpdatePayload(draft) });
    }
  };

  return (
    <form className="provider-form" onSubmit={handleSubmit} aria-busy={busy} noValidate>
      <div className="provider-form__grid">
        {mode === "create" ? (
          <Field
            id={idIds.id}
            label="Id"
            hint="Slug used in URLs. Letters, numbers, dashes, underscores."
            value={draft.id}
            error={fieldErrors.id}
            onChange={(value) => update({ id: value })}
            placeholder="alpha"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        ) : null}
        <Field
          id={idIds.name}
          label="Display name"
          value={draft.name}
          error={fieldErrors.name}
          onChange={(value) => update({ name: value })}
          placeholder="Alpha OpenAI"
          autoComplete="off"
          disabled={busy}
        />
        <Field
          id={idIds.baseUrl}
          label="Base URL"
          hint="Full URL, including the /v1 path. http or https only."
          value={draft.baseUrl}
          error={fieldErrors.baseUrl}
          onChange={(value) => update({ baseUrl: value })}
          placeholder="https://api.openai.com/v1"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <Field
          id={idIds.model}
          label="Default model"
          value={draft.model}
          error={fieldErrors.model}
          onChange={(value) => update({ model: value })}
          placeholder="gpt-4o-mini"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <SelectField
          id={idIds.api}
          label="API type"
          value={draft.api}
          onChange={(value) => update({ api: value as ProviderApi })}
          options={[
            { value: "chat", label: "Chat completions (chat)" },
            { value: "responses", label: "Responses (responses)" },
          ]}
          error={fieldErrors.api}
          disabled={busy}
        />
        <div className="provider-form__key">
          <label htmlFor={idIds.apiKey} className="provider-form__label">
            <span>API key</span>
            {mode === "edit" ? (
              <span className="provider-form__label-hint">Leave empty to keep the current key.</span>
            ) : null}
          </label>
          <div className="provider-form__key-input">
            <input
              id={idIds.apiKey}
              type={showKey ? "text" : "password"}
              value={draft.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
              placeholder={mode === "edit" ? "••••••••" : "sk-..."}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              className={`provider-form__input ${fieldErrors.apiKey ? "is-invalid" : ""}`}
              aria-invalid={fieldErrors.apiKey ? true : undefined}
              aria-describedby={fieldErrors.apiKey ? `${idIds.apiKey}-error` : undefined}
            />
            <button
              type="button"
              className="provider-form__key-toggle"
              onClick={() => setShowKey((value) => !value)}
              aria-pressed={showKey}
              aria-label={showKey ? "Hide API key" : "Show API key"}
              disabled={busy}
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          {fieldErrors.apiKey ? (
            <p id={`${idIds.apiKey}-error`} className="provider-form__error" role="alert">
              {fieldErrors.apiKey}
            </p>
          ) : null}
        </div>
      </div>

      {genericErrors.length > 0 ? (
        <ul className="provider-form__generic" role="alert">
          {genericErrors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : null}

      <div className="provider-form__actions">
        <button
          type="button"
          className="provider-form__cancel"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className="start-button" disabled={!ready || busy}>
          <span>{busy ? "Saving…" : submitLabel}</span>
          <span aria-hidden="true" className="font-display" style={{ fontSize: "1.1rem", lineHeight: 1 }}>
            →
          </span>
        </button>
      </div>
    </form>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly autoComplete?: string;
  readonly spellCheck?: boolean;
  readonly disabled?: boolean;
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  autoComplete = "off",
  spellCheck = false,
  disabled = false,
}: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className="provider-form__field">
      <label htmlFor={id} className="provider-form__label">
        <span>{label}</span>
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        disabled={disabled}
        className={`provider-form__input ${error ? "is-invalid" : ""}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
      />
      {hint && !error ? <p id={hintId} className="provider-form__hint">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="provider-form__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface SelectFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly error?: string;
  readonly disabled?: boolean;
}

function SelectField({ id, label, value, onChange, options, error, disabled }: SelectFieldProps) {
  return (
    <div className="provider-form__field">
      <label htmlFor={id} className="provider-form__label">
        <span>{label}</span>
      </label>
      <div className="provider-form__select-wrap">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={`provider-form__input provider-form__input--select ${error ? "is-invalid" : ""}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="provider-form__select-caret">⌄</span>
      </div>
      {error ? <p id={`${id}-error`} className="provider-form__error" role="alert">{error}</p> : null}
    </div>
  );
}
