import "server-only";

import { generateText, Output, streamText } from "ai";
import { buildAiModel, toSafeErrorMessage } from "@arena/ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  debateVerdictSchema,
  toModelUsage,
  type MatchRecord,
  type ModelCallArgs,
  type ModelCallResult,
  type ModelUsage,
} from "@arena/debate-engine";
import { getProvider } from "@/shared/config/provider-store";
import { saveMatchRecord } from "@/shared/config/match-store";

/**
 * Creates a server-side model; credentials never leave this module.
 * (Verbatim body of the former `createConfiguredModel` in
 * `shared/api/llm/model.ts`, kept inline so the runner adapter owns the
 * whole web seam in one file.)
 */
async function createWebModel(
  providerId: string,
  modelId?: string,
  sessionKey?: string,
): Promise<LanguageModelV4> {
  try {
    const config = await getProvider(providerId);
    if (!config) throw new Error(`Provider not found: ${providerId}`);
    return buildAiModel(config, modelId, sessionKey === undefined ? undefined : { sessionKey });
  } catch (err) {
    throw new Error(toSafeErrorMessage(err));
  }
}

/**
 * Web `callModel` dep for the engine runner: verbatim body of the former
 * `defaultCallModel` in `features/run-debate/server/debate-runner.ts`
 * (agent `streamText` path, judge `generateText` + `Output.object` +
 * streaming JSON fallback + retry logic), with dynamic imports replaced by the
 * static imports above. Every log/error string is unchanged.
 */
const ZERO_USAGE: ModelUsage = { promptTokens: 0, completionTokens: 0 };

export async function webCallModel(args: ModelCallArgs): Promise<ModelCallResult> {
  const model = await createWebModel(args.providerId, args.modelId, args.sessionKey);
  if (args.kind === "judge") {
    const total: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
    try {
      const structured = await generateText({
        model,
        system: args.system,
        prompt: args.prompt,
        maxOutputTokens: args.maxOutputTokens,
        abortSignal: args.abortSignal,
        output: Output.object({ schema: debateVerdictSchema }),
      });
      addUsage(total, toModelUsage(structured.usage));
      // Some providers (notably Responses API) can resolve without throwing
      // yet leave `output` undefined/null. Never serialize that into
      // "undefined"/"null" text — fall through to the plain-text fallback.
      const structuredOutput: unknown = (structured as { readonly output?: unknown }).output;
      if (!structuredOutput || typeof structuredOutput !== "object" || Array.isArray(structuredOutput)) {
        throw new Error("Judge structured output was empty");
      }
      return { text: JSON.stringify(structuredOutput), chunks: [], usage: { ...total } };
    } catch (error) {
      // Some OpenAI-compatible Responses gateways resolve non-streaming calls
      // with empty text while their streaming endpoint works normally. Use the
      // proven streaming transport for the plain-JSON fallback.
      console.warn("[arena:judge] structured output unavailable; using streaming JSON fallback", {
        providerId: args.providerId,
        modelId: args.modelId,
        reason: error instanceof Error ? error.message : String(error),
      });
      const fallback = streamText({
        model,
        system: args.system,
        prompt:
          `${args.prompt}\n\nRespond with ONLY valid JSON matching the required schema: ` +
          `concrete integer scores 0-100, no markdown fences, no prose.`,
        maxOutputTokens: args.maxOutputTokens,
        abortSignal: args.abortSignal,
        temperature: 0,
      });
      const chunks: string[] = [];
      for await (const chunk of fallback.textStream) chunks.push(chunk);
      const text = await fallback.text;
      try {
        addUsage(total, toModelUsage(await fallback.usage));
      } catch {
        // Usage is optional and must never turn a valid judge result into an error.
      }
      return { text, chunks: [], usage: { ...total } };
    }
  }
  return callAgentWithStreamingFallback(model, args);
}

async function callAgentWithStreamingFallback(
  model: LanguageModelV4,
  args: ModelCallArgs,
): Promise<ModelCallResult> {
  try {
    const streamed = streamText({
      model,
      system: args.system,
      prompt: args.prompt,
      maxOutputTokens: args.maxOutputTokens,
      abortSignal: args.abortSignal,
    });
    const chunks: string[] = [];
    let streamError: unknown;
    for await (const part of streamed.stream) {
      if (part.type === "text-delta") chunks.push(part.text);
      if (part.type === "error") streamError = part.error;
    }
    if (streamError) throw streamError;
    const text = (await streamed.text) || chunks.join("");
    if (text.trim()) {
      let usage: ModelUsage = ZERO_USAGE;
      try {
        usage = toModelUsage(await streamed.usage);
      } catch {
        // Usage is optional and must never discard a valid reply.
      }
      return { text, chunks, usage };
    }
    console.warn("[arena:agent] streaming response was empty; using non-streaming fallback", {
      providerId: args.providerId,
      modelId: args.modelId,
    });
  } catch (error) {
    if (args.abortSignal?.aborted) throw error;
    if (!shouldFallbackToNonStreaming(error)) throw error;
    console.warn("[arena:agent] streaming response failed; using non-streaming fallback", {
      providerId: args.providerId,
      modelId: args.modelId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const completed = await generateText({
    model,
    system: args.system,
    prompt: args.prompt,
    maxOutputTokens: args.maxOutputTokens,
    abortSignal: args.abortSignal,
  });
  if (!completed.text.trim()) {
    throw new Error("Provider returned an empty response. Choose a model that supports text generation.");
  }
  return {
    text: completed.text,
    chunks: [],
    usage: toModelUsage(completed.usage),
  };
}

function shouldFallbackToNonStreaming(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AI_InvalidResponseDataError"
    || /no output generated|stream ended without a finish/i.test(error.message);
}

function addUsage(into: { promptTokens: number; completionTokens: number }, usage: ModelUsage | undefined): void {
  if (!usage) return;
  into.promptTokens += usage.promptTokens;
  into.completionTokens += usage.completionTokens;
}

/**
 * Web `saveMatch` dep for the engine runner: verbatim body of the former
 * `defaultSaveMatch` minus the dynamic import (static match-store import).
 */
export async function webSaveMatch(record: MatchRecord): Promise<void> {
  await saveMatchRecord(record);
}
