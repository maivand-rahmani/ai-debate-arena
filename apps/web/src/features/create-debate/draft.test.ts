import { describe, expect, it } from "vitest";
import { applyProviderChange, emptyDraft, isDraftReady, isSameModelMatchup, toDebateRequest, type MatchDraft } from "./draft";
import type { RedactedProvider } from "@/shared/api/providers";

const alpha: RedactedProvider = {
  id: "alpha",
  name: "Alpha",
  baseUrl: "https://alpha.example/v1",
  model: "alpha-default",
  api: "chat",
  apiKeyHint: "alph••••••••lpha",
};

const beta: RedactedProvider = {
  id: "beta",
  name: "Beta",
  baseUrl: "https://beta.example/v1",
  model: "beta-default",
  api: "chat",
  apiKeyHint: "beta••••••••eta",
};

const providers = [alpha, beta];

const draftWithA = (model: string): MatchDraft => ({
  ...emptyDraft(),
  sideA: { providerId: "alpha", model },
});

describe("applyProviderChange", () => {
  it("fills the model with the provider default when the field is empty", () => {
    const draft = { ...emptyDraft(), sideA: { providerId: "", model: "" } };
    const next = applyProviderChange(draft, "A", "alpha", providers);
    expect(next.sideA.model).toBe("alpha-default");
  });

  it("replaces the model when it is only the previous provider's auto-filled default", () => {
    const next = applyProviderChange(draftWithA("alpha-default"), "A", "beta", providers);
    expect(next.sideA.model).toBe("beta-default");
  });

  it("keeps a user-typed model across provider changes", () => {
    const next = applyProviderChange(draftWithA("muse-spark-1.2-contributor"), "A", "beta", providers);
    expect(next.sideA.model).toBe("muse-spark-1.2-contributor");
    expect(next.sideA.providerId).toBe("beta");
  });

  it("keeps a user-typed model when the same provider is re-selected", () => {
    const next = applyProviderChange(draftWithA("custom-model"), "A", "alpha", providers);
    expect(next.sideA.model).toBe("custom-model");
  });

  it("updates side B without touching side A", () => {
    const draft: MatchDraft = {
      ...emptyDraft(),
      sideA: { providerId: "alpha", model: "keep-me" },
      sideB: { providerId: "alpha", model: "alpha-default" },
    };
    const next = applyProviderChange(draft, "B", "beta", providers);
    expect(next.sideA.model).toBe("keep-me");
    expect(next.sideB.model).toBe("beta-default");
  });
});

describe("same-model matchups", () => {
  it("allows a same-model matchup as a baseline while keeping the positions opposed", () => {
    const draft: MatchDraft = {
      topic: "Should cities ban private cars?",
      mode: "quick",
      sideA: { providerId: "alpha", model: "alpha-default" },
      sideB: { providerId: "alpha", model: "alpha-default" },
    };

    expect(isSameModelMatchup(draft)).toBe(true);
    expect(isDraftReady(draft)).toBe(true);
  });
});

describe("toDebateRequest", () => {
  const readyDraft = (mode: MatchDraft["mode"]): MatchDraft => ({
    topic: "  Should cities ban private cars?  ",
    mode,
    sideA: { providerId: "alpha", model: "alpha-default" },
    sideB: { providerId: "beta", model: "beta-default" },
  });

  it("keeps Quick request bodies unchanged with no Standard limits", () => {
    const request = toDebateRequest(readyDraft("quick"));
    expect(request).toEqual({
      topic: "Should cities ban private cars?",
      mode: "quick",
      agentA: { providerId: "alpha", model: "alpha-default", position: "FOR" },
      agentB: { providerId: "beta", model: "beta-default", position: "AGAINST" },
    });
    expect(request).not.toHaveProperty("standardLimits");
  });

  it("forces fixed side positions even when a stale/legacy draft carries reversed ones", () => {
    const current = readyDraft("quick");
    const legacy = {
      ...current,
      sideA: { ...current.sideA, position: "AGAINST" },
      sideB: { ...current.sideB, position: "FOR" },
    } as unknown as MatchDraft;

    const request = toDebateRequest(legacy);
    expect(request.agentA.position).toBe("FOR");
    expect(request.agentB.position).toBe("AGAINST");
  });

  it("attaches Standard limits for Standard and converts the tool timeout to seconds", () => {
    const request = toDebateRequest({
      ...readyDraft("standard"),
      standard: { startingCredits: 20, maxToolsPerMove: 3, toolTimeoutMs: 8_000 },
    });

    expect(request.standardLimits).toEqual({
      startingCredits: 20,
      maxToolsPerMove: 3,
      toolTimeoutSeconds: 8,
    });
  });

  it("never sends Standard limits for Quick/Hardcore even when the draft carries them", () => {
    for (const mode of ["quick", "hardcore"] as const) {
      const request = toDebateRequest({
        ...readyDraft(mode),
        standard: { startingCredits: 20, maxToolsPerMove: 3, toolTimeoutMs: 8_000 },
      });
      expect(request).not.toHaveProperty("standardLimits");
    }
  });

  it("omits limits for a Standard draft without a configured budget so server defaults apply", () => {
    const request = toDebateRequest(readyDraft("standard"));
    expect(request.mode).toBe("standard");
    expect(request).not.toHaveProperty("standardLimits");
  });
});
