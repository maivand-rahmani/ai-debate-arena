"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import {
  ProvidersUnavailableError,
  createProvider,
  deleteProvider,
  testProvider,
  updateProvider,
  type ProviderCreateInput,
  type ProviderUpdateInput,
  type RedactedProvider,
  type ValidationIssue,
} from "@/shared/api/providers";
import { useProviders } from "@/features/create-debate/use-providers";
import { Modal, ModalBody as ModalBodySlot, ModalFooter, ModalHeader } from "@/shared/ui/modal";
import {
  draftFromProvider,
  emptyProviderDraft,
  initialTests,
  testsReducer,
  validateProviderDraft,
  type ProviderDraft,
  type TestState,
} from "./provider-actions";
import { ProviderForm } from "./provider-form";
import { ProviderRow } from "./provider-row";

interface ManageProvidersModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * Optional callback fired when the modal opens or after a successful
   * mutation completes — the parent can use it to refresh any state
   * outside the modal (e.g. the `useProviders` cache that feeds the
   * match setup form).
   */
  readonly onChanged?: () => void;
}

type EditingState =
  | { readonly kind: "none" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly id: string };

type MutationState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "error"; readonly message: string; readonly issues: readonly ValidationIssue[] };

/**
 * Provider management modal — the in-browser replacement for the
 * `npm run provider:add` CLI. Owns its own list state (via the shared
 * `useProviders` cache so the match setup dropdowns stay in sync), plus
 * the editing surface and the per-provider test state machine.
 *
 * The shell is the shared `<Modal>` from `@/shared/ui/modal` so the
 * chrome stays in one place. The feature owns the body, the list
 * rows, the form, and the nested confirm-delete dialog.
 */
export function ManageProvidersModal({ open, onClose, onChanged }: ManageProvidersModalProps) {
  if (!open) return null;
  return <ManageProvidersModalBody onClose={onClose} onChanged={onChanged} />;
}

function ManageProvidersModalBody({ onClose, onChanged }: Omit<ManageProvidersModalProps, "open">) {
  const { providers, status, errorMessage, reload } = useProviders();
  const [editing, setEditing] = useState<EditingState>({ kind: "none" });
  const [tests, dispatchTests] = useReducer(testsReducer, undefined, initialTests);
  const [mutation, setMutation] = useState<MutationState>({ kind: "idle" });
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // The body is mounted fresh on every open (parent returns null when
  // closed) so the initial `useState` values are already the "reset"
  // state. No explicit reset effect needed.

  const editingProvider = useMemo<RedactedProvider | null>(() => {
    if (editing.kind !== "edit") return null;
    return providers.find((provider) => provider.id === editing.id) ?? null;
  }, [editing, providers]);

  const handleStartCreate = () => {
    setMutation({ kind: "idle" });
    setEditing({ kind: "create" });
  };

  const handleStartEdit = (id: string) => {
    setMutation({ kind: "idle" });
    setEditing({ kind: "edit", id });
  };

  const handleCancelEdit = () => {
    setMutation({ kind: "idle" });
    setEditing({ kind: "none" });
  };

  const handleSubmit = useCallback(
    async ({
      draft,
      payload,
    }: {
      draft: ProviderDraft;
      payload: ProviderCreateInput | ProviderUpdateInput;
    }) => {
      // Client-side guard — the form already disabled submit when issues
      // exist, but double-check before any network call.
      const mode = editing.kind === "edit" ? "edit" : "create";
      if (validateProviderDraft(draft, mode).length > 0) return;
      setMutation({ kind: "busy" });
      try {
        if (mode === "create") {
          await createProvider(payload as ProviderCreateInput);
        } else if (editing.kind === "edit") {
          await updateProvider(editing.id, payload as ProviderUpdateInput);
        }
        setMutation({ kind: "idle" });
        setEditing({ kind: "none" });
        await reload();
        onChanged?.();
      } catch (error) {
        setMutation(toMutationError(error));
      }
    },
    [editing, onChanged, reload],
  );

  const handleTest = useCallback(
    async (id: string) => {
      dispatchTests({ type: "test/start", id });
      try {
        const result = await testProvider(id);
        if (result.ok) {
          dispatchTests({ type: "test/ok", id, latencyMs: result.latencyMs });
        } else {
          dispatchTests({ type: "test/failed", id, code: result.error.code, message: result.error.message });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Test failed";
        const code = error instanceof ProvidersUnavailableError && error.status === 404 ? "missing" : "network";
        dispatchTests({ type: "test/failed", id, code, message });
      }
    },
    [],
  );

  const handleRequestDelete = (id: string) => setPendingDelete(id);
  const handleCancelDelete = () => setPendingDelete(null);

  const handleConfirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    const id = pendingDelete;
    setPendingDelete(null);
    setMutation({ kind: "busy" });
    try {
      await deleteProvider(id);
      dispatchTests({ type: "test/clear", id });
      if (editing.kind === "edit" && editing.id === id) {
        setEditing({ kind: "none" });
      }
      setMutation({ kind: "idle" });
      await reload();
      onChanged?.();
    } catch (error) {
      setMutation(toMutationError(error));
    }
  }, [pendingDelete, editing, onChanged, reload]);

  const pendingDeleteProvider = pendingDelete ? providers.find((provider) => provider.id === pendingDelete) : undefined;

  return (
    <Modal open onClose={onClose}>
      <div data-state={editing.kind} className="provider-modal__inner">
        <ModalHeader
          eyebrow="Provider network"
          title="Manage providers"
          sub="Connect, test, and edit the AI models your agents will use."
        />

        <ModalBodySlot>
          {editing.kind === "none" ? (
            <ProviderList
              providers={providers}
              status={status}
              errorMessage={errorMessage}
              tests={tests}
              busy={mutation.kind === "busy"}
              onReload={reload}
              onAdd={handleStartCreate}
              onEdit={handleStartEdit}
              onTest={(id) => void handleTest(id)}
              onDelete={handleRequestDelete}
            />
          ) : editing.kind === "create" ? (
            <ProviderForm
              mode="create"
              initial={emptyProviderDraft()}
              busy={mutation.kind === "busy"}
              serverIssues={mutation.kind === "error" ? mutation.issues : []}
              submitLabel="Connect provider"
              onCancel={handleCancelEdit}
              onSubmit={(args) => void handleSubmit(args)}
            />
          ) : editingProvider ? (
            <ProviderForm
              mode="edit"
              initial={draftFromProvider(editingProvider)}
              busy={mutation.kind === "busy"}
              serverIssues={mutation.kind === "error" ? mutation.issues : []}
              submitLabel="Save changes"
              onCancel={handleCancelEdit}
              onSubmit={(args) => void handleSubmit(args)}
            />
          ) : (
            <EmptyMessage
              title="Provider not found"
              body="That provider was removed before you could edit it."
              onAction={handleCancelEdit}
              actionLabel="Back to list"
            />
          )}

          {mutation.kind === "error" ? (
            <MutationErrorBanner message={mutation.message} issues={mutation.issues} />
          ) : null}
        </ModalBodySlot>

        <ModalFooter>
          <div>
            <p className="provider-modal__foot-label">Prefer the terminal?</p>
            <p className="provider-modal__foot-hint">
              The CLI is still available for scripted setups.
            </p>
          </div>
          <code className="provider-modal__foot-cmd">npm run provider:add</code>
        </ModalFooter>
      </div>

      {pendingDeleteProvider ? (
        <ConfirmDelete
          provider={pendingDeleteProvider}
          busy={mutation.kind === "busy"}
          onCancel={handleCancelDelete}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}
    </Modal>
  );
}

// --- Sub-components --------------------------------------------------------

interface ProviderListProps {
  readonly providers: readonly RedactedProvider[];
  readonly status: ReturnType<typeof useProviders>["status"];
  readonly errorMessage: string | undefined;
  readonly tests: Readonly<Record<string, TestState>>;
  readonly busy: boolean;
  readonly onReload: () => void;
  readonly onAdd: () => void;
  readonly onEdit: (id: string) => void;
  readonly onTest: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

function ProviderList({
  providers,
  status,
  errorMessage,
  tests,
  busy,
  onReload,
  onAdd,
  onEdit,
  onTest,
  onDelete,
}: ProviderListProps) {
  return (
    <>
      <div className="provider-modal__list-head">
        <p className="provider-modal__list-count">
          {status === "ready"
            ? providers.length === 0
              ? "No providers connected"
              : `${providers.length} provider${providers.length === 1 ? "" : "s"} connected`
            : status === "loading"
              ? "Loading providers…"
              : "Provider list unavailable"}
        </p>
        <div className="provider-modal__list-actions">
          <button
            type="button"
            onClick={onReload}
            disabled={busy}
            className="provider-modal__ghost"
            aria-label="Reload provider list"
          >
            Reload
          </button>
          <button type="button" onClick={onAdd} disabled={busy} className="start-button">
            <span>Add provider</span>
            <span aria-hidden="true" className="font-display" style={{ fontSize: "1.1rem", lineHeight: 1 }}>
              +
            </span>
          </button>
        </div>
      </div>

      {status === "error" ? (
        <EmptyMessage
          title="Could not load providers"
          body={errorMessage ?? "The provider endpoint is unreachable."}
          onAction={onReload}
          actionLabel="Retry"
        />
      ) : status === "loading" || status === "idle" ? (
        <SkeletonRows />
      ) : providers.length === 0 ? (
        <EmptyMessage
          title="No providers yet"
          body="Add at least one provider to start a match. Keys are stored on the server, never in the browser."
          onAction={onAdd}
          actionLabel="Add a provider"
        />
      ) : (
        <ul className="provider-modal__list" aria-label="Configured providers">
          {providers.map((provider) => (
            <li key={provider.id}>
              <ProviderRow
                provider={provider}
                test={tests[provider.id]}
                busy={busy}
                onEdit={() => onEdit(provider.id)}
                onTest={() => onTest(provider.id)}
                onDelete={() => onDelete(provider.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function EmptyMessage({
  title,
  body,
  onAction,
  actionLabel,
}: {
  title: string;
  body: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="provider-modal__empty" role="status">
      <p className="provider-modal__empty-eyebrow">{title}</p>
      <p className="provider-modal__empty-body">{body}</p>
      {onAction && actionLabel ? (
        <button type="button" onClick={onAction} className="start-button">
          <span>{actionLabel}</span>
        </button>
      ) : null}
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="provider-modal__list" aria-busy="true" aria-label="Loading providers">
      {[0, 1].map((index) => (
        <li key={index}>
          <div className="provider-row provider-row--skeleton" aria-hidden="true">
            <div className="provider-row__skeleton-bar provider-row__skeleton-bar--title" />
            <div className="provider-row__skeleton-bar provider-row__skeleton-bar--line" />
            <div className="provider-row__skeleton-bar provider-row__skeleton-bar--line" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MutationErrorBanner({ message, issues }: { message: string; issues: readonly ValidationIssue[] }) {
  return (
    <div className="provider-modal__error" role="alert">
      <p className="provider-modal__error-title">{message}</p>
      {issues.length > 0 ? (
        <ul className="provider-modal__error-issues">
          {issues.map((issue, index) => (
            <li key={index}>
              <code>{issue.field}</code> {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ConfirmDelete({
  provider,
  busy,
  onCancel,
  onConfirm,
}: {
  provider: RedactedProvider;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="provider-modal__confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title">
      <button
        type="button"
        aria-label="Cancel delete"
        onClick={onCancel}
        className="provider-modal__backdrop provider-modal__backdrop--confirm"
      />
      <div className="provider-modal__confirm-panel">
        <h3 id="confirm-delete-title" className="provider-modal__confirm-title">
          Remove {provider.name}?
        </h3>
        <p className="provider-modal__confirm-body">
          Existing matches keep their transcripts, but new matches cannot use this provider until you
          add it back. The stored API key is deleted from the server.
        </p>
        <div className="provider-modal__confirm-actions">
          <button type="button" onClick={onCancel} disabled={busy} className="provider-modal__ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="provider-modal__danger"
          >
            {busy ? "Removing…" : "Remove provider"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Helpers ---------------------------------------------------------------

function toMutationError(error: unknown): MutationState {
  if (error instanceof ProvidersUnavailableError) {
    return { kind: "error", message: error.message, issues: error.issues };
  }
  if (error instanceof Error) {
    return { kind: "error", message: error.message, issues: [] };
  }
  return { kind: "error", message: "Could not save the provider.", issues: [] };
}
