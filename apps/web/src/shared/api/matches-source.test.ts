import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchesApiError, requestMatchSource } from "./matches";

describe("requestMatchSource", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts a confirmed snapshot-only request without exposing capabilities", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sourceSnapshot: { id: "srcsnap_1" } }), { status: 200 }));
    await requestMatchSource("m/1", { reference: "https://example.org/a", label: "Report" });
    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(fetch).toHaveBeenCalledWith("/api/matches/m%2F1/sources", expect.anything());
    expect(JSON.parse(String(options.body))).toMatchObject({ version: 1, adapterId: "srcadp_https", adapterVersion: "1.0.0", reference: "https://example.org/a", label: "Report", freshness: { mode: "snapshot-only", maxAgeSeconds: 86400 }, confirm: true });
    expect(JSON.parse(String(options.body))).not.toHaveProperty("capabilities");
  });

  it("preserves safe server errors", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "blocked" }), { status: 403 }));
    await expect(requestMatchSource("m-1", { reference: "https://example.org" })).rejects.toMatchObject<Partial<MatchesApiError>>({ status: 403, code: "http", message: "blocked" });
  });
});
