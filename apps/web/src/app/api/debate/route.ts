import { randomUUID } from "node:crypto";
import { runDebate } from "@arena/debate-engine";
import { webCallModel, webSaveMatch } from "@/features/run-debate/server/web-adapter";
import {
  matchConfigSchema,
  normalizeUserEvidencePacket,
  type EvidenceBundle,
} from "@arena/debate-engine";
import { getProvider } from "@/shared/config/provider-store";
import { MATCH_PROFILES, MATCH_TIMEOUT_MS } from "@arena/debate-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bounded request-body cap. The config + evidence packet is small (evidence
 * content itself is capped at 16 KiB by the contract), so 64 KiB of JSON is
 * a generous ceiling; larger bodies are rejected before any parsing.
 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Read the request body with a hard byte cap BEFORE parsing it, so an
 * oversized body is rejected without buffering it whole. Returns `null` when
 * the body exceeds the cap or is not valid UTF-8.
 */
async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    text += decoder.decode();
  } catch {
    return null;
  }
  return text;
}

export async function POST(request: Request): Promise<Response> {
  const bodyText = await readBoundedBody(request);
  if (bodyText === null) {
    return Response.json({ error: "Request body too large" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
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

  // F10-06..08: normalize the optional user evidence server-side. All
  // identity/trust fields (ids, hashes, timestamps, statuses, provenance)
  // are assigned here; the strict input schema already rejected unknown or
  // forbidden client fields. Bad evidence fails with 400 before any model
  // call.
  let evidence: EvidenceBundle | undefined;
  if (parsed.data.evidence) {
    const normalized = normalizeUserEvidencePacket(parsed.data.evidence);
    if (!normalized.success) {
      return Response.json({ error: normalized.error }, { status: 400 });
    }
    evidence = normalized.data;
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
  const events = runDebate(
    {
      topic: parsed.data.topic,
      mode: parsed.data.mode,
      agentA: parsed.data.agentA,
      agentB: parsed.data.agentB,
      ...(evidence ? { evidence } : {}),
    },
    {
      callModel: webCallModel,
      saveMatch: webSaveMatch,
      abortSignal: signal,
      matchId,
      profile: MATCH_PROFILES[parsed.data.mode],
      sides: {
        A: { providerName: configA.name, modelId: parsed.data.agentA.model, position: parsed.data.agentA.position, providerId: parsed.data.agentA.providerId },
        B: { providerName: configB.name, modelId: parsed.data.agentB.model, position: parsed.data.agentB.position, providerId: parsed.data.agentB.providerId },
      },
    },
  );
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
