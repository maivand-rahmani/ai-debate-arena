import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getStandardTool,
  runStandardTool,
  type StandardToolInput,
} from "../src/standard";

const webSearchHtml = [
  '<html><body><div class="result">',
  '<a class="result__a" href="https://example.com/first">First &amp; Result</a>',
  '<a class="result__a" href="https://example.com/second">Second Result</a>',
  "</div></body></html>",
].join("");

function mockFetch(body: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(body, { status, headers: { "content-type": "text/html" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Standard tool registry", () => {
  it("exposes every server-owned tool by name", () => {
    expect(getStandardTool("web_search")?.name).toBe("web_search");
    expect(getStandardTool("fetch_url")?.name).toBe("fetch_url");
    expect(getStandardTool("run_code")?.name).toBe("run_code");
    expect(getStandardTool("does_not_exist")).toBeUndefined();
  });
});

describe("web_search executor", () => {
  it("preserves parsed DuckDuckGo results within the output cap", async () => {
    mockFetch(webSearchHtml);
    const result = await runStandardTool("web_search", { query: "example query" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("First & Result");
    expect(result.output).toContain("https://example.com/first");
    expect(result.output.length).toBeLessThanOrEqual(6_000);
  });

  it("returns a bounded failure for an HTTP error", async () => {
    mockFetch("nope", 503);
    const result = await runStandardTool("web_search", { query: "example query" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("503");
  });
});

describe("fetch_url executor", () => {
  it("extracts plain text, drops scripts, and caps output", async () => {
    const long = "lorem ipsum ".repeat(2_000);
    mockFetch(`<html><head><style>.x{color:red}</style></head><body><script>secret()</script><p>Hello world</p><p>${long}</p></body></html>`);
    const result = await runStandardTool("fetch_url", { query: "https://example.com/article" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Hello world");
    expect(result.output).not.toContain("secret()");
    expect(result.output).not.toContain("color:red");
    expect(result.output.length).toBeLessThanOrEqual(6_000);
  });

  it("rejects non-http URLs before fetching", async () => {
    const fetchMock = mockFetch("ignored");
    const result = await runStandardTool("fetch_url", { query: "file:///etc/passwd" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Unsupported URL protocol");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed URLs", async () => {
    const result = await runStandardTool("fetch_url", { query: "not a url" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid URL");
  });

  it("returns a bounded failure for an HTTP error", async () => {
    mockFetch("missing", 404);
    const result = await runStandardTool("fetch_url", { query: "https://example.com/missing" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("404");
  });
});

describe("run_code executor", () => {
  it("runs JavaScript and returns captured stdout", async () => {
    const result = await runStandardTool("run_code", { query: "console.log(6 * 7)", language: "javascript" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("42");
  });

  it("returns a structured failure when JavaScript throws", async () => {
    const result = await runStandardTool("run_code", { query: 'throw new Error("boom")', language: "javascript" });
    expect(result.ok).toBe(false);
    expect(`${result.output}${result.error ?? ""}`).toContain("boom");
  });

  it("caps very large stdout", async () => {
    const result = await runStandardTool("run_code", {
      query: 'console.log("a".repeat(20000))',
      language: "javascript",
    });
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(8_000);
  });

  it("fails without a supported language", async () => {
    const result = await runStandardTool("run_code", { query: "print(1)" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Unsupported language");
  });

  it("reports cancellation as a structured failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runStandardTool(
      "run_code",
      { query: "console.log(1)", language: "javascript" },
      controller.signal,
    );
    expect(result.ok).toBe(false);
  });

  it("runs Python when an interpreter is available", async () => {
    const result = await runStandardTool("run_code", { query: 'print("py-ok")', language: "python" });
    if (result.ok) {
      expect(result.output).toContain("py-ok");
    } else {
      // Python may be absent on a given machine; the executor must still report
      // a bounded, structured failure instead of throwing.
      expect(result.error).toBeDefined();
    }
  });
});

describe("configured per-call timeout", () => {
  it("aborts a network tool when its supplied timeout elapses", async () => {
    const fetchMock = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          if (signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStandardTool("fetch_url", {
      query: "https://example.com/slow",
      timeoutMs: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("timed out");
  });

  it("kills a code run that exceeds the supplied timeout", async () => {
    const result = await runStandardTool("run_code", {
      query: "setInterval(() => {}, 1000)",
      language: "javascript",
      timeoutMs: 150,
    });
    expect(result.ok).toBe(false);
    expect(`${result.output}${result.error ?? ""}`).toContain("timed out");
  });
});

describe("Standard tool input", () => {
  it("keeps language optional so the current runner call site stays valid", () => {
    const input: StandardToolInput = { query: "example" };
    expect(input.language).toBeUndefined();
  });
});
