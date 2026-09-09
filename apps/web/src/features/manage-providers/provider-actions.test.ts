import { describe, expect, it } from "vitest";
import {
  buildUpdatePayload,
  bucketIssues,
  draftFromProvider,
  emptyProviderDraft,
  initialTests,
  testsReducer,
  validateProviderDraft,
  type ProviderDraft,
} from "./provider-actions";
import type { RedactedProvider } from "@/shared/api/providers";

const baseProvider: RedactedProvider = {
  id: "alpha",
  name: "Alpha",
  baseUrl: "https://alpha.example/v1",
  model: "alpha-default",
  api: "chat",
  apiKeyHint: "alph••••••••lpha",
};

describe("emptyProviderDraft", () => {
  it("returns a fully blank draft", () => {
    expect(emptyProviderDraft()).toEqual({
      id: "",
      name: "",
      baseUrl: "",
      model: "",
      api: "chat",
      apiKey: "",
    });
  });
});

describe("draftFromProvider", () => {
  it("copies fields and blanks the key (the edit affordance)", () => {
    const draft = draftFromProvider(baseProvider);
    expect(draft).toEqual({
      id: "alpha",
      name: "Alpha",
      baseUrl: "https://alpha.example/v1",
      model: "alpha-default",
      api: "chat",
      apiKey: "",
    });
  });
});

describe("validateProviderDraft (create)", () => {
  it("passes a complete draft with no issues", () => {
    const draft: ProviderDraft = {
      id: "alpha",
      name: "Alpha",
      baseUrl: "https://alpha.example/v1",
      model: "alpha-default",
      api: "chat",
      apiKey: "sk-very-secret",
    };
    expect(validateProviderDraft(draft, "create")).toEqual([]);
  });

  it("rejects empty fields and an invalid url protocol", () => {
    const draft: ProviderDraft = {
      id: "",
      name: "   ",
      baseUrl: "ftp://nope",
      model: "",
      api: "chat",
      apiKey: "",
    };
    const issues = validateProviderDraft(draft, "create");
    const fields = issues.map((issue) => issue.field).sort();
    expect(fields).toEqual(["apiKey", "baseUrl", "id", "model", "name"]);
  });

  it("rejects ids with disallowed characters", () => {
    const issues = validateProviderDraft(
      { ...emptyProviderDraft(), id: "bad id", name: "x", baseUrl: "https://x/v1", model: "m", apiKey: "k" },
      "create",
    );
    expect(issues.some((issue) => issue.field === "id" && /letters, numbers/i.test(issue.message))).toBe(true);
  });

  it("rejects unknown api values", () => {
    const issues = validateProviderDraft(
      {
        ...emptyProviderDraft(),
        id: "x",
        name: "x",
        baseUrl: "https://x/v1",
        model: "m",
        api: "soap" as never,
        apiKey: "k",
      },
      "create",
    );
    expect(issues.some((issue) => issue.field === "api")).toBe(true);
  });
});

describe("validateProviderDraft (edit)", () => {
  it("treats an empty apiKey as valid (the keep-current affordance)", () => {
    const issues = validateProviderDraft(draftFromProvider(baseProvider), "edit");
    expect(issues).toEqual([]);
  });

  it("does not validate the id on edit (the field is hidden)", () => {
    const issues = validateProviderDraft(
      { ...emptyProviderDraft(), id: "", name: "x", baseUrl: "https://x/v1", model: "m", api: "chat" },
      "edit",
    );
    expect(issues.some((issue) => issue.field === "id")).toBe(false);
  });

  it("still rejects an over-long key on edit", () => {
    const issues = validateProviderDraft(
      { ...draftFromProvider(baseProvider), apiKey: "k".repeat(4097) },
      "edit",
    );
    expect(issues.some((issue) => issue.field === "apiKey")).toBe(true);
  });
});

describe("buildUpdatePayload", () => {
  it("omits the apiKey when blank so the server keeps the stored value", () => {
    const payload = buildUpdatePayload({
      id: "alpha",
      name: "  Alpha  ",
      baseUrl: "  https://alpha.example/v1  ",
      model: "  alpha-default  ",
      api: "chat",
      apiKey: "",
    });
    expect(payload).toEqual({
      name: "Alpha",
      baseUrl: "https://alpha.example/v1",
      model: "alpha-default",
      api: "chat",
    });
    expect("apiKey" in payload).toBe(false);
  });

  it("includes the apiKey when the user typed a new value", () => {
    const payload = buildUpdatePayload({ ...emptyProviderDraft(), name: "n", baseUrl: "https://x/v1", model: "m", apiKey: "sk-new" });
    expect(payload.apiKey).toBe("sk-new");
  });
});

describe("bucketIssues", () => {
  it("splits issues into field-keyed errors and generic messages", () => {
    const out = bucketIssues(
      [
        { field: "baseUrl", message: "Bad URL" },
        { field: "apiKey", message: "Required" },
        { field: "id", message: "Unknown field" },
        { field: "name", message: "Unknown" },
      ],
      ["id", "name", "baseUrl", "model", "api", "apiKey"],
    );
    expect(out.fieldErrors).toEqual({
      baseUrl: "Bad URL",
      apiKey: "Required",
      id: "Unknown field",
      name: "Unknown",
    });
    expect(out.generic).toEqual([]);
  });

  it("keeps the first issue per field and folds the rest into generic", () => {
    const out = bucketIssues(
      [
        { field: "baseUrl", message: "first" },
        { field: "baseUrl", message: "second" },
      ],
      ["baseUrl"],
    );
    expect(out.fieldErrors).toEqual({ baseUrl: "first" });
    expect(out.generic).toEqual(["second"]);
  });

  it("ignores empty issues", () => {
    const out = bucketIssues([], ["id"]);
    expect(out).toEqual({ fieldErrors: {}, generic: [] });
  });
});

describe("testsReducer", () => {
  it("starts empty and tracks per-id state", () => {
    const s0 = initialTests();
    const s1 = testsReducer(s0, { type: "test/start", id: "alpha" });
    expect(s1).toEqual({ alpha: { kind: "testing" } });
    const s2 = testsReducer(s1, { type: "test/ok", id: "alpha", latencyMs: 180 });
    expect(s2).toEqual({ alpha: { kind: "ok", latencyMs: 180 } });
  });

  it("tracks failures with a code + message", () => {
    const s1 = testsReducer(initialTests(), {
      type: "test/failed",
      id: "alpha",
      code: "auth",
      message: "Invalid API key",
    });
    expect(s1).toEqual({ alpha: { kind: "failed", code: "auth", message: "Invalid API key" } });
  });

  it("clears a single entry without touching others", () => {
    const a = testsReducer(initialTests(), { type: "test/ok", id: "a", latencyMs: 10 });
    const b = testsReducer(a, { type: "test/ok", id: "b", latencyMs: 20 });
    const cleared = testsReducer(b, { type: "test/clear", id: "a" });
    expect(cleared).toEqual({ b: { kind: "ok", latencyMs: 20 } });
  });

  it("clearing an unknown id is a no-op", () => {
    const a = testsReducer(initialTests(), { type: "test/ok", id: "a", latencyMs: 10 });
    const next = testsReducer(a, { type: "test/clear", id: "ghost" });
    expect(next).toBe(a);
  });

  it("reset-all wipes the map", () => {
    const a = testsReducer(initialTests(), { type: "test/ok", id: "a", latencyMs: 10 });
    const b = testsReducer(a, { type: "test/ok", id: "b", latencyMs: 20 });
    expect(testsReducer(b, { type: "tests/reset-all" })).toEqual({});
  });
});
