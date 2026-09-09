/**
 * Client-side helpers for the provider management endpoints.
 *
 * Wire contract (v0.3 closeout — managed in parallel with the server):
 *   - GET    /api/providers                   → redacted list
 *   - POST   /api/providers                   → create
 *   - PUT    /api/providers/<id>              → update (omit `apiKey` to keep)
 *   - DELETE /api/providers/<id>              → delete
 *   - POST   /api/providers/<id>/test         → test connection
 *
 * The browser ONLY ever holds redacted records after these calls. Raw API
 * keys live in the server-side store and are returned as a hint (e.g.
 * `sk-1•••…lpha`) for display purposes only.
 */

export type ProviderApi = "chat" | "responses";

export interface RedactedProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly api: ProviderApi;
  readonly apiKeyHint: string;
}

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export class ProvidersUnavailableError extends Error {
  public readonly status?: number;
  public readonly code: "missing" | "http" | "parse" | "validation" | "incompatible";
  public readonly issues: readonly ValidationIssue[];
  constructor(
    message: string,
    code: ProvidersUnavailableError["code"],
    status?: number,
    issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "ProvidersUnavailableError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export interface ProviderCreateInput {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly api: ProviderApi;
  readonly apiKey: string;
}

export interface ProviderUpdateInput {
  readonly name?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly api?: ProviderApi;
  /**
   * Leave undefined (or empty) to keep the stored key. Any non-empty value
   * overwrites the stored key.
   */
  readonly apiKey?: string;
}

export type ProviderTestResult =
  | { readonly ok: true; readonly latencyMs: number }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

// --- GET /api/providers ---------------------------------------------------

export async function fetchProviders(signal?: AbortSignal): Promise<RedactedProvider[]> {
  let response: Response;
  try {
    response = await fetch("/api/providers", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new ProvidersUnavailableError(toMessage(error), "missing");
  }

  if (!response.ok) {
    throw new ProvidersUnavailableError(
      `Server responded ${response.status} ${response.statusText}`.trim(),
      response.status === 404 ? "missing" : "http",
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProvidersUnavailableError("Provider list response was not valid JSON", "parse", response.status);
  }

  if (!payload || typeof payload !== "object") {
    throw new ProvidersUnavailableError("Provider list response was malformed", "incompatible", response.status);
  }

  const list = (payload as { providers?: unknown }).providers;
  if (!Array.isArray(list)) return [];

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item): RedactedProvider | null => parseRedactedProvider(item))
    .filter((value): value is RedactedProvider => value !== null);
}

// --- POST /api/providers --------------------------------------------------

export async function createProvider(input: ProviderCreateInput, signal?: AbortSignal): Promise<RedactedProvider> {
  return await requestRedacted<ProviderCreateInput>("/api/providers", "POST", input, signal);
}

// --- PUT /api/providers/<id> ---------------------------------------------

export async function updateProvider(
  id: string,
  input: ProviderUpdateInput,
  signal?: AbortSignal,
): Promise<RedactedProvider> {
  // The server treats an empty `apiKey` as "keep the stored key", but
  // some servers (and a future Zod schema) may treat empty strings as a
  // length error. Strip the field entirely when the caller has nothing
  // to overwrite so the wire body always means what we want it to mean.
  const wireBody = normalizeUpdateBody(input);
  return await requestRedacted<ProviderUpdateInput>(
    `/api/providers/${encodeURIComponent(id)}`,
    "PUT",
    wireBody,
    signal,
  );
}

function normalizeUpdateBody(input: ProviderUpdateInput): ProviderUpdateInput {
  if (input.apiKey === undefined || input.apiKey === "") {
    const { apiKey: _drop, ...rest } = input;
    void _drop;
    return rest;
  }
  return input;
}

// --- DELETE /api/providers/<id> ------------------------------------------

export async function deleteProvider(id: string, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    throw new ProvidersUnavailableError(toMessage(error), "missing");
  }
  if (response.status === 204) return;
  if (response.status === 404) {
    throw new ProvidersUnavailableError("Provider not found", "missing", 404);
  }
  // Some servers return a body with the failure reason even on DELETE.
  const message = await readErrorMessage(response);
  throw new ProvidersUnavailableError(
    message ?? `Server responded ${response.status} ${response.statusText}`.trim(),
    "http",
    response.status,
  );
}

// --- POST /api/providers/<id>/test --------------------------------------

export async function testProvider(id: string, signal?: AbortSignal): Promise<ProviderTestResult> {
  let response: Response;
  try {
    response = await fetch(`/api/providers/${encodeURIComponent(id)}/test`, {
      method: "POST",
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    // The endpoint may not exist on older servers — surface a typed error
    // (not the same shape as `ok:false`) so callers can decide.
    throw new ProvidersUnavailableError(toMessage(error), "missing");
  }
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new ProvidersUnavailableError(
      message ?? `Server responded ${response.status} ${response.statusText}`.trim(),
      response.status === 404 ? "missing" : "http",
      response.status,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProvidersUnavailableError("Test response was not valid JSON", "parse", response.status);
  }
  return parseTestResult(payload);
}

// --- Shared internals ----------------------------------------------------

async function requestRedacted<Body>(
  url: string,
  method: "POST" | "PUT",
  body: Body,
  signal?: AbortSignal,
): Promise<RedactedProvider> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw new ProvidersUnavailableError(toMessage(error), "missing");
  }
  if (!response.ok) {
    const parsed = await readErrorEnvelope(response);
    if (response.status === 400 && parsed) {
      throw new ProvidersUnavailableError(
        parsed.error ?? "Validation failed",
        "validation",
        400,
        parsed.issues ?? [],
      );
    }
    if (response.status === 404) {
      throw new ProvidersUnavailableError(parsed?.error ?? "Provider not found", "missing", 404);
    }
    throw new ProvidersUnavailableError(
      parsed?.error ?? `Server responded ${response.status} ${response.statusText}`.trim(),
      "http",
      response.status,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProvidersUnavailableError("Response was not valid JSON", "parse", response.status);
  }
  if (!payload || typeof payload !== "object") {
    throw new ProvidersUnavailableError("Response was malformed", "incompatible", response.status);
  }
  const parsed = parseRedactedProvider(payload as Record<string, unknown>);
  if (!parsed) {
    throw new ProvidersUnavailableError("Response was missing required fields", "incompatible", response.status);
  }
  return parsed;
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { error?: unknown; message?: unknown };
    if (typeof body?.error === "string" && body.error.length > 0) return body.error;
    if (typeof body?.message === "string" && body.message.length > 0) return body.message;
  } catch {
    /* ignore non-JSON */
  }
  return null;
}

async function readErrorEnvelope(
  response: Response,
): Promise<{ error?: string; issues?: ValidationIssue[] } | null> {
  try {
    const body = (await response.clone().json()) as { error?: unknown; issues?: unknown };
    if (!body || typeof body !== "object") return null;
    const error = typeof body.error === "string" ? body.error : undefined;
    const issues = Array.isArray(body.issues)
      ? (body.issues
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const record = item as Record<string, unknown>;
            if (typeof record.field !== "string" || typeof record.message !== "string") return null;
            return { field: record.field, message: record.message };
          })
          .filter((value): value is ValidationIssue => value !== null))
      : undefined;
    return { error, issues };
  } catch {
    return null;
  }
}

function parseRedactedProvider(input: Record<string, unknown>): RedactedProvider | null {
  const id = input.id;
  const name = input.name;
  const baseUrl = input.baseUrl;
  const model = input.model;
  const apiKeyHint = input.apiKeyHint;
  const api = input.api;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof baseUrl !== "string" ||
    typeof model !== "string" ||
    typeof apiKeyHint !== "string"
  ) {
    return null;
  }
  if (api !== "chat" && api !== "responses") return null;
  return { id, name, baseUrl, model, api, apiKeyHint };
}

function parseTestResult(payload: unknown): ProviderTestResult {
  if (!payload || typeof payload !== "object") {
    throw new ProvidersUnavailableError("Test response was malformed", "incompatible");
  }
  const record = payload as Record<string, unknown>;
  if (record.ok === true) {
    const latency = record.latencyMs;
    if (typeof latency !== "number" || !Number.isFinite(latency) || latency < 0) {
      throw new ProvidersUnavailableError("Test response was missing a valid latencyMs", "incompatible");
    }
    return { ok: true, latencyMs: latency };
  }
  if (record.ok === false) {
    const error = record.error as { code?: unknown; message?: unknown } | undefined;
    const code = typeof error?.code === "string" && error.code.length > 0 ? error.code : "unknown";
    const message = typeof error?.message === "string" && error.message.length > 0 ? error.message : "Test failed";
    return { ok: false, error: { code, message } };
  }
  throw new ProvidersUnavailableError("Test response was missing an `ok` field", "incompatible");
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Network request failed";
}
