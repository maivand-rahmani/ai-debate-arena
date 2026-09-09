/**
 * Pure helpers for the provider management surface.
 *
 * - `normalizeProviderDraft` runs the same constraints the server applies
 *   to `ProviderCreateInput` so the form can show inline errors without
 *   waiting for a round-trip.
 * - `testsReducer` is a small state machine that tracks the per-provider
 *   test-connection result (idle / testing / ok / failed) without any
 *   React or fetch coupling. Components dispatch into it; the hook layer
 *   (see `use-manage-providers.ts`) wires the network calls to the
 *   transitions.
 * - `draftFromProvider` maps a redacted record to a form-friendly
 *   object, leaving the key field blank so the user can choose whether
 *   to overwrite it on edit.
 */

import type { ProviderApi, RedactedProvider, ValidationIssue } from "@/shared/api/providers";

export interface ProviderDraft {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly api: ProviderApi;
  readonly apiKey: string;
}

export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const ID_MAX = 64;
const NAME_MAX = 100;
const MODEL_MAX = 200;
const KEY_MAX = 4096;
const URL_MAX = 2048;

export function emptyProviderDraft(): ProviderDraft {
  return { id: "", name: "", baseUrl: "", model: "", api: "chat", apiKey: "" };
}

export function draftFromProvider(provider: RedactedProvider): ProviderDraft {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    api: provider.api,
    // Key is intentionally blank — server treats an empty/missing key as
    // "keep the stored value" on PUT.
    apiKey: "",
  };
}

export function validateProviderDraft(draft: ProviderDraft, mode: "create" | "edit"): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // id is only editable on create; the form hides it on edit.
  if (mode === "create") {
    const id = draft.id.trim();
    if (id.length === 0) {
      issues.push({ field: "id", message: "Pick an id — letters, numbers, dashes, underscores only." });
    } else if (id.length > ID_MAX) {
      issues.push({ field: "id", message: `Id must be ${ID_MAX} characters or fewer.` });
    } else if (!ID_PATTERN.test(id)) {
      issues.push({ field: "id", message: "Id can only contain letters, numbers, dashes, and underscores." });
    }
  }

  const name = draft.name.trim();
  if (name.length === 0) {
    issues.push({ field: "name", message: "Display name is required." });
  } else if (name.length > NAME_MAX) {
    issues.push({ field: "name", message: `Display name must be ${NAME_MAX} characters or fewer.` });
  }

  const baseUrl = draft.baseUrl.trim();
  if (baseUrl.length === 0) {
    issues.push({ field: "baseUrl", message: "Base URL is required." });
  } else if (baseUrl.length > URL_MAX) {
    issues.push({ field: "baseUrl", message: `Base URL must be ${URL_MAX} characters or fewer.` });
  } else {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      issues.push({ field: "baseUrl", message: "Base URL must be a valid URL." });
      parsed = undefined as unknown as URL;
    }
    if (parsed && parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      issues.push({ field: "baseUrl", message: "Base URL must use http or https." });
    }
  }

  const model = draft.model.trim();
  if (model.length === 0) {
    issues.push({ field: "model", message: "Default model is required." });
  } else if (model.length > MODEL_MAX) {
    issues.push({ field: "model", message: `Default model must be ${MODEL_MAX} characters or fewer.` });
  }

  if (draft.api !== "chat" && draft.api !== "responses") {
    issues.push({ field: "api", message: "API type must be 'chat' or 'responses'." });
  }

  // On create the key is mandatory; on edit an empty key is the "keep
  // the stored value" affordance and is therefore valid.
  if (mode === "create" && draft.apiKey.length === 0) {
    issues.push({ field: "apiKey", message: "API key is required." });
  } else if (draft.apiKey.length > KEY_MAX) {
    issues.push({ field: "apiKey", message: `API key must be ${KEY_MAX} characters or fewer.` });
  }

  return issues;
}

/**
 * For the edit form, the server only treats the key as "overwrite" when
 * the field is present and non-empty. We respect that here so the wire
 * body matches what the user expects.
 */
export function buildUpdatePayload(draft: ProviderDraft): {
  name: string;
  baseUrl: string;
  model: string;
  api: ProviderApi;
  apiKey?: string;
} {
  return {
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
    api: draft.api,
    ...(draft.apiKey.length > 0 ? { apiKey: draft.apiKey } : {}),
  };
}

// --- Test state machine ---------------------------------------------------

export type TestState =
  | { readonly kind: "idle" }
  | { readonly kind: "testing" }
  | { readonly kind: "ok"; readonly latencyMs: number }
  | { readonly kind: "failed"; readonly code: string; readonly message: string };

export type TestsState = Readonly<Record<string, TestState>>;

export const idleTest: TestState = { kind: "idle" };

export function initialTests(): TestsState {
  return {};
}

export type TestsAction =
  | { readonly type: "test/start"; readonly id: string }
  | { readonly type: "test/ok"; readonly id: string; readonly latencyMs: number }
  | { readonly type: "test/failed"; readonly id: string; readonly code: string; readonly message: string }
  | { readonly type: "test/clear"; readonly id: string }
  | { readonly type: "tests/reset-all" };

export function testsReducer(state: TestsState, action: TestsAction): TestsState {
  switch (action.type) {
    case "test/start":
      return { ...state, [action.id]: { kind: "testing" } };
    case "test/ok":
      return { ...state, [action.id]: { kind: "ok", latencyMs: action.latencyMs } };
    case "test/failed":
      return { ...state, [action.id]: { kind: "failed", code: action.code, message: action.message } };
    case "test/clear": {
      if (!(action.id in state)) return state;
      const next = { ...state };
      delete next[action.id];
      return next;
    }
    case "tests/reset-all":
      return {};
  }
}

// --- Inline form errors derived from server `issues` ----------------------

/**
 * Filter server-side validation issues down to those that are safe to
 * surface next to a specific form field. Anything we don't recognise, or
 * any duplicates after the first per field, is folded into a generic
 * top-of-form list so the user still sees it.
 */
export function bucketIssues(
  issues: readonly ValidationIssue[],
  fields: readonly string[],
): { fieldErrors: Record<string, string>; generic: string[] } {
  const fieldSet = new Set(fields);
  const fieldErrors: Record<string, string> = {};
  const generic: string[] = [];
  for (const issue of issues) {
    if (fieldSet.has(issue.field) && !fieldErrors[issue.field]) {
      // First issue per field wins — keeps the message near the input
      // and prevents overlapping red text. Subsequent issues for the
      // same field still go into `generic` so the user is not silently
      // missing them.
      fieldErrors[issue.field] = issue.message;
    } else {
      generic.push(issue.message);
    }
  }
  return { fieldErrors, generic };
}
