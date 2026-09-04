import { describe, expect, it } from "vitest";
import { sanitizeErrorText, toSafeErrorMessage } from "./errors";

describe("toSafeErrorMessage", () => {
  it("maps auth failures without leaking the key", () => {
    const message = toSafeErrorMessage(
      Object.assign(new Error("401 Unauthorized for key sk-FAKEKEY1234567890abcdef"), { status: 401 }),
    );
    expect(message).toBe("Provider authentication failed. Check the configured API key.");
    expect(message).not.toContain("sk-FAKE");
  });

  it("maps rate limits, timeouts, and unreachable hosts", () => {
    expect(toSafeErrorMessage(Object.assign(new Error("Too many requests"), { statusCode: 429 }))).toContain(
      "rate limit",
    );
    expect(toSafeErrorMessage(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }))).toContain(
      "timed out",
    );
    expect(toSafeErrorMessage(Object.assign(new Error("fetch failed"), { code: "ENOTFOUND" }))).toContain(
      "unreachable",
    );
  });

  it("never leaks credentials from unknown errors", () => {
    const message = toSafeErrorMessage(
      new Error('boom at https://admin:s3cret-key@example.com/v1 with "apiKey":"sk-FAKEKEY1234567890abcdef"'),
    );
    expect(message).not.toContain("s3cret-key");
    expect(message).not.toContain("sk-FAKE");
    expect(message).not.toContain("admin:s3cret");
  });

  it("sanitizes credentialed URLs and bearer tokens", () => {
    expect(sanitizeErrorText("via https://bot:hunter2-secret@host/v1")).not.toContain("hunter2");
    expect(sanitizeErrorText("auth Bearer abcdefghijklmnop123456")).not.toContain("abcdefghijklmnop");
  });
});
