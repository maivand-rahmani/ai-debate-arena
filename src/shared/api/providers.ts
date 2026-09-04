/**
 * Client-side fetcher for the redacted provider list.
 *
 * The server returns `{ providers: [{ id, name, baseUrl, model, apiKeyHint }] }`
 * — never the raw API key. This helper normalises the response and surfaces a
 * typed error when the endpoint is missing so the UI can degrade gracefully
 * while the parallel server work is still in flight.
 */

export interface RedactedProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKeyHint: string;
}

export class ProvidersUnavailableError extends Error {
  public readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProvidersUnavailableError";
    this.status = status;
  }
}

export async function fetchProviders(): Promise<RedactedProvider[]> {
  let response: Response;
  try {
    response = await fetch("/api/providers", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    throw new ProvidersUnavailableError(toMessage(error));
  }

  if (!response.ok) {
    throw new ProvidersUnavailableError(
      `Server responded ${response.status} ${response.statusText}`.trim(),
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProvidersUnavailableError("Provider list response was not valid JSON");
  }

  if (!payload || typeof payload !== "object") {
    throw new ProvidersUnavailableError("Provider list response was malformed");
  }

  const list = (payload as { providers?: unknown }).providers;
  if (!Array.isArray(list)) return [];

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item): RedactedProvider | null => {
      const id = item.id;
      const name = item.name;
      const baseUrl = item.baseUrl;
      const model = item.model;
      const apiKeyHint = item.apiKeyHint;
      if (typeof id !== "string" || typeof name !== "string") return null;
      if (typeof baseUrl !== "string" || typeof model !== "string" || typeof apiKeyHint !== "string") {
        return null;
      }
      return { id, name, baseUrl, model, apiKeyHint };
    })
    .filter((value): value is RedactedProvider => value !== null);
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Network request failed";
}
