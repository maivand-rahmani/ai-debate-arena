import "server-only";

/**
 * Server-side, explicitly-consented HTTPS source-adapter host (v0.4).
 *
 * This module performs ONE bounded, consent-gated HTTPS capture of the exact
 * `SourceConsent.reference` the server pinned (never a client-supplied URL),
 * and returns a server-stamped capture suitable for the pure ingest boundary
 * (`ingestSourceCapture` in `@arena/debate-engine`). There is NO public
 * URL-fetch route, no automatic refresh, no provider headers/keys, no caching,
 * and no UI here — the caller must already hold the bound consent.
 *
 * Safety properties enforced below:
 * - The existing source gate (`validateSourceGate`) is validated BEFORE any
 *   socket: schema-valid server-owned manifest, schema-valid consent, explicit
 *   user action, granted, unexpired, exact adapter id/version, exact
 *   match/request/reference binding, capabilities covered, and required
 *   permissions granted. `net.fetch` must be explicitly granted (deny-by
 *   -default) even if the manifest does not require it.
 * - HTTPS only: `https:` scheme, empty username/password, explicit port only
 *   `443` (or default), hostname policy (no IP literals, no localhost, bounded
 *   ASCII labels, no control/percent/host hacks). Reference/consent host
 *   mismatches are rejected.
 * - Explicit pinned `undici` dependency (never global `fetch`) and a
 *   dedicated per-call `Agent` (never the global dispatcher, never proxy env
 *   agents). The agent's connect uses a custom DNS lookup that resolves ALL
 *   records with `dns.lookup(all: true, verbatim: true)` and denies the
 *   connection if ANY record is loopback / private / link-local / metadata /
 *   unspecified / multicast / NAT64 / 6to4 / Teredo / ULA / CGNAT / reserved
 *   (fail closed; see `classifySourceIp`). Validation runs on EVERY
 *   connection attempt.
 * - Manual redirects only: at most `maxRedirects` hops, each hop re-validated
 *   (HTTPS only, no downgrade, same consented host only, no userinfo, no IP
 *   literals, no loops); redirect response bodies are always cancelled.
 * - Fixed safe request headers only: bounded `accept`, `accept-encoding:
 *   identity`, and a fixed bounded `user-agent`. No Cookie, Authorization,
 *   API keys, provider env values, or arbitrary client headers are ever
 *   forwarded (headers are constructed fresh; nothing is copied from input).
 * - Dedicated timeouts (connect, DNS, headers, inter-body-chunk, overall
 *   deadline) with a fail-closed typed result. Response bodies are streamed
 *   with a decoded-UTF-8 byte cap; nothing unbounded is ever buffered.
 * - Only `text/plain` and `text/markdown` are accepted (plus `text/html`
 *   ONLY when the caller explicitly opts in via `allowHtmlText`, in which
 *   case the markup is stripped server-side and captured as untrusted
 *   `text/plain` — never rendered, never executed). Binary or unknown
 *   content types are rejected.
 * - Remote-supplied hash/freshness/headers are never trusted: the capture's
 *   hash and exact UTF-8 byte count are recomputed server-side from the
 *   decoded text; ingest re-verifies both.
 * - Raw network errors, URLs, DNS records, and internal addresses are never
 *   exposed — every failure is returned as a safe reason code only.
 */
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, type Dispatcher } from "undici";
import {
  SOURCE_ADAPTER_LIMITS,
  computeSourceContentHash,
  sourceAdapterManifestSchema,
  sourceContentBytes,
  validateSourceGate,
} from "@arena/debate-engine";

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/** Hard limits for the consented source fetch. All are server-owned. */
export const SOURCE_FETCH_LIMITS = Object.freeze({
  /** Maximum redirect hops followed (manual loop; never auto-followed). */
  maxRedirects: 3,
  /** Max DNS resolution time (ms). */
  lookupTimeoutMs: 5_000,
  /** Max TCP/TLS connect time (ms). */
  connectTimeoutMs: 5_000,
  /** Max time waiting for response headers (ms). */
  headersTimeoutMs: 10_000,
  /** Max time between body chunks (ms). */
  bodyTimeoutMs: 10_000,
  /** Overall wall-clock deadline for the whole capture (ms). */
  overallTimeoutMs: 30_000,
  /** Max UTF-8 bytes captured (must match the ingest contract). */
  maxContentBytes: SOURCE_ADAPTER_LIMITS.maxContentBytes,
  /** Max chars accepted for a `Location` header. */
  maxLocationChars: 2_000,
  /** Fixed bounded user-agent (no environment-derived values). */
  userAgent:
    "ai-debate-arena-source-fetch/0.4 (consent-gated; sends no credentials)",
} as const);

const MAX_ORIGINS = SOURCE_FETCH_LIMITS.maxRedirects + 1;

/** Overridable limits (for focused tests); values are clamped to hard caps. */
type OverridableLimitKey =
  | "lookupTimeoutMs"
  | "connectTimeoutMs"
  | "headersTimeoutMs"
  | "bodyTimeoutMs"
  | "overallTimeoutMs"
  | "maxContentBytes"
  | "maxLocationChars"
  | "maxRedirects";

const OVERRIDABLE_LIMITS: Readonly<Record<OverridableLimitKey, number>> = Object.freeze({
  lookupTimeoutMs: SOURCE_FETCH_LIMITS.lookupTimeoutMs,
  connectTimeoutMs: SOURCE_FETCH_LIMITS.connectTimeoutMs,
  headersTimeoutMs: SOURCE_FETCH_LIMITS.headersTimeoutMs,
  bodyTimeoutMs: SOURCE_FETCH_LIMITS.bodyTimeoutMs,
  overallTimeoutMs: SOURCE_FETCH_LIMITS.overallTimeoutMs,
  maxContentBytes: SOURCE_FETCH_LIMITS.maxContentBytes,
  maxLocationChars: SOURCE_FETCH_LIMITS.maxLocationChars,
  maxRedirects: SOURCE_FETCH_LIMITS.maxRedirects,
});

export type SourceFetchLimits = Partial<Record<OverridableLimitKey, number>>;

type ResolvedLimits = Record<OverridableLimitKey, number>;

function resolveLimits(overrides?: SourceFetchLimits): ResolvedLimits {
  const merged = { ...SOURCE_FETCH_LIMITS } as ResolvedLimits;
  if (overrides) {
    for (const [key, hardMax] of Object.entries(OVERRIDABLE_LIMITS)) {
      const value = (overrides as Record<string, unknown>)[key];
      if (value === undefined) continue;
      const isPositive = typeof value === "number" && Number.isInteger(value) && value > 0;
      if (!isPositive || value > hardMax) {
        throw new Error(`source fetch limit out of bounds: ${key}`);
      }
      (merged as Record<string, number>)[key] = value;
    }
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Typed results (safe reason codes only — no raw errors/URLs)         */
/* ------------------------------------------------------------------ */

export type SourceFetchReason =
  /** Server-owned manifest/request/reference shape failed pre-socket checks. */
  | "invalid-request"
  /** Consent gate outcomes (mapped from `validateSourceGate`). */
  | "consent-missing"
  | "consent-expired"
  | "consent-replayed"
  | "capability-denied"
  | "permission-unmet"
  | "consent-invalid"
  /** The consent pins a different host/origin than the request reference. */
  | "reference-mismatch"
  | "host-mismatch"
  /** URL policy. */
  | "invalid-reference"
  | "scheme-not-https"
  | "port-not-allowed"
  | "ip-literal-host"
  | "invalid-host"
  | "userinfo-not-allowed"
  /** DNS/connect policy and failures. */
  | "dns-blocked"
  | "dns-failure"
  | "connect-failure"
  | "tls-failure"
  /** Timeouts (DNS, connect, headers, body stall, overall deadline). */
  | "timeout"
  /** HTTP-level refusal (non-2xx final status). */
  | "status-not-ok"
  | "content-type-unsupported"
  | "body-too-large"
  | "body-error"
  | "empty-body"
  /** Redirect policy. */
  | "too-many-redirects"
  | "redirect-unsafe"
  | "redirect-loop";

/** Server-stamped capture, directly usable as the ingest capture content. */
export interface SourceFetchCapture {
  /** The exact consented reference that was captured (string-identical). */
  readonly reference: string;
  /** Text content type (always a text type the ingest contract accepts). */
  readonly contentType: "text/plain" | "text/markdown";
  /** The decoded, untrusted text content (bounded to `maxContentBytes`). */
  readonly content: string;
  /** Exact UTF-8 byte length of `content` (recomputed server-side). */
  readonly contentBytes: number;
  /** Server-computed SHA-256 hex of the exact UTF-8 bytes of `content`. */
  readonly contentHash: string;
}

export type SourceFetchResult =
  | {
      readonly ok: true;
      readonly capture: SourceFetchCapture;
      /** Bounded, credential-free, server-stamped metadata. */
      readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
      /** How many redirect hops were followed (0 = direct capture). */
      readonly redirects: number;
      /** Final HTTP status (2xx). */
      readonly httpStatus: number;
    }
  | {
      readonly ok: false;
      /** Safe reason code only — never raw errors, URLs, or addresses. */
      readonly reason: SourceFetchReason;
    };

/* ------------------------------------------------------------------ */
/* DNS + IP classification                                             */
/* ------------------------------------------------------------------ */

/**
 * Deny classification for one IP address. Anything not recognized as a
 * public global-unicast address is blocked (fail closed), including:
 * loopback, RFC1918 private, link-local (AWS/GCP metadata endpoints),
 * unique-local (AWS `fd00:ec2::` metadata), multicast, unspecified,
 * IPv4-mapped IPv6 (evaluated against the embedded IPv4), NAT64
 * (`64:ff9b::/96`, `64:ff9b:1::/48`), 6to4 (`2002::/16`), Teredo
 * (`2001::/32`), carrier-grade NAT (Alibaba metadata space), Azure platform
 * metadata (`168.63.129.16`), documentation, benchmarking, and reserved
 * ranges.
 */
export type SourceIpVerdict =
  | { readonly blocked: false }
  | { readonly blocked: true; readonly group: string };

export function classifySourceIp(address: string): SourceIpVerdict {
  const raw = typeof address === "string" ? address.trim() : "";
  if (!raw) return { blocked: true, group: "unparseable" };
  // Strip any IPv6 zone id before parsing.
  const candidate = raw.split("%")[0];
  if (isIP(candidate) === 0) return { blocked: true, group: "unparseable" };
  let parsed: ReturnType<typeof ipaddr.parse>;
  try {
    parsed = ipaddr.parse(candidate);
  } catch {
    return { blocked: true, group: "unparseable" };
  }
  if (parsed.kind() === "ipv4") {
    return classifyIpv4Octets((parsed as (typeof ipaddr.IPv4)["prototype"] & { octets: number[] }).octets);
  }
  return classifyIpv6Words((parsed as (typeof ipaddr.IPv6)["prototype"] & { parts: number[] }).parts);
}

function classifyIpv4Octets(octets: number[]): SourceIpVerdict {
  if (!Array.isArray(octets) || octets.length !== 4) return { blocked: true, group: "unparseable" };
  const [a, b] = octets;
  if (a === 0) return { blocked: true, group: "unspecified" };
  if (a === 127) return { blocked: true, group: "loopback" };
  if (a === 10) return { blocked: true, group: "private" };
  if (a === 172 && b >= 16 && b <= 31) return { blocked: true, group: "private" };
  if (a === 192 && b === 168) return { blocked: true, group: "private" };
  if (a === 169 && b === 254) return { blocked: true, group: "link-local" };
  if (a === 168 && b === 63) return { blocked: true, group: "metadata" }; // Azure platform range
  if (a === 100 && b >= 64 && b <= 127) return { blocked: true, group: "cgnat" };
  if (a >= 224 && a <= 239) return { blocked: true, group: "multicast" };
  if (a >= 240) return { blocked: true, group: "reserved" }; // includes broadcast 255.255.255.255
  if (a === 192 && b === 0) return { blocked: true, group: "reserved" }; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 192 && b === 88 && octets[2] === 99) return { blocked: true, group: "reserved" }; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return { blocked: true, group: "reserved" }; // benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return { blocked: true, group: "reserved" };
  if (a === 203 && b === 0 && octets[2] === 113) return { blocked: true, group: "reserved" };
  return { blocked: false };
}

function classifyIpv6Words(words: number[]): SourceIpVerdict {
  if (!Array.isArray(words) || words.length !== 8) return { blocked: true, group: "unparseable" };
  const isZero = (from: number, to: number) => words.slice(from, to).every((w) => w === 0);
  // IPv4-mapped IPv6 (::ffff:0:0/96) — normalize and classify the IPv4.
  if (isZero(0, 5) && words[5] === 0xffff) {
    return classifyIpv4Octets([words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff]);
  }
  // NAT64: well-known prefix 64:ff9b::/96 and local-use 64:ff9b:1::/48.
  if (words[0] === 0x0064 && words[1] === 0xff9b) return { blocked: true, group: "nat64" };
  if (isZero(0, 8)) return { blocked: true, group: "unspecified" };
  if (isZero(0, 7) && words[7] === 1) return { blocked: true, group: "loopback" };
  if (words[0] === 0x2001 && words[1] === 0) return { blocked: true, group: "teredo" };
  if (words[0] === 0x2002) return { blocked: true, group: "6to4" };
  if (words[0] === 0x2001 && words[1] === 0x0db8) return { blocked: true, group: "documentation" };
  if (words[0] === 0x0100) return { blocked: true, group: "discard-only" };
  if ((words[0] & 0xffc0) === 0xfe80) return { blocked: true, group: "link-local" };
  if ((words[0] & 0xfe00) === 0xfc00) return { blocked: true, group: "unique-local" };
  if ((words[0] & 0xff00) === 0xff00) return { blocked: true, group: "multicast" };
  if (words[0] === 0x2001 && (words[1] === 0x0010 || words[1] === 0x0020)) {
    return { blocked: true, group: "orchid" };
  }
  return { blocked: false };
}

/* ------------------------------------------------------------------ */
/* Custom validated DNS lookup (injected into the dedicated agent)     */
/* ------------------------------------------------------------------ */

export type SourceDnsRecord = { readonly address: string; readonly family: number };

export type SourceDnsLookupCallback = (
  err: (Error & { readonly code?: string }) | null,
  address: string | SourceDnsRecord[],
  family?: number,
) => void;

/**
 * Node-compatible lookup function (`net`/`tls` `lookup` option): resolves
 * ALL records via `dns.lookup(all: true, verbatim: true)` and fails closed —
 * if ANY resolved record is non-public the connection is denied. Runs on
 * every connection attempt (initial request and every redirect hop).
 */
export type SourceDnsLookupOptions = {
  all?: boolean;
  verbatim?: boolean;
  /** Node allows either a numeric family or `"IPv4"`/`"IPv6"`. */
  family?: number | string;
};

/**
 * Node-compatible lookup function (`net`/`tls` `lookup` option): resolves
 * ALL records via `dns.lookup(all: true, verbatim: true)` and fails closed —
 * if ANY resolved record is non-public the connection is denied. Runs on
 * every connection attempt (initial request and every redirect hop).
 */
export type SourceDnsLookup = (
  hostname: string,
  options: SourceDnsLookupOptions,
  callback: SourceDnsLookupCallback,
) => void;

const DNS_ERR = Object.freeze({
  blocked: "E_SOURCE_DNS_BLOCKED",
  failed: "E_SOURCE_DNS_FAILED",
  timeout: "E_SOURCE_DNS_TIMEOUT",
} as const);

const dnsAllLookup: SourceDnsLookup = (hostname, _options, callback) => {
  dnsLookup(
    hostname,
    { all: true, verbatim: true },
    (err, addresses) => {
      if (err) {
        callback(Object.assign(new Error("source dns lookup failed"), { code: DNS_ERR.failed }), []);
        return;
      }
      callback(null, addresses ?? []);
    },
  );
};

export function createValidatedSourceLookup(
  underlying: SourceDnsLookup = dnsAllLookup,
  lookupTimeoutMs: number = SOURCE_FETCH_LIMITS.lookupTimeoutMs,
): SourceDnsLookup {
  return (hostname, options, callback) => {
    let settled = false;
    const finish = (
      err: (Error & { readonly code?: string }) | null,
      address: string | SourceDnsRecord[] = [],
      family?: number,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(err, address, family);
    };
    const timer = setTimeout(() => {
      finish(Object.assign(new Error("source dns lookup timed out"), { code: DNS_ERR.timeout }));
    }, lookupTimeoutMs);
    timer.unref?.();

    if (typeof hostname !== "string" || hostname.length === 0 || hostname.length > 253) {
      finish(Object.assign(new Error("source dns lookup failed"), { code: DNS_ERR.failed }));
      return;
    }
    // Defense in depth: an IP literal reaching this point must itself pass
    // the classifier (the URL policy already rejects IP literals).
    if (isIP(hostname) !== 0) {
      const verdict = classifySourceIp(hostname);
      if (verdict.blocked) {
        finish(Object.assign(new Error("source dns lookup blocked"), { code: DNS_ERR.blocked }));
        return;
      }
      finish(null, [{ address: hostname, family: isIP(hostname) }]);
      return;
    }

    let done = false;
    try {
      underlying(
        hostname,
        { all: true, verbatim: true },
        (err, records, family) => {
          if (done) return;
          if (err) {
            done = true;
            finish(Object.assign(new Error("source dns lookup failed"), { code: DNS_ERR.failed }));
            return;
          }
          const rawRecords = records ?? [];
          const list: SourceDnsRecord[] = Array.isArray(rawRecords)
            ? rawRecords.filter(
                (r): r is SourceDnsRecord =>
                  typeof r === "object" && r !== null && typeof (r as SourceDnsRecord).address === "string",
              )
            : typeof rawRecords === "string"
              ? [{ address: rawRecords, family: typeof family === "number" ? family : 0 }]
              : [];
          if (list.length === 0) {
            done = true;
            finish(Object.assign(new Error("source dns lookup failed"), { code: DNS_ERR.failed }));
            return;
          }
          for (const record of list) {
            const verdict = classifySourceIp(record.address);
            if (verdict.blocked) {
              done = true;
              finish(Object.assign(new Error("source dns lookup blocked"), { code: DNS_ERR.blocked }));
              return;
            }
          }
          done = true;
          const wanted = options.family === 4 ? 4 : options.family === 6 ? 6 : 0;
          const eligible = wanted === 0 ? list : list.filter((r) => r.family === wanted);
          if (eligible.length === 0) {
            finish(Object.assign(new Error("source dns lookup failed"), { code: DNS_ERR.failed }));
            return;
          }
          if (options.all) {
            finish(null, eligible);
          } else {
            finish(null, eligible[0].address, eligible[0].family);
          }
        },
      );
    } catch {
      finish(Object.assign(new Error("source dns lookup failed"), { code: DNS_ERR.failed }));
    }
  };
}

/* ------------------------------------------------------------------ */
/* URL policy                                                          */
/* ------------------------------------------------------------------ */

export type SourceUrlCheck = { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly reason: SourceFetchReason };

/** Validate one already-parsed fetchable URL against the strict host policy. */
export function checkFetchableSourceUrl(
  url: URL,
  allowedHostname?: string,
): { ok: true } | { ok: false; reason: SourceFetchReason } {
  if (url.protocol !== "https:") return { ok: false, reason: "scheme-not-https" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "userinfo-not-allowed" };
  if (url.port !== "" && url.port !== "443") return { ok: false, reason: "port-not-allowed" };
  const hostname = url.hostname.toLowerCase();
  if (!hostname) return { ok: false, reason: "invalid-host" };
  // WHATWG URL keeps brackets on IPv6 hosts; strip them for the literal check.
  const bareHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (isIP(bareHost) !== 0) return { ok: false, reason: "ip-literal-host" };
  if (!/^[a-z0-9.-]+$/.test(hostname)) return { ok: false, reason: "invalid-host" };
  if (hostname.endsWith(".")) return { ok: false, reason: "invalid-host" };
  if (hostname.length > 253) return { ok: false, reason: "invalid-host" };
  const labels = hostname.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return { ok: false, reason: "invalid-host" };
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return { ok: false, reason: "invalid-host" };
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, reason: "invalid-host" };
  }
  if (allowedHostname !== undefined && hostname !== allowedHostname.toLowerCase()) {
    return { ok: false, reason: "host-mismatch" };
  }
  return { ok: true };
}

/** Parse and fully validate the consented reference as a fetchable https URL. */
export function parseSourceReference(reference: unknown): SourceUrlCheck {
  if (typeof reference !== "string" || reference.length === 0 || reference.length > SOURCE_ADAPTER_LIMITS.referenceChars) {
    return { ok: false, reason: "invalid-reference" };
  }
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    return { ok: false, reason: "invalid-reference" };
  }
  const check = checkFetchableSourceUrl(url);
  return check.ok ? { ok: true, url } : { ok: false, reason: check.reason };
}

/* ------------------------------------------------------------------ */
/* Request / result shaping                                            */
/* ------------------------------------------------------------------ */

export interface SourceFetchInput {
  /** Server-owned registered adapter manifest (validated before any socket). */
  readonly manifest: unknown;
  /** The bound, server-issued `SourceConsent` for this exact capture. */
  readonly consent: unknown;
  /** Exact reference the consent pins — must be an https URL for this host. */
  readonly reference: string;
  /** Effective server-granted permissions (deny-by-default). */
  readonly grantedPermissions: Readonly<Partial<Record<string, boolean>>>;
  /** Match the capture is bound to (consent binding enforced by the gate). */
  readonly matchId?: string;
  /** Request id the capture fulfills (consent binding enforced by the gate). */
  readonly requestId?: string;
  /** Optional bounded, credential-free metadata (re-validated, then passed through). */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SourceFetchOptions {
  /** Injected DNS lookup (tests); defaults to the validated node resolver. */
  readonly lookup?: SourceDnsLookup;
  /** Injected dispatcher (tests); defaults to a dedicated pinned undici Agent. */
  readonly dispatcher?: Pick<Dispatcher, "request">;
  /** Test-only limit overrides (clamped to hard caps). */
  readonly limits?: SourceFetchLimits;
  /** Validation instant for the consent gate (defaults to now). */
  readonly now?: string | number;
  /**
   * Allow `text/html` responses, parsed strictly as UNTRUSTED text
   * (tags stripped server-side, captured as `text/plain`). Default false.
   */
  readonly allowHtmlText?: boolean;
}

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

const REDIRECTABLE_STATUSES = Object.freeze(new Set([301, 302, 303, 307, 308]));
const TEXT_MIME_TYPES = Object.freeze(new Set(["text/plain", "text/markdown"]));
const HTML_MIME = "text/html";

const CREDENTIAL_LIKE_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|auth|credential|cookie|session)/i;

function buildRequestHeaders(allowHtmlText: boolean): Record<string, string> {
  return {
    accept: allowHtmlText ? "text/plain, text/markdown, text/html;q=0.5" : "text/plain, text/markdown",
    // Never negotiate compression: the capture must be exact UTF-8 text.
    "accept-encoding": "identity",
    "user-agent": SOURCE_FETCH_LIMITS.userAgent,
  };
}

/** Shape of undici response headers as consumed here (lowercased names). */
type SourceHttpHeaders = Record<string, string | string[] | undefined>;

function firstHeaderValue(headers: SourceHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

/** Strip markup from an untrusted HTML response; captured as text/plain. */
export function htmlToUntrustedText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

interface SafeMetadata {
  ok: true;
  metadata: Record<string, string | number | boolean | null>;
}

/** Re-validate caller metadata against the ingest contract's bounds. */
function sanitizeMetadata(input: Readonly<Record<string, unknown>> | undefined): SafeMetadata | { ok: false } {
  const metadata: Record<string, string | number | boolean | null> = {};
  if (input === undefined) return { ok: true, metadata };
  const keys = Object.keys(input);
  if (keys.length > SOURCE_ADAPTER_LIMITS.metadataEntries) return { ok: false };
  for (const key of keys) {
    if (key.length === 0 || key.length > SOURCE_ADAPTER_LIMITS.idChars) return { ok: false };
    if (CREDENTIAL_LIKE_KEY.test(key)) return { ok: false };
    const value = input[key];
    if (typeof value === "string") {
      if (value.length > SOURCE_ADAPTER_LIMITS.metadataValueChars) return { ok: false };
      metadata[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      metadata[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      metadata[key] = value;
    } else {
      return { ok: false };
    }
  }
  return { ok: true, metadata };
}

const TIMEOUT_ERROR_CODES = new Set([
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_ABORTED",
]);

function mapNetworkError(error: unknown, timedOut: boolean): SourceFetchReason {
  if (timedOut) return "timeout";
  const code = (error as { readonly code?: unknown } | null | undefined)?.code;
  if (typeof code !== "string") return "connect-failure";
  if (code === DNS_ERR.blocked) return "dns-blocked";
  if (code === DNS_ERR.failed) return "dns-failure";
  if (code === DNS_ERR.timeout) return "timeout";
  if (TIMEOUT_ERROR_CODES.has(code)) return "timeout";
  if (code.startsWith("ERR_TLS") || code.includes("CERT") || code.startsWith("ERR_SSL")) {
    return "tls-failure";
  }
  return "connect-failure";
}

function mapGateReason(reason: "consent-missing" | "consent-expired" | "consent-replayed" | "capability-denied" | "permission-unmet" | "invalid"): SourceFetchReason {
  return reason === "invalid" ? "consent-invalid" : reason;
}

interface BodyConsumerResult {
  readonly text: string;
  readonly bytes: number;
}

class BodyTooLargeError extends Error {}
class BodyDeadlineError extends Error {}

/**
 * Stream the response body with a hard decoded-UTF-8 byte cap and a hard
 * wall-clock deadline. The body is always destroyed on abort — nothing
 * unbounded is ever buffered.
 */
async function consumeBoundedBody(
  body: AsyncIterable<Uint8Array> & { readonly destroy?: (error?: Error) => void },
  maxContentBytes: number,
  overallDeadlineMs: number,
): Promise<BodyConsumerResult> {
  return await new Promise<BodyConsumerResult>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (settle: () => void) => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      settle();
    };
    const run = (async () => {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      let text = "";
      for await (const chunk of body) {
        bytes += chunk.byteLength;
        if (bytes > maxContentBytes) {
          body.destroy?.(new BodyTooLargeError("body exceeds capture cap"));
          throw new BodyTooLargeError();
        }
        text += decoder.decode(chunk, { stream: true });
        if (Date.now() > overallDeadlineMs) {
          body.destroy?.(new BodyDeadlineError("capture deadline exceeded"));
          throw new BodyDeadlineError();
        }
      }
      text += decoder.decode();
      return { text, bytes };
    })();
    timer = setTimeout(() => {
      body.destroy?.(new BodyDeadlineError("capture deadline exceeded"));
      finish(() => reject(new BodyDeadlineError()));
    }, Math.max(1, overallDeadlineMs - Date.now()));
    timer.unref?.();
    run.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/**
 * Perform one consent-gated HTTPS source capture. Fails closed before any
 * socket if the gate, URL policy, or host binding does not validate; fails
 * closed with safe reason codes for every network-level condition.
 */
export async function fetchSourceCapture(
  input: SourceFetchInput,
  options: SourceFetchOptions = {},
): Promise<SourceFetchResult> {
  const limitCheck = ((): ResolvedLimits | null => {
    try {
      return resolveLimits(options.limits);
    } catch {
      return null;
    }
  })();
  if (limitCheck === null) return { ok: false, reason: "invalid-request" };
  const limits = limitCheck;

  // ---- 1. Server-owned manifest (schema) — pure, no socket. ----
  const manifestParsed = sourceAdapterManifestSchema.safeParse(input?.manifest);
  if (!manifestParsed.success) {
    return { ok: false, reason: "invalid-request" };
  }

  // ---- 2. Request reference URL policy — pure, no socket. ----
  const parsedReference = parseSourceReference(input?.reference);
  if (!parsedReference.ok) {
    return { ok: false, reason: parsedReference.reason };
  }

  // ---- 3. The existing source gate, BEFORE any socket. ----
  if (input?.consent === undefined || input?.consent === null) {
    return { ok: false, reason: "consent-missing" };
  }
  if (input?.grantedPermissions?.["net.fetch"] !== true) {
    // The network path itself is deny-by-default, regardless of the manifest.
    return { ok: false, reason: "permission-unmet" };
  }
  const gate = validateSourceGate(
    input.manifest,
    input.consent,
    input.grantedPermissions,
    options.now ?? Date.now(),
    { matchId: input.matchId, requestId: input.requestId, reference: input.reference },
  );
  if (!gate.ok) {
    return { ok: false, reason: mapGateReason(gate.reason) };
  }

  // ---- 4. Consent/reference host binding — pure, no socket. ----
  const parsedConsentReference = parseSourceReference(gate.consent.reference);
  if (
    !parsedConsentReference.ok ||
    parsedConsentReference.url.origin !== parsedReference.url.origin
  ) {
    return { ok: false, reason: "reference-mismatch" };
  }
  const consentedHostname = parsedConsentReference.url.hostname.toLowerCase();

  const metadataCheck = sanitizeMetadata(input.metadata);
  if (!metadataCheck.ok) {
    return { ok: false, reason: "invalid-request" };
  }

  const allowHtmlText = options.allowHtmlText === true;
  const requestHeaders = buildRequestHeaders(allowHtmlText);

  // ---- 5. Overall abort + dedicated dispatcher. ----
  const overallStartedMs = Date.now();
  let timedOut = false;
  const controller = new AbortController();
  const overallTimer = setTimeout(() => {
    timedOut = true;
    controller.abort(Object.assign(new Error("source capture deadline exceeded"), { code: DNS_ERR.timeout }));
  }, limits.overallTimeoutMs);
  overallTimer.unref?.();

  const ownsDispatcher = options.dispatcher === undefined;
  const dispatcher: Pick<Dispatcher, "request"> =
    options.dispatcher ??
    new Agent({
      maxOrigins: MAX_ORIGINS,
      pipelining: 1,
      connectTimeout: limits.connectTimeoutMs,
      headersTimeout: limits.headersTimeoutMs,
      bodyTimeout: limits.bodyTimeoutMs,
        connect: {
          lookup: createValidatedSourceLookup(options.lookup, limits.lookupTimeoutMs),
          autoSelectFamily: false,
        },
    });

  try {
    let currentUrl = parsedReference.url;
    let redirects = 0;
    const visited = new Set<string>([currentUrl.href]);

    while (true) {
      const response = await dispatcher.request({
        origin: currentUrl.origin,
        path: `${currentUrl.pathname}${currentUrl.search}`,
        method: "GET",
        headers: requestHeaders,
        signal: controller.signal,
      });
      const { statusCode, headers, body } = response;

      if (REDIRECTABLE_STATUSES.has(statusCode)) {
        const location = firstHeaderValue(headers, "location");
        // Redirect bodies are always cancelled, whatever happens next.
        body.destroy?.();
        if (redirects >= limits.maxRedirects) {
          return { ok: false, reason: "too-many-redirects" };
        }
        if (typeof location !== "string" || location.length === 0 || location.length > limits.maxLocationChars) {
          return { ok: false, reason: "redirect-unsafe" };
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return { ok: false, reason: "redirect-unsafe" };
        }
        const check = checkFetchableSourceUrl(nextUrl, consentedHostname);
        if (!check.ok) {
          return { ok: false, reason: check.reason };
        }
        if (visited.has(nextUrl.href)) {
          return { ok: false, reason: "redirect-loop" };
        }
        visited.add(nextUrl.href);
        currentUrl = nextUrl;
        redirects += 1;
        continue;
      }

      if (statusCode < 200 || statusCode > 299) {
        body.destroy?.();
        return { ok: false, reason: "status-not-ok" };
      }

      const contentTypeHeader = firstHeaderValue(headers, "content-type");
      if (typeof contentTypeHeader !== "string") {
        body.destroy?.();
        return { ok: false, reason: "content-type-unsupported" };
      }
      const [mimeRaw] = contentTypeHeader.split(";");
      const mime = mimeRaw.trim().toLowerCase();
      if (!TEXT_MIME_TYPES.has(mime) && !(mime === HTML_MIME && allowHtmlText)) {
        body.destroy?.();
        return { ok: false, reason: "content-type-unsupported" };
      }

      // ---- 6. Bounded, streamed capture of the exact UTF-8 text. ----
      let decoded: BodyConsumerResult;
      try {
        decoded = await consumeBoundedBody(
          body as AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void },
          limits.maxContentBytes,
          overallStartedMs + limits.overallTimeoutMs,
        );
      } catch (error) {
        body.destroy?.();
        if (error instanceof BodyTooLargeError) return { ok: false, reason: "body-too-large" };
        if (timedOut) return { ok: false, reason: "timeout" };
        if (error instanceof BodyDeadlineError) return { ok: false, reason: "timeout" };
        if ((error as { readonly code?: string })?.code === "UND_ERR_BODY_TIMEOUT") {
          return { ok: false, reason: "timeout" };
        }
        return { ok: false, reason: "body-error" };
      }

      if (decoded.bytes === 0 || decoded.text.trim().length === 0) {
        return { ok: false, reason: "empty-body" };
      }

      let content = decoded.text;
      let captureContentType: SourceFetchCapture["contentType"];
      if (mime === HTML_MIME) {
        // Strictly untrusted text: strip markup server-side; never executed.
        content = htmlToUntrustedText(content);
        captureContentType = "text/plain";
      } else {
        captureContentType = mime === "text/markdown" ? "text/markdown" : "text/plain";
      }

      const metadata: Record<string, string | number | boolean | null> = { ...metadataCheck.metadata };
      if (mime === HTML_MIME) {
        metadata.sourceContentType = HTML_MIME;
      }

      return {
        ok: true,
        capture: {
          reference: input.reference,
          contentType: captureContentType,
          content,
          contentBytes: sourceContentBytes(content),
          contentHash: computeSourceContentHash(content),
        },
        metadata,
        redirects,
        httpStatus: statusCode,
      };
    }
  } catch (error) {
    // Fail closed: never expose raw errors, URLs, DNS records, or addresses.
    return { ok: false, reason: timedOut ? "timeout" : mapNetworkError(error, timedOut) };
  } finally {
    clearTimeout(overallTimer);
    if (ownsDispatcher) {
      // One-shot dedicated agent: never cached, never global.
      await (dispatcher as Dispatcher).destroy().catch(() => undefined);
    }
  }
}
