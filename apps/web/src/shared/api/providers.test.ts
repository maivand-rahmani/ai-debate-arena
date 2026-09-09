/**
 * Unit tests for the client-side provider mutation helpers.
 *
 * Backend routes are still landing in parallel; these tests cover the
 * client behaviour by stubbing `fetch`. The shape of the stubs is
 * deliberately verbose so that the next person who lands a server
 * endpoint can plug the real contract in here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProvider,
  deleteProvider,
  fetchProviders,
  ProvidersUnavailableError,
  testProvider,
  updateProvider,
  type RedactedProvider,
} from "./providers";

const stub: RedactedProvider = {
  id: "alpha",
  name: "Alpha",
  baseUrl: "https://alpha.example/v1",
  model: "alpha-default",
  api: "chat",
  apiKeyHint: "alph••••••••lpha",
};

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

interface FetchStub {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  readonly requests: RecordedRequest[];
  setResponder(responder: (request: RecordedRequest) => Response | Promise<Response>): void;
}

function makeFetchStub(): FetchStub {
  const requests: RecordedRequest[] = [];
  let responder: (request: RecordedRequest) => Response | Promise<Response> = () =>
    new Response("not-stubbed", { status: 500 });

  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = typeof input === "string" ? input : input.toString();
    let body: unknown = undefined;
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    const record: RecordedRequest = { method, url, body };
    requests.push(record);
    return await responder(record);
  }) as unknown as FetchStub;

  Object.defineProperty(fn, "requests", { get: () => requests });
  fn.setResponder = (next) => {
    responder = next;
  };
  return fn;
}

let stubFetch: FetchStub;

beforeEach(() => {
  stubFetch = makeFetchStub();
  vi.stubGlobal("fetch", stubFetch as unknown as typeof fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("fetchProviders", () => {
  it("returns the redacted list and normalises entries", async () => {
    stubFetch.setResponder(() =>
      jsonResponse({ providers: [stub, { id: "broken" }, null, { ...stub, api: "soap" }] }),
    );
    const list = await fetchProviders();
    expect(list).toEqual([stub]);
    expect(stubFetch.requests).toHaveLength(1);
    expect(stubFetch.requests[0]?.method).toBe("GET");
    expect(stubFetch.requests[0]?.url).toBe("/api/providers");
  });

  it("returns an empty array when the response has no providers", async () => {
    stubFetch.setResponder(() => jsonResponse({ providers: [] }));
    expect(await fetchProviders()).toEqual([]);
  });

  it("surfaces a typed missing error when the endpoint is unavailable", async () => {
    stubFetch.setResponder(() => new Response("nope", { status: 404 }));
    await expect(fetchProviders()).rejects.toBeInstanceOf(ProvidersUnavailableError);
    await expect(fetchProviders()).rejects.toMatchObject({ code: "missing", status: 404 });
  });
});

describe("createProvider", () => {
  it("POSTs the draft and returns the redacted record", async () => {
    stubFetch.setResponder(() => jsonResponse(stub, 200));
    const result = await createProvider({
      id: "alpha",
      name: "Alpha",
      baseUrl: "https://alpha.example/v1",
      model: "alpha-default",
      api: "chat",
      apiKey: "sk-very-secret",
    });
    expect(result).toEqual(stub);
    const [request] = stubFetch.requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("/api/providers");
    expect(request?.body).toMatchObject({ id: "alpha", apiKey: "sk-very-secret", api: "chat" });
  });

  it("extracts validation issues from a 400 response", async () => {
    stubFetch.setResponder(() =>
      jsonResponse(
        {
          error: "Validation failed",
          issues: [
            { field: "baseUrl", message: "baseUrl must use http or https" },
            { field: "apiKey", message: "apiKey is required" },
          ],
        },
        400,
      ),
    );
    await expect(
      createProvider({
        id: "x",
        name: "X",
        baseUrl: "ftp://nope",
        model: "m",
        api: "chat",
        apiKey: "",
      }),
    ).rejects.toMatchObject({
      code: "validation",
      status: 400,
      issues: [
        { field: "baseUrl", message: "baseUrl must use http or https" },
        { field: "apiKey", message: "apiKey is required" },
      ],
    });
  });
});

describe("updateProvider", () => {
  it("PUTs the patch and returns the redacted record", async () => {
    const updated: RedactedProvider = { ...stub, name: "Alpha Prime" };
    stubFetch.setResponder(() => jsonResponse(updated, 200));
    const result = await updateProvider("alpha", { name: "Alpha Prime" });
    expect(result).toEqual(updated);
    const [request] = stubFetch.requests;
    expect(request?.method).toBe("PUT");
    expect(request?.url).toBe("/api/providers/alpha");
    expect(request?.body).toEqual({ name: "Alpha Prime" });
  });

  it("encodes the id in the URL", async () => {
    stubFetch.setResponder(() => jsonResponse({ ...stub, id: "weird/id" }, 200));
    await updateProvider("weird/id", { name: "Renamed" });
    expect(stubFetch.requests[0]?.url).toBe("/api/providers/weird%2Fid");
  });

  it("treats an empty apiKey as a request to keep the stored key (omits the field)", async () => {
    stubFetch.setResponder(() => jsonResponse(stub, 200));
    await updateProvider("alpha", { name: "Alpha", apiKey: "" });
    expect(stubFetch.requests[0]?.body).toEqual({ name: "Alpha" });
  });

  it("returns a typed missing error for 404", async () => {
    stubFetch.setResponder(() => jsonResponse({ error: "Provider not found" }, 404));
    await expect(updateProvider("ghost", { name: "x" })).rejects.toMatchObject({
      code: "missing",
      status: 404,
    });
  });
});

describe("deleteProvider", () => {
  it("resolves on 204 with no body", async () => {
    stubFetch.setResponder(() => new Response(null, { status: 204 }));
    await expect(deleteProvider("alpha")).resolves.toBeUndefined();
    expect(stubFetch.requests[0]?.method).toBe("DELETE");
  });

  it("rejects with a typed missing error on 404", async () => {
    stubFetch.setResponder(() => jsonResponse({ error: "Provider not found" }, 404));
    await expect(deleteProvider("ghost")).rejects.toMatchObject({ code: "missing", status: 404 });
  });
});

describe("testProvider", () => {
  it("returns the latency payload on success", async () => {
    stubFetch.setResponder(() => jsonResponse({ ok: true, latencyMs: 187 }));
    const result = await testProvider("alpha");
    expect(result).toEqual({ ok: true, latencyMs: 187 });
    expect(stubFetch.requests[0]?.method).toBe("POST");
    expect(stubFetch.requests[0]?.url).toBe("/api/providers/alpha/test");
  });

  it("returns the typed error payload on a logical failure", async () => {
    stubFetch.setResponder(() =>
      jsonResponse({ ok: false, error: { code: "auth", message: "Invalid API key" } }),
    );
    const result = await testProvider("alpha");
    expect(result).toEqual({ ok: false, error: { code: "auth", message: "Invalid API key" } });
  });

  it("rejects on HTTP failure (endpoint missing) as a typed error", async () => {
    stubFetch.setResponder(() => new Response(null, { status: 404 }));
    await expect(testProvider("alpha")).rejects.toMatchObject({ code: "missing", status: 404 });
  });

  it("rejects when the success body is missing latencyMs", async () => {
    stubFetch.setResponder(() => jsonResponse({ ok: true }));
    await expect(testProvider("alpha")).rejects.toBeInstanceOf(ProvidersUnavailableError);
  });
});
