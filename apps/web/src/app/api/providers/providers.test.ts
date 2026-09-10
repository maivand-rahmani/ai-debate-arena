/**
 * Contract tests for the provider management API (V3C-02 backend).
 *
 * Covers `POST /api/providers`, `PUT /api/providers/[id]`,
 * `DELETE /api/providers/[id]`, and `POST /api/providers/[id]/test`:
 * happy paths, invalid-config 400s, unknown-id 404s, preserved-key-on-edit,
 * redaction (no `apiKey` in ANY response body), and test-endpoint success +
 * error mapping against the loopback mock OpenAI-compatible server (the AI
 * SDK itself is NOT mocked).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listProviders, POST as createProvider } from "./route";
import { DELETE as deleteProvider, PUT as updateProvider } from "./[id]/route";
import { POST as testProvider } from "./[id]/test/route";
import {
  startMockOpenAIProvider,
  type MockOpenAIProvider,
} from "../../../test/mock-openai-provider";

vi.mock("server-only", () => ({}));

const SECRET = "sk-live-probe-secret-abc123XYZ";
const OTHER_SECRET = "sk-live-rotated-secret-987ZYX";

let mock: MockOpenAIProvider;
let dir = "";
const ORIGINAL_FILE = process.env.AI_DEBATE_ARENA_PROVIDER_FILE;

beforeAll(async () => {
  mock = await startMockOpenAIProvider();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-debate-arena-providers-"));
  process.env.AI_DEBATE_ARENA_PROVIDER_FILE = join(dir, "providers.json");
  mock.reset();
});

afterEach(async () => {
  if (ORIGINAL_FILE === undefined) delete process.env.AI_DEBATE_ARENA_PROVIDER_FILE;
  else process.env.AI_DEBATE_ARENA_PROVIDER_FILE = ORIGINAL_FILE;
  await rm(dir, { recursive: true, force: true });
});

function validBody() {
  return {
    id: "mock-provider",
    name: "Mock Provider",
    baseUrl: mock.baseUrl,
    model: "mock-model",
    api: "chat",
    apiKey: SECRET,
  };
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

/**
 * Fails the test when a response body carries a secret value or a raw
 * `apiKey` field. (`apiKeyHint` is the redacted stand-in and is expected.)
 */
function expectRedacted(raw: string): void {
  expect(raw).not.toContain(SECRET);
  expect(raw).not.toContain(OTHER_SECRET);
  expect(raw).not.toContain('"apiKey"');
}

describe("POST /api/providers", () => {
  it("creates a provider and returns the redacted record", async () => {
    const res = await createProvider(jsonRequest("http://localhost/api/providers", "POST", validBody()));
    expect(res.status).toBe(200);
    const raw = await res.text();
    expectRedacted(raw);
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: "mock-provider",
      name: "Mock Provider",
      baseUrl: mock.baseUrl,
      model: "mock-model",
      api: "chat",
    });
    expect(typeof body.apiKeyHint).toBe("string");
    expect(body.apiKeyHint as string).not.toContain(SECRET);
  });

  it("rejects an invalid config with a 400 {error, issues} shape and stores nothing", async () => {
    const res = await createProvider(
      jsonRequest("http://localhost/api/providers", "POST", { ...validBody(), baseUrl: "ftp://example.com" }),
    );
    expect(res.status).toBe(400);
    const raw = await res.text();
    expectRedacted(raw);
    const body = JSON.parse(raw) as { error: unknown; issues: Array<{ field: unknown; message: unknown }> };
    expect(typeof body.error).toBe("string");
    expect(Array.isArray(body.issues)).toBe(true);
    // UI-aligned shape: { field, message } per issue.
    expect(body.issues.length).toBeGreaterThan(0);
    expect(typeof body.issues[0]?.field).toBe("string");
    expect(typeof body.issues[0]?.message).toBe("string");

    const listed = await listProviders();
    expect((await listed.json()) as { providers: unknown[] }).toEqual({ providers: [] });
  });

  it("rejects a malformed JSON body with a 400 {error} shape", async () => {
    const res = await createProvider(
      new Request("http://localhost/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as { error?: unknown }).error).toBe("string");
  });
});

describe("GET /api/providers", () => {
  it("lists stored providers redacted (existing contract)", async () => {
    await createProvider(jsonRequest("http://localhost/api/providers", "POST", validBody()));
    const res = await listProviders();
    expect(res.status).toBe(200);
    const raw = await res.text();
    expectRedacted(raw);
    const body = JSON.parse(raw) as { providers: Array<{ id: string; apiKeyHint: string }> };
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0]?.id).toBe("mock-provider");
    expect(typeof body.providers[0]?.apiKeyHint).toBe("string");
  });
});

describe("PUT /api/providers/[id]", () => {
  it("edits fields and preserves the stored key when apiKey is omitted", async () => {
    const created = JSON.parse(
      await (await createProvider(jsonRequest("http://localhost/api/providers", "POST", validBody()))).text(),
    ) as { apiKeyHint: string };
    const hintBefore = created.apiKeyHint;

    const res = await updateProvider(
      jsonRequest("http://localhost/api/providers/mock-provider", "PUT", { name: "Renamed" }),
      params("mock-provider"),
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expectRedacted(raw);
    const body = JSON.parse(raw) as { name: string; apiKeyHint: string };
    expect(body.name).toBe("Renamed");
    // Same hint ⇒ the original key was preserved.
    expect(body.apiKeyHint).toBe(hintBefore);
  });

  it("preserves the API mode when updating only the model", async () => {
    await createProvider(
      jsonRequest("http://localhost/api/providers", "POST", {
        ...validBody(),
        api: "responses",
      }),
    );

    const res = await updateProvider(
      jsonRequest("http://localhost/api/providers/mock-provider", "PUT", {
        model: "muse-spark-1.2-contributor",
      }),
      params("mock-provider"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      model: "muse-spark-1.2-contributor",
      api: "responses",
    });
  });

  it("preserves the stored key when apiKey is an empty string", async () => {
    const created = JSON.parse(
      await (await createProvider(jsonRequest("http://localhost/api/providers", "POST", validBody()))).text(),
    ) as { apiKeyHint: string };

    const res = await updateProvider(
      jsonRequest("http://localhost/api/providers/mock-provider", "PUT", { apiKey: "" }),
      params("mock-provider"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { apiKeyHint: string };
    expect(body.apiKeyHint).toBe(created.apiKeyHint);
  });

  it("rotates the key when a new apiKey is supplied", async () => {
    await createProvider(jsonRequest("http://localhost/api/providers", "POST", validBody()));
    const res = await updateProvider(
      jsonRequest("http://localhost/api/providers/mock-provider", "PUT", { apiKey: OTHER_SECRET }),
      params("mock-provider"),
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expectRedacted(raw);
    const listed = JSON.parse(
      await (await listProviders()).text(),
    ) as { providers: Array<{ apiKeyHint: string }> };
    expectRedacted(JSON.stringify(listed));
    expect(listed.providers[0]?.apiKeyHint).not.toContain(SECRET);
  });

  it("rejects an invalid edit with a 400 and leaves the record unchanged", async () => {
    await createProvider(jsonRequest("http://localhost/api/providers", "POST", validBody()));
    const res = await updateProvider(
      jsonRequest("http://localhost/api/providers/mock-provider", "PUT", { baseUrl: "not-a-url" }),
      params("mock-provider"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: unknown; issues: unknown };
    expect(typeof body.error).toBe("string");
    expect(Array.isArray(body.issues)).toBe(true);

    const listed = (await (await listProviders()).json()) as {
      providers: Array<{ baseUrl: string }>;
    };
    expect(listed.providers[0]?.baseUrl).toBe(mock.baseUrl);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await updateProvider(
      jsonRequest("http://localhost/api/providers/nope", "PUT", { name: "X" }),
      params("nope"),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/providers/[id]", () => {
  it("deletes with 204 and removes the provider from the list", async () => {
    await createProvider(jsonRequest("http://localhost/api/providers", "POST", validBody()));
    const res = await deleteProvider(
      new Request("http://localhost/api/providers/mock-provider", { method: "DELETE" }),
      params("mock-provider"),
    );
    expect(res.status).toBe(204);
    const listed = (await (await listProviders()).json()) as { providers: unknown[] };
    expect(listed.providers).toEqual([]);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await deleteProvider(
      new Request("http://localhost/api/providers/nope", { method: "DELETE" }),
      params("nope"),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/providers/[id]/test", () => {
  it("probes the provider once and returns { ok: true, latencyMs }", async () => {
    await createProvider(jsonRequest("http://localhost/api/providers", "POST", validBody()));
    mock.enqueue({ kind: "text", text: "ok" });

    const res = await testProvider(
      new Request("http://localhost/api/providers/mock-provider/test", { method: "POST" }),
      params("mock-provider"),
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expectRedacted(raw);
    const body = JSON.parse(raw) as { ok: boolean; latencyMs: unknown };
    expect(body.ok).toBe(true);
    expect(typeof body.latencyMs).toBe("number");
    expect(mock.requestCount).toBe(1);
  });

  it("maps a provider auth failure to { ok: false, error: { code, message } } without leaking", async () => {
    await createProvider(jsonRequest("http://localhost/api/providers", "POST", validBody()));
    mock.enqueue({ kind: "error", status: 401, message: "bad key" });

    const res = await testProvider(
      new Request("http://localhost/api/providers/mock-provider/test", { method: "POST" }),
      params("mock-provider"),
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expectRedacted(raw);
    const body = JSON.parse(raw) as { ok: boolean; error: { code: unknown; message: unknown } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("auth");
    expect(typeof body.error.message).toBe("string");
    expect((body.error.message as string).length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown id without touching any provider", async () => {
    const res = await testProvider(
      new Request("http://localhost/api/providers/nope/test", { method: "POST" }),
      params("nope"),
    );
    expect(res.status).toBe(404);
    expect(mock.requestCount).toBe(0);
  });
});
