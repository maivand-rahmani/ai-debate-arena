import { describe, expect, it } from "vitest";
import {
  ARENA_USER_AGENT,
  ARENA_VERSION,
  buildAiModel,
  isOpencodeGateway,
  opencodeGatewayHeaders,
} from "../src/index";

describe("opencodeGatewayHeaders", () => {
  it("returns the session + User-Agent pair on the OpenCode gateway paths", () => {
    for (const baseUrl of ["https://opencode.ai/zen/go/v1", "https://opencode.ai/zen/v1", "https://opencode.ai/v1"]) {
      expect(opencodeGatewayHeaders(baseUrl, "match-1:agent-a")).toEqual({
        "x-opencode-session": "match-1:agent-a",
        "User-Agent": `ai-debate-arena/${ARENA_VERSION}`,
      });
    }
  });

  it("matches the gateway host case-insensitively", () => {
    expect(opencodeGatewayHeaders("https://OPENCODE.AI/zen/v1", "k")).toEqual({
      "x-opencode-session": "k",
      "User-Agent": ARENA_USER_AGENT,
    });
    expect(isOpencodeGateway("https://OpenCode.AI/v1")).toBe(true);
  });

  it("stays inert off-gateway: subdomains, lookalikes, other hosts, bad URLs", () => {
    expect(opencodeGatewayHeaders("https://openrouter.ai/api/v1", "k")).toEqual({});
    expect(opencodeGatewayHeaders("http://localhost:11434/v1", "k")).toEqual({});
    expect(opencodeGatewayHeaders("https://api.openai.com/v1", "k")).toEqual({});
    // Subdomains and suffix lookalikes must NOT match (exact host only).
    expect(opencodeGatewayHeaders("https://foo.opencode.ai/v1", "k")).toEqual({});
    expect(opencodeGatewayHeaders("https://opencode.ai.evil.com/v1", "k")).toEqual({});
    expect(opencodeGatewayHeaders("not-a-url", "k")).toEqual({});
    expect(opencodeGatewayHeaders("", "k")).toEqual({});
    expect(isOpencodeGateway("https://foo.opencode.ai/v1")).toBe(false);
  });
});

describe("buildAiModel sessionKey threading", () => {
  const loopback = {
    id: "mock",
    name: "Mock",
    baseUrl: "http://127.0.0.1:9/v1",
    model: "mock-model",
    apiKey: "sk-test",
  } as const;

  it("builds chat and responses models with or without a session key (no I/O)", async () => {
    await expect(buildAiModel({ ...loopback, api: "chat" })).resolves.toBeDefined();
    await expect(buildAiModel({ ...loopback, api: "chat" }, undefined, { sessionKey: "m:agent-a" })).resolves.toBeDefined();
    await expect(buildAiModel({ ...loopback, api: "responses" }, undefined, { sessionKey: "m:judge" })).resolves.toBeDefined();
    // Explicit model override still wins.
    const model = await buildAiModel({ ...loopback, api: "chat" }, "other-model", { sessionKey: "m:agent-b" });
    expect(model).toBeDefined();
  });
});
