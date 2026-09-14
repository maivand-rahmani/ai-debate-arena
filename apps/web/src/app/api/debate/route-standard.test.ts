/**
 * Focused wiring test for the Standard agent session dependency on
 * `POST /api/debate`. The heavy end-to-end route behavior lives in
 * `route.test.ts`; here we mock the server seams to prove the route hands the
 * runner both the Quick `callModel` path and the Standard session factory.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDebate: vi.fn(),
  webCallModel: vi.fn(),
  webRunStandardTool: vi.fn(),
  webSaveMatch: vi.fn(),
  createWebStandardAgentSession: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock("@/features/run-debate/server/web-adapter", () => ({
  webCallModel: mocks.webCallModel,
  webRunStandardTool: mocks.webRunStandardTool,
  webSaveMatch: mocks.webSaveMatch,
}));

vi.mock("@/features/run-debate/server/standard-agent-adapter", () => ({
  createWebStandardAgentSession: mocks.createWebStandardAgentSession,
}));

vi.mock("@/shared/config/provider-store", () => ({
  getProvider: mocks.getProvider,
}));

vi.mock("@arena/debate-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@arena/debate-engine")>();
  return { ...actual, runDebate: mocks.runDebate };
});

import { POST } from "./route";

function config(mode: "quick" | "standard") {
  return {
    topic: "Should cities ban private cars?",
    mode,
    agentA: { providerId: "p1", model: "m1", position: "FOR" },
    agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
  };
}

async function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/debate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProvider.mockImplementation(async (id: string) => ({
    id,
    name: `Provider ${id}`,
    baseUrl: "https://example.com/v1",
    model: "m",
    api: "chat",
    apiKey: "secret",
  }));
  // An empty async generator: the route only needs to drain and close it.
  mocks.runDebate.mockImplementation(() => (async function* () {})());
});

describe("POST /api/debate Standard wiring", () => {
  it("passes the Standard agent session factory and keeps the Quick callModel path", async () => {
    const response = await post(config("quick"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(mocks.runDebate).toHaveBeenCalledTimes(1);

    const [parsed, deps] = mocks.runDebate.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect((parsed as { mode: string }).mode).toBe("quick");
    expect(deps.callModel).toBe(mocks.webCallModel);
    expect(deps.runTool).toBe(mocks.webRunStandardTool);
    expect(deps.saveMatch).toBe(mocks.webSaveMatch);
    // The runner uses this factory only in Standard mode; Quick never calls it.
    expect(deps.createStandardAgentSession).toBe(mocks.createWebStandardAgentSession);
  });

  it("passes the factory for a Standard request too", async () => {
    const response = await post(config("standard"));

    expect(response.status).toBe(200);
    const [parsed, deps] = mocks.runDebate.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect((parsed as { mode: string }).mode).toBe("standard");
    expect(deps.createStandardAgentSession).toBe(mocks.createWebStandardAgentSession);
  });
});
