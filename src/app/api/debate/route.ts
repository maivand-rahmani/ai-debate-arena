import { randomUUID } from "node:crypto";
import { runDebate } from "@/features/run-debate/server/debate-runner";
import { matchConfigSchema } from "@/entities/debate/contract";
import { getProvider } from "@/shared/config/provider-store";
import { MATCH_PROFILES, MATCH_TIMEOUT_MS } from "@/shared/token-policy";

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
  // Only quick is enabled; other contract modes stay server-rejected.
  if (parsed.data.mode !== "quick") {
    return Response.json({ error: "Unsupported mode" }, { status: 400 });
  }

  // Fail fast on unknown provider ids: the API contract reports bad input as
  // 400 instead of surfacing it as a mid-stream error event.
  const [configA, configB] = await Promise.all([
    getProvider(parsed.data.agentA.providerId),
    getProvider(parsed.data.agentB.providerId),
  ]);
  if (!configA || !configB) {
    const missing = !configA ? parsed.data.agentA.providerId : parsed.data.agentB.providerId;
    return Response.json({ error: `Unknown provider: ${missing}` }, { status: 400 });
  }

  const matchId = randomUUID();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(MATCH_TIMEOUT_MS)]);
  const events = runDebate(parsed.data, {
    abortSignal: signal,
    matchId,
    profile: MATCH_PROFILES[parsed.data.mode],
    sides: {
      A: { providerName: configA.name, modelId: parsed.data.agentA.model, position: parsed.data.agentA.position },
      B: { providerName: configB.name, modelId: parsed.data.agentB.model, position: parsed.data.agentB.position },
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
