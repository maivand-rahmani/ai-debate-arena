"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchProviders, type RedactedProvider } from "@/shared/api/providers";

export type ProvidersStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface UseProvidersResult {
  readonly status: ProvidersStatus;
  readonly providers: readonly RedactedProvider[];
  readonly errorMessage?: string;
  readonly reload: () => void;
}

/**
 * Loads the redacted provider list once on mount. The hook intentionally does
 * not block the surrounding UI: if the `/api/providers` endpoint is not yet
 * implemented, we surface a `missing` state so the screen can render a
 * helpful empty state instead of a generic spinner.
 *
 * Loading state is derived from an in-flight request flag rather than
 * synchronously setting state inside the effect body.
 */
export function useProviders(): UseProvidersResult {
  const [status, setStatus] = useState<ProvidersStatus>("loading");
  const [providers, setProviders] = useState<readonly RedactedProvider[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchProviders()
      .then((list) => {
        if (cancelled) return;
        setProviders(list);
        setStatus(list.length > 0 ? "ready" : "missing");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Could not load providers.";
        setErrorMessage(message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => {
    setStatus((current) => (current === "ready" || current === "missing" ? "loading" : current));
    setErrorMessage(undefined);
    setReloadToken((value) => value + 1);
  }, []);

  return { status, providers, errorMessage, reload };
}
