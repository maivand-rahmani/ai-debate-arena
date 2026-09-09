"use client";

import type { RedactedProvider } from "@/shared/api/providers";
import type { TestState } from "./provider-actions";

interface ProviderRowProps {
  readonly provider: RedactedProvider;
  readonly test: TestState | undefined;
  readonly busy?: boolean;
  readonly onEdit: () => void;
  readonly onTest: () => void;
  readonly onDelete: () => void;
}

/**
 * One row in the provider list. The row is a self-contained card so the
 * user can edit / test / delete without leaving the modal. Inline test
 * state lives beneath the row metadata.
 */
export function ProviderRow({ provider, test, busy = false, onEdit, onTest, onDelete }: ProviderRowProps) {
  return (
    <article className="provider-row" aria-label={`Provider ${provider.name}`}>
      <header className="provider-row__head">
        <div className="provider-row__title">
          <h3 className="provider-row__name">{provider.name}</h3>
          <p className="provider-row__id" title={`Provider id: ${provider.id}`}>
            <span className="provider-row__id-label">id</span>
            <code>{provider.id}</code>
          </p>
        </div>
        <TestBadge test={test} />
      </header>

      <dl className="provider-row__details">
        <div>
          <dt>Base URL</dt>
          <dd className="provider-row__mono">{provider.baseUrl}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd className="provider-row__mono">{provider.model}</dd>
        </div>
        <div>
          <dt>API</dt>
          <dd>{provider.api === "responses" ? "responses" : "chat"}</dd>
        </div>
        <div>
          <dt>Key</dt>
          <dd className="provider-row__mono" title="API key hint (redacted)">
            {provider.apiKeyHint}
          </dd>
        </div>
      </dl>

      <TestDetail test={test} />

      <div className="provider-row__actions">
        <button type="button" onClick={onEdit} disabled={busy} className="provider-row__action">
          Edit
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={busy || test?.kind === "testing"}
          className="provider-row__action"
          aria-busy={test?.kind === "testing" ? true : undefined}
        >
          {test?.kind === "testing" ? "Testing…" : "Test connection"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="provider-row__action provider-row__action--danger"
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function TestBadge({ test }: { test: TestState | undefined }) {
  if (!test || test.kind === "idle") {
    return (
      <span className="provider-row__badge provider-row__badge--idle" aria-label="Test status unknown">
        <span aria-hidden="true" className="provider-row__badge-dot" />
        Not tested
      </span>
    );
  }
  if (test.kind === "testing") {
    return (
      <span className="provider-row__badge provider-row__badge--testing" aria-label="Testing connection">
        <span aria-hidden="true" className="provider-row__badge-dot provider-row__badge-dot--pulse" />
        Testing
      </span>
    );
  }
  if (test.kind === "ok") {
    return (
      <span className="provider-row__badge provider-row__badge--ok" aria-label={`OK in ${test.latencyMs} ms`}>
        <span aria-hidden="true">✓</span>
        OK · {test.latencyMs} ms
      </span>
    );
  }
  return (
    <span className="provider-row__badge provider-row__badge--failed" aria-label={`Failed: ${test.message}`}>
      <span aria-hidden="true">✕</span>
      Failed
    </span>
  );
}

function TestDetail({ test }: { test: TestState | undefined }) {
  if (!test) return null;
  if (test.kind === "ok") {
    return (
      <p className="provider-row__test-detail" role="status">
        Round-trip {test.latencyMs} ms — credentials accepted.
      </p>
    );
  }
  if (test.kind === "failed") {
    return (
      <p className="provider-row__test-detail provider-row__test-detail--failed" role="alert">
        <span className="provider-row__test-code">{test.code}</span> {test.message}
      </p>
    );
  }
  return null;
}
