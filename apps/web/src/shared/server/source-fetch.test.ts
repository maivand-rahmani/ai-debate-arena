/**
 * Focused tests for the server-side, explicitly-consented HTTPS source-fetch
 * host (`shared/server/source-fetch.ts`).
 *
 * No test calls the public internet and no test leaves servers open: all
 * network behavior runs through INJECTED DNS lookups and INJECTED dispatchers
 * (fake undici `request` implementations). Real sockets are never opened.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Dispatcher } from "undici";
import {
  computeSourceContentHash,
  issueSourceConsent,
  sourceAdapterRequestSchema,
} from "@arena/debate-engine";
import type { SourceAdapterManifest, SourceConsent } from "@arena/types";
import {
  SOURCE_FETCH_LIMITS,
  classifySourceIp,
  createValidatedSourceLookup,
  fetchSourceCapture,
  htmlToUntrustedText,
  parseSourceReference,
  type SourceDnsLookup,
  type SourceDnsLookupCallback,
  type SourceFetchInput,
  type SourceFetchOptions,
  type SourceFetchResult,
} from "./source-fetch";

vi.mock("server-only", () => ({}));

const REFERENCE = "https://example.com/report-2026";

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function manifest(overrides: Partial<SourceAdapterManifest> = {}): SourceAdapterManifest {
  return {
    schemaVersion: 1,
    adapterId: "srcadp_test",
    version: "1.0.0",
    kind: "external-source",
    displayName: "Test Adapter",
    requestedCapabilities: { "net.fetch": true },
    requiredPermissions: ["net.fetch"],
    requiresExplicitUserAction: true,
    ...overrides,
  };
}

function issuedConsent(reference: string = REFERENCE): SourceConsent {
  const request = {
    schemaVersion: 1,
    manifest: manifest(),
    description: "Capture one consented report.",
  };
  expect(sourceAdapterRequestSchema.safeParse(request).success).toBe(true);
  const issued = issueSourceConsent(request, { reference, decidedAt: new Date(Date.now() - 1000).toISOString() });
  if (!issued.ok) throw new Error(issued.error);
  return issued.consent;
}

function input(overrides: Partial<SourceFetchInput> = {}): SourceFetchInput {
  return {
    manifest: manifest(),
    consent: issuedConsent(),
    reference: REFERENCE,
    grantedPermissions: { "net.fetch": true },
    matchId: "match-1",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Injected test fixtures (no real sockets, no public internet)        */
/* ------------------------------------------------------------------ */

interface RecordedRequest {
  readonly origin: string;
  readonly path: string;
  readonly headers: Record<string, string>;
}

interface FakeDispatcher extends Pick<Dispatcher, "request"> {
  readonly calls: readonly RecordedRequest[];
}

class FakeBody {
  destroyed = false;
  private wake?: () => void;

  constructor(
    private readonly chunks: readonly (string | Uint8Array)[],
    private readonly behavior: { stallForever?: boolean; chunkDelayMs?: number } = {},
  ) {}

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (const chunk of this.chunks) {
      if (this.destroyed) return;
      if (this.behavior.stallForever) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        if (this.destroyed) return;
      }
      if (this.behavior.chunkDelayMs !== undefined) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.behavior.chunkDelayMs);
          this.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        if (this.destroyed) return;
      }
      yield typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.wake?.();
  }
}

interface FakeResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[]>;
  readonly body: FakeBody;
}

function response(
  statusCode: number,
  headers: Record<string, string | string[]>,
  chunks: readonly (string | Uint8Array)[],
  behavior?: { stallForever?: boolean; chunkDelayMs?: number },
): FakeResponse {
  return { statusCode, headers, body: new FakeBody(chunks, behavior) };
}

function fakeDispatcher(
  responder: (opts: { readonly origin: string; readonly path: string }) => FakeResponse,
): FakeDispatcher {
  const calls: RecordedRequest[] = [];
  return {
    calls,
    async request(opts: { origin: string | URL; path: string; headers?: unknown }) {
      const origin = String(opts.origin);
      const path = String(opts.path);
      calls.push({ origin, path, headers: { ...(opts.headers as Record<string, string>) } });
      return responder({ origin, path });
    },
  } as unknown as FakeDispatcher;
}

function lookupReturning(records: readonly { address: string; family: number }[]): SourceDnsLookup {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [...records]);
    else callback(null, records[0]?.address ?? "", records[0]?.family);
  };
}

function lookupFailing(): SourceDnsLookup {
  return (_hostname, _options, callback: SourceDnsLookupCallback) => {
    callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), []);
  };
}

function lookupStalling(): SourceDnsLookup {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (_hostname, _options, _callback) => undefined; // never settles
}

function expectOk(result: SourceFetchResult): Extract<SourceFetchResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok capture, got ${result.reason}`);
  return result;
}

function expectFail(result: SourceFetchResult): Extract<SourceFetchResult, { ok: false }> {
  if (result.ok) throw new Error("expected unavailable result");
  return result;
}

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.PROVIDER_API_KEY;
  delete process.env.ARENA_PROVIDER_KEY;
});

/* ------------------------------------------------------------------ */
/* IP classifier corpus                                                */
/* ------------------------------------------------------------------ */

describe("classifySourceIp (fail-closed corpus)", () => {
  const blocked: ReadonlyArray<readonly [string, string]> = [
    ["127.0.0.1", "loopback"],
    ["127.255.255.255", "loopback"],
    ["::1", "loopback"],
    ["10.0.0.7", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.44.3", "private"],
    ["169.254.169.254", "link-local"], // AWS/GCP metadata endpoint
    ["fe80::1", "link-local"],
    ["fd00:ec2::254", "unique-local"], // AWS IPv6 metadata endpoint
    ["ff02::1", "multicast"],
    ["224.0.0.9", "multicast"],
    ["::", "unspecified"],
    ["0.0.0.0", "unspecified"],
    ["100.64.0.1", "cgnat"],
    ["100.100.100.200", "cgnat"], // Alibaba metadata space
    ["168.63.129.16", "metadata"], // Azure platform metadata
    ["64:ff9b::aabb:ccdd", "nat64"],
    ["64:ff9b:1::10", "nat64"],
    ["2002::aabb", "6to4"],
    ["2001::1", "teredo"],
    ["2001:0:1234::1", "teredo"],
    ["2001:db8::1", "documentation"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
    ["192.0.2.1", "reserved"],
    ["192.0.0.9", "reserved"],
    ["192.88.99.1", "reserved"],
    ["198.18.0.1", "reserved"],
    ["198.51.100.2", "reserved"],
    ["203.0.113.5", "reserved"],
    // IPv4-mapped IPv6 must be normalized and judged on the embedded IPv4.
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:10.1.2.3", "private"],
    ["::ffff:169.254.169.254", "link-local"],
    ["::ffff:7f00:1", "loopback"], // hex form of the embedded IPv4
    ["not-an-ip", "unparseable"],
    ["", "unparseable"],
  ];

  it.each(blocked)("blocks %s (%s)", (address, group) => {
    const verdict = classifySourceIp(address);
    expect(verdict.blocked).toBe(true);
    if (verdict.blocked) expect(verdict.group).toBe(group);
  });

  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["93.184.216.34"],
    ["2606:4700::1111"],
    ["2001:4860:4860::8888"],
    ["::ffff:8.8.8.8"], // mapped, but the embedded IPv4 is public
  ])("allows public %s", (address) => {
    expect(classifySourceIp(address)).toEqual({ blocked: false });
  });
});

/* ------------------------------------------------------------------ */
/* URL policy                                                          */
/* ------------------------------------------------------------------ */

describe("parseSourceReference (URL policy)", () => {
  it("accepts https defaults and explicit 443", () => {
    expect(parseSourceReference("https://example.com/report?a=1")).toEqual({ ok: true, url: expect.any(URL) });
    expect(parseSourceReference("https://example.com:443/report")).toEqual({ ok: true, url: expect.any(URL) });
  });

  it("rejects non-https schemes", () => {
    expect(parseSourceReference("http://example.com/report")).toMatchObject({ ok: false, reason: "scheme-not-https" });
    expect(parseSourceReference("ftp://example.com/report")).toMatchObject({ ok: false, reason: "scheme-not-https" });
  });

  it("rejects non-443 ports", () => {
    expect(parseSourceReference("https://example.com:8443/report")).toMatchObject({ ok: false, reason: "port-not-allowed" });
    expect(parseSourceReference("https://example.com:80/report")).toMatchObject({ ok: false, reason: "port-not-allowed" });
  });

  it("rejects URL credentials/userinfo", () => {
    expect(parseSourceReference("https://user:pass@example.com/report")).toMatchObject({ ok: false, reason: "userinfo-not-allowed" });
    expect(parseSourceReference("https://x@example.com/")).toMatchObject({ ok: false, reason: "userinfo-not-allowed" });
  });

  it("rejects IP literal hosts (plain, bracketed, and URL-normalized forms)", () => {
    expect(parseSourceReference("https://127.0.0.1/")).toMatchObject({ ok: false, reason: "ip-literal-host" });
    expect(parseSourceReference("https://169.254.169.254/latest/meta-data/")).toMatchObject({ ok: false, reason: "ip-literal-host" });
    expect(parseSourceReference("https://[::1]/")).toMatchObject({ ok: false, reason: "ip-literal-host" });
    // WHATWG URL normalizes 2130706433 -> 127.0.0.1 before we see it.
    expect(parseSourceReference("https://2130706433/")).toMatchObject({ ok: false, reason: "ip-literal-host" });
  });

  it("rejects malformed/unsafe hostnames", () => {
    expect(parseSourceReference("https://localhost/")).toMatchObject({ ok: false, reason: "invalid-host" });
    expect(parseSourceReference("https://sub.localhost/")).toMatchObject({ ok: false, reason: "invalid-host" });
    expect(parseSourceReference("https://exa mple.com/")).toMatchObject({ ok: false, reason: "invalid-reference" });
    expect(parseSourceReference("https://exa_mple.com/")).toMatchObject({ ok: false, reason: "invalid-host" });
    expect(parseSourceReference("https://example.com./")).toMatchObject({ ok: false, reason: "invalid-host" });
    expect(parseSourceReference("https://-example.com/")).toMatchObject({ ok: false, reason: "invalid-host" });
    expect(parseSourceReference("https://example..com/")).toMatchObject({ ok: false, reason: "invalid-host" });
    expect(parseSourceReference("https://")).toMatchObject({ ok: false, reason: "invalid-reference" });
  });

  it("rejects malformed references", () => {
    expect(parseSourceReference("not a url")).toMatchObject({ ok: false, reason: "invalid-reference" });
    expect(parseSourceReference("")).toMatchObject({ ok: false, reason: "invalid-reference" });
    expect(parseSourceReference(undefined)).toMatchObject({ ok: false, reason: "invalid-reference" });
    expect(parseSourceReference(`https://example.com/${"x".repeat(2100)}`)).toMatchObject({ ok: false, reason: "invalid-reference" });
  });
});

/* ------------------------------------------------------------------ */
/* Consent gate (default/off/mismatch/expiry/permissions)              */
/* ------------------------------------------------------------------ */

describe("fetchSourceCapture consent gate (all before any socket)", () => {
  it("fails with consent-missing when no consent is present", async () => {
    const result = await fetchSourceCapture(input({ consent: undefined }));
    expect(expectFail(result).reason).toBe("consent-missing");
  });

  it("fails with consent-missing when consent is not granted", async () => {
    const result = await fetchSourceCapture(input({ consent: { ...issuedConsent(), granted: false } }));
    expect(expectFail(result).reason).toBe("consent-missing");
  });

  it("fails with consent-invalid for silently-false user-action confirmation", async () => {
    const result = await fetchSourceCapture(input({ consent: { ...issuedConsent(), confirmedByUserAction: false } }));
    expect(expectFail(result).reason).toBe("consent-invalid");
  });

  it("fails with consent-expired for an expired consent", async () => {
    const request = {
      schemaVersion: 1,
      manifest: manifest(),
      description: "Capture one consented report.",
    };
    const issued = issueSourceConsent(request, {
      reference: REFERENCE,
      decidedAt: new Date(Date.now() - 7_200_000).toISOString(),
      ttlSeconds: 3600,
    });
    if (!issued.ok) throw new Error(issued.error);
    const result = await fetchSourceCapture(input({ consent: issued.consent }));
    expect(expectFail(result).reason).toBe("consent-expired");
  });

  it("fails with consent-replayed on reference mismatch", async () => {
    const result = await fetchSourceCapture(input({ reference: "https://example.com/other-report" }));
    expect(expectFail(result).reason).toBe("consent-replayed");
  });

  it("fails with consent-replayed on match binding mismatch", async () => {
    const result = await fetchSourceCapture(input({ consent: { ...issuedConsent(), matchId: "match-other" } }));
    expect(expectFail(result).reason).toBe("consent-replayed");
  });

  it("fails with consent-replayed on request binding mismatch", async () => {
    const consent = { ...issuedConsent(), requestId: "req-other" };
    const result = await fetchSourceCapture(input({ consent, requestId: "req-1" }));
    expect(expectFail(result).reason).toBe("consent-replayed");
  });

  it("fails with invalid-reference before any socket when the consented reference is not an https URL", async () => {
    // A bare locator is schema-safe for storage but is never fetchable here.
    const bare = "example-report-2026";
    const result = await fetchSourceCapture(input({ consent: issuedConsent(bare), reference: bare }));
    expect(expectFail(result).reason).toBe("invalid-reference");
  });

  it("fails with invalid-request for a malformed server-owned manifest", async () => {
    const result = await fetchSourceCapture(input({ manifest: { ...manifest(), adapterId: "nope" } }));
    expect(expectFail(result).reason).toBe("invalid-request");
  });

  it("fails with permission-unmet when net.fetch is not granted", async () => {
    const result = await fetchSourceCapture(input({ grantedPermissions: {} }));
    expect(expectFail(result).reason).toBe("permission-unmet");
  });

  it("fails with capability-denied when granted capabilities do not cover the request", async () => {
    const result = await fetchSourceCapture(input({ consent: { ...issuedConsent(), grantedCapabilities: {} } }));
    expect(expectFail(result).reason).toBe("capability-denied");
  });
});

/* ------------------------------------------------------------------ */
/* Custom validated DNS lookup (rebinding)                             */
/* ------------------------------------------------------------------ */

describe("createValidatedSourceLookup (custom lookup rebinding)", () => {
  it("resolves with all:true/verbatim:true and passes public records through", async () => {
    const underlying = vi.fn((hostname: string, options: { all?: boolean }, cb: SourceDnsLookupCallback) => {
      cb(null, [{ address: "93.184.216.34", family: 4 }]);
    }) as unknown as SourceDnsLookup;
    const wrapped = createValidatedSourceLookup(underlying);
    const result = await callLookup(wrapped);
    expect(result).toMatchObject({ ok: true, records: [{ address: "93.184.216.34", family: 4 }] });
    expect(underlying).toHaveBeenCalledWith("example.com", { all: true, verbatim: true }, expect.any(Function));
  });

  it("denies the connection when ANY record is loopback/private/metadata/tunneled", async () => {
    for (const [address, family] of [
      ["127.0.0.1", 4],
      ["::1", 6],
      ["10.0.0.1", 4],
      ["169.254.169.254", 4],
      ["::ffff:10.0.0.1", 6],
      ["64:ff9b::1", 6],
      ["2002::1", 6],
    ] as const) {
      const wrapped = createValidatedSourceLookup(lookupReturning([{ address, family }]));
      expect(await callLookup(wrapped)).toMatchObject({ ok: false, error: { code: "E_SOURCE_DNS_BLOCKED" } });
    }
  });

  it("denies when ANY of several records is unsafe (fail closed)", async () => {
    const wrapped = createValidatedSourceLookup(lookupReturning([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.9", family: 4 },
    ]));
    expect(await callLookup(wrapped)).toMatchObject({ ok: false });
  });

  it("maps resolver failures to a safe dns-failure code", async () => {
    const wrapped = createValidatedSourceLookup(lookupFailing());
    expect(await callLookup(wrapped)).toMatchObject({
      ok: false,
      error: { code: "E_SOURCE_DNS_FAILED", message: "source dns lookup failed" },
    });
  });

  it("denies empty resolution", async () => {
    const wrapped = createValidatedSourceLookup(lookupReturning([]));
    expect(await callLookup(wrapped)).toMatchObject({ ok: false, error: { code: "E_SOURCE_DNS_FAILED" } });
  });

  it("times out a never-settling resolver", async () => {
    const wrapped = createValidatedSourceLookup(lookupStalling(), 10);
    expect(await callLookup(wrapped)).toMatchObject({ ok: false, error: { code: "E_SOURCE_DNS_TIMEOUT" } });
  });
});

type LookupCallResult =
  | { readonly ok: true; readonly records: unknown }
  | { readonly ok: false; readonly error?: { readonly code?: string; readonly message: string } };

async function callLookup(wrapped: SourceDnsLookup): Promise<LookupCallResult> {
  return await new Promise((resolve) => {
    wrapped("example.com", { all: true }, (err, address) => {
      if (err) {
        resolve({ ok: false, error: { code: (err as { code?: string }).code, message: err.message } });
      } else {
        resolve({ ok: true, records: address });
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Capture protocol (redirects, headers, body, timeouts)               */
/* ------------------------------------------------------------------ */

describe("fetchSourceCapture capture behavior (injected dispatcher)", () => {
  it("captures text/plain and stamps hash/bytes server-side", async () => {
    const dispatcher = fakeDispatcher(() => response(200, { "content-type": "text/plain; charset=utf-8" }, ["hello, ", "wörld ✅"]));
    const result = expectOk(await fetchSourceCapture(input(), { dispatcher }));
    expect(result.capture.reference).toBe(REFERENCE);
    expect(result.capture.contentType).toBe("text/plain");
    expect(result.capture.content).toBe("hello, wörld ✅");
    expect(result.capture.contentBytes).toBe(Buffer.byteLength("hello, wörld ✅", "utf8"));
    expect(result.capture.contentHash).toBe(computeSourceContentHash("hello, wörld ✅"));
    expect(result.redirects).toBe(0);
    expect(result.httpStatus).toBe(200);
  });

  it("captures markdown content types", async () => {
    const dispatcher = fakeDispatcher(() => response(200, { "content-type": "text/markdown" }, ["# Title\n\nBody"]));
    expect(expectOk(await fetchSourceCapture(input(), { dispatcher })).capture.contentType).toBe("text/markdown");
  });

  it("rejects non-2xx final statuses", async () => {
    const dispatcher = fakeDispatcher(() => response(404, { "content-type": "text/plain" }, ["nope"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher })).reason).toBe("status-not-ok");
  });

  it("rejects missing and non-text content types", async () => {
    const missing = fakeDispatcher(() => response(200, {}, ["x"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher: missing })).reason).toBe("content-type-unsupported");
    const binary = fakeDispatcher(() => response(200, { "content-type": "application/octet-stream" }, [Buffer.from([0, 1, 2])]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher: binary })).reason).toBe("content-type-unsupported");
    const json = fakeDispatcher(() => response(200, { "content-type": "application/json" }, ["{}"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher: json })).reason).toBe("content-type-unsupported");
  });

  it("rejects empty bodies", async () => {
    const dispatcher = fakeDispatcher(() => response(200, { "content-type": "text/plain" }, ["   \n  "]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher })).reason).toBe("empty-body");
  });

  it("rejects invalid UTF-8 bodies (fail closed)", async () => {
    const dispatcher = fakeDispatcher(() => response(200, { "content-type": "text/plain" }, [Buffer.from([0xff, 0xfe, 0xfd])]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher })).reason).toBe("body-error");
  });

  it("aborts when a single body exceeds the decoded-byte cap", async () => {
    const dispatcher = fakeDispatcher(() => response(200, { "content-type": "text/plain" }, ["abcdefghij"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher, limits: { maxContentBytes: 8 } })).reason).toBe("body-too-large");
  });

  it("aborts when many small chunks accumulate past the cap", async () => {
    const dispatcher = fakeDispatcher(() =>
      response(200, { "content-type": "text/plain" }, ["aaaa", "bbbb", "cccc", "dddd"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher, limits: { maxContentBytes: 10 } })).reason).toBe("body-too-large");
  });

  it("times out a stalled body and never buffers it", async () => {
    const dispatcher = fakeDispatcher(() => response(200, { "content-type": "text/plain" }, ["start"], { stallForever: true }));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher, limits: { overallTimeoutMs: 60 } })).reason).toBe("timeout");
  });

  it("times out a slow-drip body at the overall deadline", async () => {
    const dispatcher = fakeDispatcher(() =>
      response(200, { "content-type": "text/plain" }, ["a", "b", "c"], { chunkDelayMs: 30 }));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher, limits: { overallTimeoutMs: 60 } })).reason).toBe("timeout");
  });

  it("sends only the fixed safe headers (no cookies, auth, keys, or provider env)", async () => {
    process.env.OPENAI_API_KEY = "sk-secret-test";
    process.env.PROVIDER_API_KEY = "pk-secret-test";
    const dispatcher = fakeDispatcher(() => response(200, { "content-type": "text/plain" }, ["ok"]));
    expectOk(await fetchSourceCapture(input(), { dispatcher }));
    expect(dispatcher.calls).toHaveLength(1);
    const sent = dispatcher.calls[0].headers;
    expect(Object.keys(sent).sort()).toEqual(["accept", "accept-encoding", "user-agent"]);
    const serialized = JSON.stringify(sent).toLowerCase();
    expect(serialized).not.toContain("sk-secret-test");
    expect(serialized).not.toContain("pk-secret-test");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("authorization");
  });

  it("follows same-host https redirects manually and cancels redirect bodies", async () => {
    const dispatcher = fakeDispatcher(({ path }: { path: string }) =>
      path === "/report-2026"
        ? response(301, { location: "https://example.com/report-final" }, ["REDIRECT-BODY"])
        : response(200, { "content-type": "text/plain" }, ["final content"]));
    const result = expectOk(await fetchSourceCapture(input(), { dispatcher }));
    expect(result.redirects).toBe(1);
    expect(result.capture.content).toBe("final content");
    // The redirect response's body is always cancelled.
    expect(dispatcher.calls).toHaveLength(2);
  });

  it("follows relative Location headers against the current URL", async () => {
    const dispatcher = fakeDispatcher(({ path }: { path: string }) =>
      path === "/report-2026"
        ? response(302, { location: "/other-path" }, ["x"])
        : response(200, { "content-type": "text/plain" }, ["rel ok"]));
    expect(expectOk(await fetchSourceCapture(input(), { dispatcher })).redirects).toBe(1);
  });

  it("refuses a downgrade to http:// (even on the same host)", async () => {
    const dispatcher = fakeDispatcher(() => response(301, { location: "http://example.com/report-final" }, ["x"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher })).reason).toBe("scheme-not-https");
  });

  it("refuses cross-host redirects", async () => {
    const dispatcher = fakeDispatcher(() => response(301, { location: "https://other.example.org/report-final" }, ["x"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher })).reason).toBe("host-mismatch");
  });

  it("refuses redirects to IP literals", async () => {
    const dispatcher = fakeDispatcher(() => response(301, { location: "https://127.0.0.1/report-final" }, ["x"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher })).reason).toBe("ip-literal-host");
  });

  it("refuses more than the bounded redirect count", async () => {
    let hop = 0;
    const dispatcher = fakeDispatcher(() => {
      hop += 1;
      return response(301, { location: `https://example.com/hop-${hop}` }, ["x"]);
    });
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher })).reason).toBe("too-many-redirects");
  });

  it("detects redirect loops", async () => {
    const dispatcher = fakeDispatcher(({ path }: { path: string }) =>
      path === "/report-2026"
        ? response(301, { location: "https://example.com/loop-b" }, ["x"])
        : response(301, { location: "https://example.com/report-2026" }, ["x"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher })).reason).toBe("redirect-loop");
  });

  it("refuses oversized/missing Location headers", async () => {
    const long = fakeDispatcher(() => response(301, { location: `https://example.com/${"x".repeat(3000)}` }, ["x"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher: long })).reason).toBe("redirect-unsafe");
    const missing = fakeDispatcher(() => response(301, {}, ["x"]));
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher: missing })).reason).toBe("redirect-unsafe");
  });
});

/* ------------------------------------------------------------------ */
/* Fail-closed error mapping                                           */
/* ------------------------------------------------------------------ */

describe("fetchSourceCapture fail-closed errors", () => {
  it("maps thrown dispatcher errors to safe reasons without leaking details", async () => {
    const generic = fakeDispatcher(() => {
      throw new Error("getaddrinfo ENOTFOUND example.com socket 10.0.0.1 https://example.com/report-2026");
    });
    const genericResult = expectFail(await fetchSourceCapture(input(), { dispatcher: generic }));
    expect(genericResult.reason).toBe("connect-failure");
    expect(JSON.stringify(genericResult)).not.toContain("10.0.0.1");
    expect(JSON.stringify(genericResult)).not.toContain("ENOTFOUND");

    const blocked = fakeDispatcher(() => {
      throw Object.assign(new Error("blocked"), { code: "E_SOURCE_DNS_BLOCKED" });
    });
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher: blocked })).reason).toBe("dns-blocked");

    const dnsFail = fakeDispatcher(() => {
      throw Object.assign(new Error("failed"), { code: "E_SOURCE_DNS_FAILED" });
    });
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher: dnsFail })).reason).toBe("dns-failure");

    const tls = fakeDispatcher(() => {
      throw Object.assign(new Error("tls"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    });
    expect(expectFail(await fetchSourceCapture(input(), { dispatcher: tls })).reason).toBe("tls-failure");
  });

  it("rejects out-of-bounds limit overrides (fail closed)", async () => {
    const result = await fetchSourceCapture(input(), { limits: { maxContentBytes: SOURCE_FETCH_LIMITS.maxContentBytes + 1 } });
    expect(expectFail(result).reason).toBe("invalid-request");
  });

  it("never includes hostnames, URLs, or addresses in any result", async () => {
    const cases: ReadonlyArray<readonly [SourceFetchInput, SourceFetchOptions]> = [
      [input({ reference: "https://127.0.0.1/x" }), {}],
      [input({ consent: undefined }), {}],
      [input({ grantedPermissions: {} }), {}],
    ];
    for (const [caseInput, caseOptions] of cases) {
      const result = await fetchSourceCapture(caseInput, caseOptions);
      expect(JSON.stringify(result)).not.toMatch(/127\.0\.0\.1|169\.254|http:\/\//);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Static safety checks (no provider imports, no global dispatcher)    */
/* ------------------------------------------------------------------ */

describe("source-fetch module static safety", () => {
  const moduleSource = readFileSync(fileURLToPath(new URL("./source-fetch.ts", import.meta.url)), "utf8");

  it("imports only pinned undici Agent — no global dispatcher or proxy env agents", () => {
    expect(moduleSource).toContain('from "undici"');
    expect(moduleSource).not.toMatch(/setGlobalDispatcher|getGlobalDispatcher/);
    expect(moduleSource).not.toMatch(/EnvHttpProxyAgent|ProxyAgent|MockAgent/);
    expect(moduleSource).not.toMatch(/globalThis\.fetch|global\.fetch/);
  });

  it("reads no provider configuration or environment values", () => {
    expect(moduleSource).not.toMatch(/process\.env/);
    expect(moduleSource).not.toMatch(/@arena\/ai|provider-db|provider-store|providerStore/);
    expect(moduleSource).not.toMatch(/@ai-sdk|node:child_process|node:vm/);
  });

  it("uses node dns.lookup with all:true + verbatim:true", () => {
    expect(moduleSource).toContain("{ all: true, verbatim: true }");
  });

  it("strips markup, scripts, and styles from untrusted HTML", () => {
    const text = htmlToUntrustedText(
      "<html><head><style>body { color: red }</style></head><body><h1>Title</h1><script>alert('x')</script><p>Body &amp; more</p></body></html>",
    );
    expect(text).not.toContain("<");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color: red");
    expect(text).toContain("Title");
    expect(text).toContain("Body & more");
  });
});
