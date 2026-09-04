/**
 * Minimal in-process OpenAI-compatible HTTP server for tests.
 *
 * Implements just enough of `POST {baseUrl}/chat/completions` for the Vercel
 * AI SDK (`@ai-sdk/openai-compatible`) to drive `streamText` (SSE,
 * `stream: true`) and `generateText` (plain JSON, `stream: false`) against
 * `http://127.0.0.1:<ephemeral-port>/v1` — no external network involved.
 *
 * Replies are scripted per test: enqueue FIFO `MockReply` objects, or install
 * a `MockResponder` that picks a reply from the parsed request body (handy
 * when the SDK may issue a variable number of HTTP calls per model call,
 * e.g. the judge's structured-output attempt plus plain-text fallback).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

export type MockReply =
  | {
      readonly kind: "text";
      readonly text: string;
      /** Approximate characters per SSE delta chunk (streaming only). */
      readonly chunkChars?: number;
      /** Delay between SSE delta chunks in ms (streaming only). */
      readonly chunkDelayMs?: number;
      /** Delay before the first byte of the response in ms. */
      readonly delayMs?: number;
    }
  | {
      readonly kind: "error";
      readonly status: number;
      readonly message?: string;
      /** Delay before responding in ms. */
      readonly delayMs?: number;
    };

export interface MockSeenRequest {
  readonly method: string;
  readonly url: string;
  /** The request body's `stream` flag, or null when absent/unparsable. */
  readonly stream: boolean | null;
  readonly model: unknown;
  /** True when the client went away before the response completed. */
  aborted: boolean;
}

export interface MockRequestContext {
  readonly method: string;
  readonly url: string;
  readonly stream: boolean | null;
  readonly body: unknown;
  readonly bodyText: string;
}

export type MockResponder = (ctx: MockRequestContext) => MockReply | undefined;

export interface MockOpenAIProvider {
  /** e.g. `http://127.0.0.1:PORT/v1` — pass straight into the provider store. */
  readonly baseUrl: string;
  readonly port: number;
  enqueue(...replies: MockReply[]): void;
  setResponder(responder: MockResponder | undefined): void;
  reset(): void;
  readonly requestCount: number;
  readonly requests: readonly MockSeenRequest[];
  readonly abortedCount: number;
  close(): Promise<void>;
}

const DEFAULT_REPLY: MockReply = { kind: "text", text: "default mock reply" };

export async function startMockOpenAIProvider(): Promise<MockOpenAIProvider> {
  const pending: MockReply[] = [];
  const seen: MockSeenRequest[] = [];
  let responder: MockResponder | undefined;

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res).catch(() => {
      // Client disconnects mid-response surface here; never fail the test run.
    });
  });

  // NOTE: only the response state is consulted. IncomingMessage may report
  // `destroyed === true` after its body was fully consumed on a healthy
  // keep-alive connection, so it must not be treated as "client went away".
  function clientGone(res: ServerResponse): boolean {
    return res.destroyed || res.writableEnded;
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const url = req.url ?? "/";

    if (method !== "POST" || !url.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "mock: not found", type: "mock_not_found" } }));
      return;
    }

    let raw = "";
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      raw = Buffer.concat(chunks).toString("utf8");
    } catch {
      return;
    }

    let stream: boolean | null = null;
    let model: unknown;
    let body: unknown;
    try {
      body = raw ? (JSON.parse(raw) as unknown) : undefined;
      const record = body as { stream?: unknown; model?: unknown } | null;
      if (record && typeof record === "object") {
        stream = typeof record.stream === "boolean" ? record.stream : null;
        model = record.model;
      }
    } catch {
      body = undefined;
    }

    const seenRequest: MockSeenRequest = { method, url, stream, model, aborted: false };
    seen.push(seenRequest);
    // `close` on the response fires in every case (including after a normal
    // `res.end()` on keep-alive); only count it as aborted when the response
    // never completed. The request stream is ignored here: it legitimately
    // closes right after its body is consumed.
    res.on("close", () => {
      if (!res.writableEnded) seenRequest.aborted = true;
    });

    const ctx: MockRequestContext = { method, url, stream, body, bodyText: raw };
    let scripted: MockReply | undefined;
    try {
      scripted = responder?.(ctx);
    } catch {
      scripted = undefined;
    }
    const reply: MockReply = scripted ?? pending.shift() ?? DEFAULT_REPLY;

    const initialDelay = reply.delayMs ?? 0;
    if (initialDelay > 0) await sleep(initialDelay);
    if (clientGone(res)) return;

    if (reply.kind === "error") {
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: reply.message ?? "mock provider error", type: "mock_error" },
        }),
      );
      return;
    }

    if (ctx.stream === true) {
      await sendStreaming(res, reply);
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(chatCompletionJson(reply.text)));
    }
  }

  async function sendStreaming(res: ServerResponse, reply: Extract<MockReply, { kind: "text" }>): Promise<void> {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const size = Math.max(1, reply.chunkChars ?? 6);
    const chars = Array.from(reply.text);
    try {
      for (let i = 0; i < chars.length; i += size) {
        if (clientGone(res)) return;
        const delta = chars.slice(i, i + size).join("");
        res.write(`data: ${JSON.stringify(chatChunkJson(delta, null))}\n\n`);
        if ((reply.chunkDelayMs ?? 0) > 0) await sleep(reply.chunkDelayMs ?? 0);
      }
      if (clientGone(res)) return;
      res.write(`data: ${JSON.stringify(chatChunkJson("", "stop"))}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      // Client went away mid-stream; the aborted flag is recorded via close.
    }
  }

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    port,
    enqueue(...replies: MockReply[]): void {
      pending.push(...replies);
    },
    setResponder(next: MockResponder | undefined): void {
      responder = next;
    },
    reset(): void {
      pending.length = 0;
      seen.length = 0;
      responder = undefined;
    },
    get requestCount(): number {
      return seen.length;
    },
    get requests(): readonly MockSeenRequest[] {
      return seen;
    },
    get abortedCount(): number {
      return seen.filter((request) => request.aborted).length;
    },
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

function chatCompletionJson(content: string): Record<string, unknown> {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: 1,
    model: "mock-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

function chatChunkJson(content: string, finishReason: string | null): Record<string, unknown> {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: 1,
    model: "mock-model",
    choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
  };
}
