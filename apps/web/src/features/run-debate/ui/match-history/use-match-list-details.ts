"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMatch, type MatchRecord, type MatchSummary } from "@/shared/api/matches";

/**
 * Match list responses intentionally stay small. The archive rows ask for a
 * little extra signal, so load saved records opportunistically without
 * changing the list contract. A failed detail request leaves the row useful.
 */
export function useMatchListDetails(list: readonly MatchSummary[]): ReadonlyMap<string, MatchRecord> {
  const [details, setDetails] = useState<ReadonlyMap<string, MatchRecord>>(new Map());
  const ids = useMemo(() => list.map((summary) => summary.id).join("\u0001"), [list]);

  useEffect(() => {
    let cancelled = false;
    if (list.length === 0) {
      setDetails(new Map());
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      list.map(async (summary) => {
        try {
          return await fetchMatch(summary.id);
        } catch {
          return null;
        }
      }),
    ).then((records) => {
      if (cancelled) return;
      const next = new Map<string, MatchRecord>();
      for (const record of records) {
        if (record) next.set(record.matchId, record);
      }
      setDetails(next);
    });

    return () => {
      cancelled = true;
    };
  }, [ids, list]);

  return details;
}
