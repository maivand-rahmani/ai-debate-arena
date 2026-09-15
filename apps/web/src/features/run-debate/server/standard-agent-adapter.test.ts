import { describe, expect, it, beforeEach, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { ModelMessage } from "ai";
import type {
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type {
  StandardAgentMoveInput,
  StandardAgentProgressEvent,
  StandardAgentSessionFactoryInput,
} from "@arena/debate-engine";

const mocks = vi.hoisted(() => ({
  createWebModel: vi.fn(),
}));

vi.mock("@/features/run-debate/server/web-adapter", () => ({
  createWebModel: mocks.createWebModel,
}));

import { boundPrivateMessages, createWebStandardAgentSession } from "./standard-agent-adapter";

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

/**
 * A provider stream that emits its parts immediately, then stays open until
 * `gate` resolves before finishing. Lets a test observe progress that the
 * adapter emitted while the move is still streaming.
 */
function gatedStreamResult(parts: readonly LanguageModelV4StreamPart[], gate: Promise<void>): LanguageModelV4StreamResult {
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        for (const part of parts) controller.enqueue(part);
        void gate.then(() => {
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage: {
              inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 3, text: 3, reasoning: 0 },
            },
          });
          controller.close();
        });
      },
    }),
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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

  it("executes affordable tools and reports over-budget attempts as public failures", async () => {
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
    const progress: StandardAgentProgressEvent[] = [];
    const result = await session.move(
      moveInput({ maxAffordableTools: 1, runTool, onProgress: (event) => progress.push(event) }),
    );

    // Only the affordable call reached the executor.
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith(
      "web_search",
      { query: "car ban evidence", timeoutMs: 8_000 },
      undefined,
    );
    // The executed call plus the rejected attempt are both visible; the
    // rejected one is flagged and never executed. Parallel SDK tool calls may
    // settle out of call order, so pair by tool/query rather than index.
    expect(result.toolEvents).toHaveLength(2);
    expect(result.toolEvents.find((event) => event.query === "car ban evidence")).toMatchObject({
      tool: "web_search",
      ok: true,
    });
    expect(result.toolEvents.find((event) => event.query === "https://example.com/over-cap")).toMatchObject({
      tool: "fetch_url",
      ok: false,
      error: "Tool budget exhausted",
      rejected: true,
    });
    // Every result pairs with an earlier start sharing its invocation id.
    const starts = new Set(
      progress.flatMap((event) => (event.type === "tool-start" ? [event.invocationId] : [])),
    );
    const results = progress.flatMap((event) => (event.type === "tool-result" ? [event.invocationId] : []));
    expect(starts.size).toBe(2);
    expect(results).toHaveLength(2);
    expect(results.every((id) => starts.has(id))).toBe(true);
    // The refused attempt is flagged on the public progress event too, so the
    // wire and the canonical record agree.
    const rejectedResult = progress.find(
      (event) => event.type === "tool-result" && event.invocationId.includes("fetch_url"),
    );
    expect(rejectedResult && rejectedResult.type === "tool-result" && rejectedResult.rejected).toBe(true);
    expect(result.speech).toBe("With evidence.");
    expect(result.ready).toBe(false);
    // speak must never be reported as a public tool event.
    expect(result.toolEvents.some((event) => (event.tool as string) === "speak")).toBe(false);
  });

  it("publishes at most one over-budget rejection per move", async () => {
    const model = modelWith(
      streamResult([
        { id: "t1", name: "web_search", input: { query: "one" } },
        { id: "t2", name: "fetch_url", input: { query: "two" } },
        { id: "t3", name: "run_code", input: { language: "javascript", query: "3" } },
      ]),
      streamResult([speak("s1", "Speak now.", false)]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const runTool = vi.fn(async () => ({ ok: true, output: "should not run" }));

    const session = createWebStandardAgentSession(factoryInput);
    const progress: StandardAgentProgressEvent[] = [];
    const result = await session.move(
      moveInput({ maxAffordableTools: 0, runTool, onProgress: (event) => progress.push(event) }),
    );

    expect(runTool).not.toHaveBeenCalled();
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0]).toMatchObject({ rejected: true, error: "Tool budget exhausted" });
    expect(progress.filter((event) => event.type === "tool-start")).toHaveLength(1);
    expect(progress.filter((event) => event.type === "tool-result")).toHaveLength(1);
  });

  it("returns tool events in call order even when parallel tools finish out of order", async () => {
    const model = modelWith(
      streamResult([
        { id: "t1", name: "web_search", input: { query: "slow" } },
        { id: "t2", name: "fetch_url", input: { query: "fast" } },
      ]),
      streamResult([speak("s1", "Done.", false)]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const runTool: StandardAgentMoveInput["runTool"] = async (_tool, input) => {
      if (input.query === "slow") await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true, output: `${input.query} output` };
    };

    const session = createWebStandardAgentSession(factoryInput);
    const progress: StandardAgentProgressEvent[] = [];
    const result = await session.move(
      moveInput({ maxAffordableTools: 2, runTool, onProgress: (event) => progress.push(event) }),
    );

    // Results streamed in completion order …
    const completionOrder = progress.flatMap((event) =>
      event.type === "tool-result" ? [event.query] : [],
    );
    expect(completionOrder).toEqual(["fast", "slow"]);
    // … but the move reports them in invocation order for deterministic replay.
    expect(result.toolEvents.map((event) => event.query)).toEqual(["slow", "fast"]);
  });

  it("bounds the private conversation to the runner-supplied context budget", async () => {
    const model = modelWith(
      streamResult([speak("s1", "First move.", false)]),
      streamResult([speak("s2", "Second move.", false)]),
    );
    mocks.createWebModel.mockResolvedValue(model);

    const session = createWebStandardAgentSession({ ...factoryInput, maxContextChars: 650 });
    await session.move(moveInput({ phase: "standard-a-opening" }));
    await session.move(moveInput({ phase: "standard-a-round-1" }));

    expect(model.doStreamCalls).toHaveLength(2);
    const firstPrompt = promptText(model.doStreamCalls[0]!.prompt);
    const secondPrompt = promptText(model.doStreamCalls[1]!.prompt);
    expect(firstPrompt).toContain("standard-a-opening");
    // The first observation group was dropped, but the newest one remains and
    // private reasoning never leaks into the bounded conversation.
    expect(secondPrompt).not.toContain("standard-a-opening");
    expect(secondPrompt).toContain("standard-a-round-1");
  });

  it("truly caps a single oversized observation", async () => {
    const model = modelWith(streamResult([speak("s1", "Opening.", false)]));
    mocks.createWebModel.mockResolvedValue(model);

    const session = createWebStandardAgentSession({ ...factoryInput, maxContextChars: 120 });
    await session.move(moveInput());

    const observation = model.doStreamCalls[0]!.prompt.filter((message) => message.role === "user").at(-1)!;
    const text = promptText([observation]);
    expect(text.length).toBeLessThanOrEqual(120);
    // The topic header survives even a budget smaller than the header itself.
    expect(text).toContain("TOPIC:");
  });

  it("keeps a valid role sequence in bounded requests", async () => {
    const model = modelWith(
      streamResult([{ id: "t1", name: "web_search", input: { query: "q1" } }]),
      streamResult([speak("s1", "First.", false)]),
      streamResult([{ id: "t2", name: "web_search", input: { query: "q2" } }]),
      streamResult([speak("s2", "Second.", false)]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const runTool = async (): Promise<{ ok: boolean; output: string }> => ({ ok: true, output: "out" });

    const session = createWebStandardAgentSession({ ...factoryInput, maxContextChars: 2_000 });
    await session.move(moveInput({ phase: "standard-a-opening", runTool }));
    await session.move(moveInput({ phase: "standard-a-round-1", runTool }));

    for (const call of model.doStreamCalls) {
      const firstNonSystem = call.prompt.find((message) => message.role !== "system");
      expect(firstNonSystem?.role).toBe("user");
      let sawAssistant = false;
      for (const message of call.prompt) {
        if (message.role === "assistant") sawAssistant = true;
        if (message.role === "tool") expect(sawAssistant).toBe(true);
      }
    }
  });

  it("keeps a full-length large-output match within the context budget", async () => {
    const bigOutput = "evidence ".repeat(750);
    const steps: LanguageModelV4StreamResult[] = [];
    for (let index = 0; index < 4; index += 1) {
      steps.push(streamResult([{ id: `t${index}`, name: "web_search", input: { query: `query-${index}` } }]));
      steps.push(streamResult([speak(`s${index}`, `Speech ${index}.`, false)]));
    }
    const model = modelWith(...steps);
    mocks.createWebModel.mockResolvedValue(model);
    const runTool = vi.fn(async () => ({ ok: true, output: bigOutput }));

    const session = createWebStandardAgentSession({ ...factoryInput, maxContextChars: 4_000 });
    for (let index = 0; index < 4; index += 1) {
      await session.move(moveInput({ phase: `standard-a-phase-${index}`, runTool }));
    }

    // Every observation request stays under the budget even after four moves
    // that each returned a full-length tool output.
    for (const call of model.doStreamCalls) {
      for (const message of call.prompt) {
        if (message.role !== "user") continue;
        expect(promptText([message]).length).toBeLessThanOrEqual(4_000);
      }
    }
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

  it("emits ordered word-by-word chunks across fragmented tool-input deltas", async () => {
    // The deltas deliberately split the JSON key, the value opening, and the
    // content itself, matching how a provider streams raw tool arguments.
    const model = modelWith(
      speakInputStream([
        "{",
        '"con',
        'tent":',
        '"Alpha',
        " beta",
        " gamma",
        ' delta"',
        ',"ready":true}',
      ]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const progress: Array<{ type: string; text?: string }> = [];

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput({ onProgress: (event) => progress.push(event) }));

    expect(result.speech).toBe("Alpha beta gamma delta");
    const speechChunks = progress
      .filter((event) => event.type === "speech")
      .map((event) => event.text ?? "");
    // Multiple ordered chunks, one per content growth, with no JSON syntax or
    // duplicated content.
    expect(speechChunks).toEqual(["Alpha", " beta", " gamma", " delta"]);
    expect(speechChunks.length).toBeGreaterThan(1);
    expect(speechChunks.join("")).toBe(result.speech);
  });

  it("streams public speech chunks before the move resolves", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = modelWith(
      gatedStreamResult(
        [
          { type: "tool-input-start", id: "speak-1", toolName: "speak" },
          { type: "tool-input-delta", id: "speak-1", delta: '{"content":"First ' },
          { type: "tool-input-delta", id: "speak-1", delta: "second " },
          { type: "tool-input-delta", id: "speak-1", delta: 'third","ready":false}' },
          { type: "tool-input-end", id: "speak-1" },
          {
            type: "tool-call",
            toolCallId: "speak-1",
            toolName: "speak",
            input: '{"content":"First second third","ready":false}',
          },
        ],
        gate,
      ),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const progress: StandardAgentProgressEvent[] = [];
    const session = createWebStandardAgentSession(factoryInput);
    let settled = false;
    const movePromise = session.move(moveInput({ onProgress: (event) => progress.push(event) }));
    void movePromise.finally(() => {
      settled = true;
    });

    // The provider stream is still open, yet the adapter has already delivered
    // ordered public chunks through the progress callback.
    await waitFor(() => progress.filter((event) => event.type === "speech").length >= 3);
    expect(settled).toBe(false);
    const chunks = progress.flatMap((event) => (event.type === "speech" ? [event.text] : []));
    expect(chunks).toEqual(["First ", "second ", "third"]);
    expect(JSON.stringify(progress)).not.toContain("private");

    release();
    const result = await movePromise;
    expect(result.speech).toBe("First second third");
  });

  it("returns the public speech through the fallback when only a final tool call is sent", async () => {
    const model = modelWith(
      streamPartsResult([
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "private reasoning that must stay hidden" },
        { type: "text-end", id: "t" },
        {
          type: "tool-call",
          toolCallId: "speak-1",
          toolName: "speak",
          input: '{"content":"Fallback public speech","ready":true}',
        },
      ]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const progress: StandardAgentProgressEvent[] = [];

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput({ onProgress: (event) => progress.push(event) }));

    expect(result.speech).toBe("Fallback public speech");
    expect(result.ready).toBe(true);
    // With no tool-input deltas the whole public speech is still delivered once
    // through the execute fallback, and private text never leaks.
    const speech = progress.flatMap((event) => (event.type === "speech" ? [event.text] : []));
    expect(speech).toEqual(["Fallback public speech"]);
    expect(JSON.stringify(progress)).not.toContain("private reasoning");
  });

  it("delivers the validated public speech when it differs from the streamed deltas", async () => {
    const model = modelWith(
      streamPartsResult([
        { type: "tool-input-start", id: "speak-1", toolName: "speak" },
        // Duplicate `content` keys: the streamed decoder takes the first, while
        // JSON.parse (and therefore the SDK's validated input) keeps the last.
        {
          type: "tool-input-delta",
          id: "speak-1",
          delta: '{"content":"Draft wording","content":"Final wording","ready":false}',
        },
        { type: "tool-input-end", id: "speak-1" },
        {
          type: "tool-call",
          toolCallId: "speak-1",
          toolName: "speak",
          input: '{"content":"Draft wording","content":"Final wording","ready":false}',
        },
      ]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const progress: StandardAgentProgressEvent[] = [];

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput({ onProgress: (event) => progress.push(event) }));

    expect(result.speech).toBe("Final wording");
    const speech = progress.flatMap((event) => (event.type === "speech" ? [event.text] : [])).join("");
    // The validated speech is delivered through the fallback even though the
    // streamed prefix diverged, so the caption is never left with stale words.
    expect(speech.endsWith("Final wording")).toBe(true);
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

  it("ignores a second streamed speak call instead of mixing its speech", async () => {
    const model = modelWith(
      streamPartsResult([
        { type: "tool-input-start", id: "speak-1", toolName: "speak" },
        { type: "tool-input-delta", id: "speak-1", delta: '{"content":"First","ready":false}' },
        { type: "tool-input-end", id: "speak-1" },
        { type: "tool-input-start", id: "speak-2", toolName: "speak" },
        { type: "tool-input-delta", id: "speak-2", delta: '{"content":"Second","ready":false}' },
        { type: "tool-input-end", id: "speak-2" },
        {
          type: "tool-call",
          toolCallId: "speak-1",
          toolName: "speak",
          input: '{"content":"First","ready":false}',
        },
        {
          type: "tool-call",
          toolCallId: "speak-2",
          toolName: "speak",
          input: '{"content":"Second","ready":false}',
        },
      ]),
    );
    mocks.createWebModel.mockResolvedValue(model);
    const progress: Array<{ type: string; text?: string }> = [];

    const session = createWebStandardAgentSession(factoryInput);
    await expect(
      session.move(moveInput({ onProgress: (event) => progress.push(event) })),
    ).rejects.toThrow(/more than once/);

    // Only the first speech was streamed; the duplicate is a protocol error,
    // not extra public text.
    const speechText = progress
      .filter((event) => event.type === "speech")
      .map((event) => event.text ?? "")
      .join("");
    expect(speechText).toBe("First");
    expect(speechText).not.toContain("Second");
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

  it("rejects a move that calls speak more than once", async () => {
    const model = modelWith(
      streamResult([speak("s1", "First attempt.", false), speak("s2", "Second attempt.", false)]),
    );
    mocks.createWebModel.mockResolvedValue(model);

    const session = createWebStandardAgentSession(factoryInput);
    await expect(session.move(moveInput())).rejects.toThrow(/more than once/);
  });

  it("reports token usage from the model stream", async () => {
    const model = modelWith(streamResult([speak("s1", "Closing.", true)]));
    mocks.createWebModel.mockResolvedValue(model);

    const session = createWebStandardAgentSession(factoryInput);
    const result = await session.move(moveInput());

    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 3 });
  });

  it("evicts older groups as a suffix without inventing content", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: `u1${"a".repeat(100)}` },
      { role: "assistant", content: `a1${"b".repeat(100)}` },
      { role: "user", content: `u2${"c".repeat(100)}` },
      { role: "assistant", content: `a2${"d".repeat(100)}` },
    ];
    const bounded = boundPrivateMessages(messages, 220);
    // Only the newest whole group survives, byte-for-byte — no summary or
    // synthesized message is inserted.
    expect(bounded.map((message) => message.content)).toEqual([messages[2]!.content, messages[3]!.content]);
    expect(bounded).not.toBe(messages);
  });
});
