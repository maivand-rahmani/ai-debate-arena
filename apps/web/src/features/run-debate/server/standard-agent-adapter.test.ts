import { describe, expect, it, beforeEach, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type {
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type {
  StandardAgentMoveInput,
  StandardAgentSessionFactoryInput,
} from "@arena/debate-engine";

const mocks = vi.hoisted(() => ({
  createWebModel: vi.fn(),
}));

vi.mock("@/features/run-debate/server/web-adapter", () => ({
  createWebModel: mocks.createWebModel,
}));

import { createWebStandardAgentSession } from "./standard-agent-adapter";

interface ScriptedToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

function streamResult(toolCalls: readonly ScriptedToolCall[], finish: "tool-calls" | "stop" = "tool-calls"): LanguageModelV4StreamResult {
  const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
  for (const call of toolCalls) {
    parts.push({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: JSON.stringify(call.input) });
  }
  parts.push({
    type: "finish",
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 3, text: 3, reasoning: 0 },
    },
  });
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

function streamPartsResult(parts: readonly LanguageModelV4StreamPart[], finish: "tool-calls" | "stop" = "tool-calls"): LanguageModelV4StreamResult {
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        for (const part of parts) controller.enqueue(part);
        controller.enqueue({
          type: "finish",
          finishReason: { unified: finish, raw: finish },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 3, text: 3, reasoning: 0 },
          },
        });
        controller.close();
      },
    }),
  };
}

function speakInputStream(deltas: readonly string[], prefix: readonly LanguageModelV4StreamPart[] = []): LanguageModelV4StreamResult {
  return streamPartsResult([
    ...prefix,
    { type: "tool-input-start", id: "speak-1", toolName: "speak" },
    ...deltas.map((delta) => ({ type: "tool-input-delta", id: "speak-1", delta }) satisfies LanguageModelV4StreamPart),
    { type: "tool-input-end", id: "speak-1" },
    { type: "tool-call", toolCallId: "speak-1", toolName: "speak", input: deltas.join("") },
  ]);
}

function textOnlyStream(): LanguageModelV4StreamResult {
  const parts: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: "private reasoning that must not become public" },
    { type: "text-end", id: "t" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ];
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

function modelWith(...steps: LanguageModelV4StreamResult[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doStream: steps });
}

/** Flattens a provider-format prompt into searchable text. */
function promptText(prompt: LanguageModelV4Prompt): string {
  return prompt
    .map((message) => {
      if (typeof message.content === "string") return message.content;
      return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    })
    .join("\n");
}

const factoryInput: StandardAgentSessionFactoryInput = {
  matchId: "match-1",
  topic: "Should cities ban private cars?",
  side: "A",
  position: "FOR",
  providerId: "p1",
  model: "m1",
  maxOutputTokens: 3500,
  sessionKey: "match-1:agent-a",
};

function moveInput(overrides: Partial<StandardAgentMoveInput> = {}): StandardAgentMoveInput {
  return {
    topic: "Should cities ban private cars?",
    observation: [],
    phase: "standard-a-opening",
    side: "A",
    position: "FOR",
    credits: 12,
    speechCost: 1,
    toolCost: 2,
    maxToolsPerMove: 2,
    maxAffordableTools: 2,
    toolTimeoutMs: 8_000,
    closingRound: false,
    publicToolEvents: [],
    runTool: async () => ({ ok: true, output: "unused" }),
    ...overrides,
  };
}

const speak = (id: string, content: string, ready = false): ScriptedToolCall => ({
  id,
  name: "speak",
  input: { content, ready },
});

beforeEach(() => {
  mocks.createWebModel.mockReset();
});

describe("createWebStandardAgentSession", () => {
  it("lazily builds one mocked model per session and delivers a speak move", async () => {
    const model = modelWith(streamResult([speak("s1", "Opening case.", true)], "tool-calls"));
    mocks.createWebModel.mockResolvedValue(model);

    const session = createWebStandardAgentSession(factoryInput);
    expect(mocks.createWebModel).not.toHaveBeenCalled();

    const progress: unknown[] = [];
    const result = await session.move(moveInput({ onProgress: (event) => progress.push(event) }));

    expect(mocks.createWebModel).toHaveBeenCalledTimes(1);
    expect(mocks.createWebModel).toHaveBeenCalledWith("p1", "m1", "match-1:agent-a");
    expect(result.speech).toBe("Opening case.");
    expect(result.ready).toBe(true);
    expect(result.toolEvents).toEqual([]);
    expect(progress).toEqual([{ type: "speech", text: "Opening case." }]);

    const call = model.doStreamCalls[0]!;
    expect(call.maxOutputTokens).toBe(3500);
    const toolNames = (call.tools ?? []).map((entry) => entry.name).sort();
    expect(toolNames).toEqual(["fetch_url", "run_code", "speak", "web_search"]);
  });

  it("executes native tools and keeps only executed calls in the public events", async () => {
    const model = modelWith(
      streamResult([
        { id: "t1", name: "web_search", input: { query: "car ban evidence" } },
        { id: "t2", name: "fetch_url", input: { query: "https://example.com/over-cap" } },
      ]),
      streamResult([speak("s1", "With evidence.", false)]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const runTool = vi.fn(async () => ({ ok: true, output: "bounded tool output" }));

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput({ maxAffordableTools: 1, runTool }));

    // Over-cap second call is never executed and is not a public event.
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith(
      "web_search",
      { query: "car ban evidence", timeoutMs: 8_000 },
      undefined,
    );
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0]).toMatchObject({ tool: "web_search", query: "car ban evidence", ok: true });
    expect(result.speech).toBe("With evidence.");
    expect(result.ready).toBe(false);
    // speak must never be reported as a public tool event.
    expect(result.toolEvents.some((event) => (event.tool as string) === "speak")).toBe(false);
  });

  it("streams only semantic public progress through the injected executor", async () => {
    const model = modelWith(
      streamResult([{ id: "t1", name: "web_search", input: { query: "public source" } }]),
      streamResult([speak("s1", "Validated public speech.", true)]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const runTool = vi.fn(async () => ({ ok: true, output: "public result" }));
    const progress: unknown[] = [];

    const session = createWebStandardAgentSession(factoryInput);
    await session.move(moveInput({ runTool, onProgress: (event) => progress.push(event) }));

    expect(runTool).toHaveBeenCalledTimes(1);
    expect((progress as Array<{ type: string }>).map((event) => event.type)).toEqual([
      "tool-start",
      "tool-result",
      "speech",
    ]);
    expect(JSON.stringify(progress)).not.toContain("private");
    expect(JSON.stringify(progress)).not.toContain("reasoning");
  });

  it("emits incremental speak content from tool-input deltas", async () => {
    const model = modelWith(speakInputStream(['{"content":"Hel', 'lo ', 'world","ready":true}']));
    mocks.createWebModel.mockResolvedValue(model);
    const progress: Array<{ type: string; text?: string }> = [];

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput({ onProgress: (event) => progress.push(event) }));

    expect(result.speech).toBe("Hello world");
    expect(progress).toEqual([
      { type: "speech", text: "Hel" },
      { type: "speech", text: "lo " },
      { type: "speech", text: "world" },
    ]);
  });

  it("decodes escaped speech content across deltas", async () => {
    const model = modelWith(
      speakInputStream(['{"content":"line\\nquote: \\"', 'x\\\\tab\\t","ready":false}']),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const progress: Array<{ type: string; text?: string }> = [];

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput({ onProgress: (event) => progress.push(event) }));

    expect(result.speech).toBe('line\nquote: "x\\tab\t');
    expect(progress.map((event) => event.text ?? "").join(""))
      .toBe('line\nquote: "x\\tab\t');
  });

  it("holds split unicode escapes until the code point is decodable", async () => {
    const model = modelWith(
      speakInputStream(['{"content":"emoji: \\uD83', 'D\\uDE', '00","ready":false}']),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const progress: Array<{ type: string; text?: string }> = [];

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput({ onProgress: (event) => progress.push(event) }));

    expect(result.speech).toBe("emoji: 😀");
    expect(progress.map((event) => event.text ?? "").join(""))
      .toBe("emoji: 😀");
    expect(progress.some((event) => event.text === "\ud83d")).toBe(false);
  });

  it("ignores ordinary text, reasoning, and non-speak tool input", async () => {
    const nonSpeak = streamPartsResult([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "private ordinary text" },
      { type: "reasoning-start", id: "reason-1" },
      { type: "reasoning-delta", id: "reason-1", delta: "private reasoning" },
      { type: "tool-input-start", id: "search-1", toolName: "web_search" },
      { type: "tool-input-delta", id: "search-1", delta: '{"query":"private search"}' },
      { type: "tool-input-end", id: "search-1" },
      { type: "tool-call", toolCallId: "search-1", toolName: "web_search", input: '{"query":"private search"}' },
    ]);
    const model = modelWith(nonSpeak, speakInputStream(['{"content":"Public","ready":true}']));
    mocks.createWebModel.mockResolvedValue(model);
    const runTool = vi.fn(async () => ({ ok: true, output: "search result" }));
    const progress: Array<{ type: string; text?: string }> = [];

    const session = createWebStandardAgentSession(factoryInput);
    await session.move(moveInput({ runTool, onProgress: (event) => progress.push(event) }));

    expect(runTool).toHaveBeenCalledWith("web_search", { query: "private search", timeoutMs: 8_000 }, undefined);
    expect(progress.filter((event) => event.type === "speech")).toEqual([{ type: "speech", text: "Public" }]);
    expect(JSON.stringify(progress)).not.toContain("private ordinary text");
    expect(JSON.stringify(progress)).not.toContain("private reasoning");
  });

  it("does not duplicate content when speak execution follows complete deltas", async () => {
    const model = modelWith(speakInputStream(['{"content":"Already public","ready":true}']));
    mocks.createWebModel.mockResolvedValue(model);
    const progress: Array<{ type: string; text?: string }> = [];

    const session = createWebStandardAgentSession(factoryInput);
    await session.move(moveInput({ onProgress: (event) => progress.push(event) }));

    expect(progress.map((event) => event.text ?? "").join(""))
      .toBe("Already public");
  });

  it("normalizes a thrown executor error to a bounded event without provider internals", async () => {
    const model = modelWith(
      streamResult([{ id: "t1", name: "run_code", input: { language: "python", query: "print(1)" } }]),
      streamResult([speak("s1", "Ran code.", false)]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const runTool = vi.fn(async () => {
      throw new Error("sk-secret provider stack trace");
    });

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput({ runTool }));

    expect(result.toolEvents).toHaveLength(1);
    const event = result.toolEvents[0]!;
    expect(event).toMatchObject({ tool: "run_code", ok: false, error: "Tool execution failed" });
    expect(JSON.stringify(result)).not.toContain("sk-secret");
    expect(JSON.stringify(result)).not.toContain("stack trace");
  });

  it("advances the private conversation with the observation and response messages", async () => {
    const model = modelWith(
      streamResult([{ id: "t1", name: "web_search", input: { query: "first move" } }]),
      streamResult([speak("s1", "First move done.", false)]),
      streamResult([speak("s2", "Second move done.", false)]),
    );
    mocks.createWebModel.mockResolvedValue(model);

    const session = createWebStandardAgentSession(factoryInput);
    await session.move(moveInput({ phase: "standard-a-opening" }));
    const second = await session.move(moveInput({ phase: "standard-a-round-1" }));

    expect(mocks.createWebModel).toHaveBeenCalledTimes(1);
    expect(model.doStreamCalls).toHaveLength(3);

    const firstMessages = model.doStreamCalls[0]!.prompt;
    const secondMessages = model.doStreamCalls[1]!.prompt;
    const thirdMessages = model.doStreamCalls[2]!.prompt;
    expect(thirdMessages.length).toBeGreaterThan(secondMessages.length);
    expect(firstMessages.length).toBeGreaterThan(0);
    // The second move replays the first private conversation plus a fresh observation.
    const thirdText = promptText(thirdMessages);
    expect(thirdText).toContain("standard-a-opening");
    expect(thirdText).toContain("standard-a-round-1");
    // The last message of the second call is the new public observation.
    const last = thirdMessages.at(-1);
    expect(last?.role).toBe("user");
    if (last && Array.isArray(last.content)) {
      const lastText = last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      expect(lastText).toContain("standard-a-round-1");
      expect(lastText).not.toContain("standard-a-opening");
    }
    // The private conversation now contains assistant/tool response messages.
    expect(thirdMessages.some((message) => message.role === "assistant")).toBe(true);
    expect(second.speech).toBe("Second move done.");
  });

  it("treats a move that never calls speak as a protocol error", async () => {
    const model = modelWith(textOnlyStream());
    mocks.createWebModel.mockResolvedValue(model);

    const session = createWebStandardAgentSession(factoryInput);
    await expect(session.move(moveInput())).rejects.toThrow(/speak/);
  });

  it("reports token usage from the model stream", async () => {
    const model = modelWith(streamResult([speak("s1", "Closing.", true)]));
    mocks.createWebModel.mockResolvedValue(model);

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput());

    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 3 });
  });
});
