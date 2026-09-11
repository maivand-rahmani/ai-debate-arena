import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchesApiError, requestMatchProof } from "./matches";

describe("requestMatchProof", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts the versioned evidence id and returns the proof", async () => {
    const proof = { evidenceId: "ev_1", status: "verified", verifiedAt: "2026-01-01T00:00:00.000Z" } as const;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ proof }), { status: 200 }));
    await expect(requestMatchProof("match/1", "ev_1")).resolves.toEqual(proof);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/matches/match%2F1/proofs", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ version: 1, evidenceId: "ev_1" }),
    }));
  });

  it("turns unavailable server responses into typed errors", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "No proof adapter" }), { status: 409 }));
    await expect(requestMatchProof("match-1", "ev_1")).rejects.toMatchObject<Partial<MatchesApiError>>({ status: 409, code: "http" });
  });

  it("rejects a proof for a different evidence item", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ proof: { evidenceId: "ev_other", status: "verified", verifiedAt: "now" } }), { status: 200 }));
    await expect(requestMatchProof("match-1", "ev_1")).rejects.toMatchObject({ code: "incompatible" });
  });
});
