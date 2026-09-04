import { describe, expect, it } from "vitest";
import { redactApiKey, redactProviderConfig, validateProviderConfig } from "./provider";

describe("provider configuration", () => {
  it("validates provider values", () => {
    expect(validateProviderConfig({ id: "local", name: "Local", baseUrl: "http://localhost:11434/v1", model: "llama3", apiKey: "secret" }).model).toBe("llama3");
    expect(() => validateProviderConfig({ id: "bad id", name: "x", baseUrl: "ftp://example.com", model: "x", apiKey: "x" })).toThrow();
  });
  it("redacts keys without retaining the secret", () => {
    const config = { id: "x", name: "X", baseUrl: "https://example.com/v1", model: "m", api: "chat" as const, apiKey: "super-secret-key" };
    expect(redactApiKey(config.apiKey)).toBe("supe••••••••-key");
    expect(redactProviderConfig(config)).not.toHaveProperty("apiKey");
    expect(JSON.stringify(redactProviderConfig(config))).not.toContain(config.apiKey);
  });
  it("defaults stored providers without api to chat", () => {
    const parsed = validateProviderConfig({ id: "old", name: "Old", baseUrl: "https://example.com/v1", model: "m", apiKey: "k" });
    expect(parsed.api).toBe("chat");
  });
  it("accepts the responses api type and keeps it through redaction", () => {
    const parsed = validateProviderConfig({ id: "zen", name: "Zen", baseUrl: "https://opencode.ai/zen/go/v1", model: "m", api: "responses", apiKey: "k" });
    expect(parsed.api).toBe("responses");
    expect(redactProviderConfig(parsed).api).toBe("responses");
    expect(() => validateProviderConfig({ id: "x", name: "X", baseUrl: "https://example.com/v1", model: "m", api: "soap", apiKey: "k" })).toThrow();
  });
});
