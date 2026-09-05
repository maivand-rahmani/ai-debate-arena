const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT"]);
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EPIPE",
]);

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readText(err: unknown): string {
  if (typeof err === "string") return err;
  const record = readRecord(err);
  if (!record) return "";
  const parts: string[] = [];
  if (typeof record["name"] === "string") parts.push(record["name"]);
  if (typeof record["message"] === "string") parts.push(record["message"]);
  const causeText = readText(record["cause"]);
  if (causeText) parts.push(causeText);
  return parts.join(": ");
}

function readCode(err: unknown): string {
  const record = readRecord(err);
  const code = record?.["code"] ?? readRecord(record?.["cause"])?.["code"];
  return typeof code === "string" ? code.toUpperCase() : "";
}

function readStatus(err: unknown): number | undefined {
  const records = [readRecord(err), readRecord(readRecord(err)?.["cause"])].filter(
    (record): record is Record<string, unknown> => record !== undefined,
  );
  for (const record of records) {
    for (const key of ["status", "statusCode"]) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    const status = readRecord(record["response"])?.["status"];
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return undefined;
}

export function sanitizeErrorText(text: string): string {
  return text
    .replace(/(\w+:\/\/[^/\s:]+:)[^/\s@]+@/g, "$1<redacted>@")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "<redacted-key>")
    .replace(/((?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?)[^"'\s&;,]+/gi, "$1<redacted>")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1<redacted>");
}

export function toSafeErrorMessage(err: unknown): string {
  const status = readStatus(err);
  const text = readText(err);
  const code = readCode(err);
  const name = readRecord(err)?.["name"];

  if (status === 401 || status === 403 || /unauthorized|\bforbidden\b|invalid api key|incorrect api key/i.test(text)) {
    return "Provider authentication failed. Check the configured API key.";
  }
  if (status === 429 || /rate limit|too many requests/i.test(text)) {
    return "Provider rate limit exceeded. Please wait and try again.";
  }
  if (
    TIMEOUT_CODES.has(code) ||
    name === "AbortError" ||
    /timed out|\btimeout\b|\babort/i.test(text)
  ) {
    return "Provider request timed out. Please try again.";
  }
  if (
    UNREACHABLE_CODES.has(code) ||
    /fetch failed|failed to fetch|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|network unreachable|connection refused|unable to connect/i.test(
      text,
    )
  ) {
    return "Provider is unreachable. Check the base URL and network connection.";
  }
  if (status !== undefined) {
    return `Provider request failed (status ${status}).`;
  }
  const clean = sanitizeErrorText(text).slice(0, 200).trim();
  return clean || "Model request failed.";
}
