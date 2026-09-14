import { randomUUID } from "node:crypto";
import { runDebate } from "@arena/debate-engine";
import { webCallModel, webRunStandardTool, webSaveMatch } from "@/features/run-debate/server/web-adapter";
import { createWebStandardAgentSession } from "@/features/run-debate/server/standard-agent-adapter";
import { matchConfigSchema } from "@arena/debate-engine";
import { getProvider } from "@/shared/config/provider-store";
import { SIDE_POSITIONS } from "@/shared/config/sides";
import { MATCH_PROFILES, MATCH_TIMEOUT_MS } from "@arena/debate-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = matchConfigSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!MATCH_PROFILES[parsed.data.mode].enabled) {
    return Response.json({ error: "Unsupported mode" }, { status: 400 });
  }

  // Sides are fixed by the product: A argues FOR, B argues AGAINST. Normalize
  // here too so a stale/legacy client can never swap the verdict's sides.
  const config = {
    ...parsed.data,
    agentA: { ...parsed.data.agentA, position: SIDE_POSITIONS.A },
    agentB: { ...parsed.data.agentB, position: SIDE_POSITIONS.B },
  };

  // Fail fast on unknown provider ids: the API contract reports bad input as
  // 400 instead of surfacing it as a mid-stream error event.
  const [configA, configB] = await Promise.all([
    getProvider(config.agentA.providerId),
    getProvider(config.agentB.providerId),
  ]);
  if (!configA || !configB) {
    const missing = !configA ? config.agentA.providerId : config.agentB.providerId;
    return Response.json({ error: `Unknown provider: ${missing}` }, { status: 400 });
  }

  const matchId = randomUUID();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(MATCH_TIMEOUT_MS)]);
  const events = runDebate(config, {
    callModel: webCallModel,
    saveMatch: webSaveMatch,
    runTool: webRunStandardTool,
    createStandardAgentSession: createWebStandardAgentSession,
    abortSignal: signal,
    matchId,
    profile: MATCH_PROFILES[config.mode],
    sides: {
      A: { providerName: configA.name, modelId: config.agentA.model, position: SIDE_POSITIONS.A },
      B: { providerName: configB.name, modelId: config.agentB.model, position: SIDE_POSITIONS.B },
    },
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const onAbort = () => {
        void events.return?.(undefined);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        for await (const event of events) {
          if (signal.aborted) break;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            break;
          }
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        await events.return?.(undefined);
        try {
          controller.close();
        } catch {
          // Already closed after client disconnect.
        }
      }
    },
    cancel() {
      void events.return?.(undefined);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
