import { describe, expect, it } from "vitest";
import { applyProviderChange, emptyDraft, type MatchDraft } from "./draft";
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
  sideA: { providerId: "alpha", model, position: "FOR" },
});

describe("applyProviderChange", () => {
  it("fills the model with the provider default when the field is empty", () => {
    const draft = { ...emptyDraft(), sideA: { providerId: "", model: "", position: "FOR" as const } };
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
      sideA: { providerId: "alpha", model: "keep-me", position: "FOR" },
      sideB: { providerId: "alpha", model: "alpha-default", position: "AGAINST" },
    };
    const next = applyProviderChange(draft, "B", "beta", providers);
    expect(next.sideA.model).toBe("keep-me");
    expect(next.sideB.model).toBe("beta-default");
  });
});
