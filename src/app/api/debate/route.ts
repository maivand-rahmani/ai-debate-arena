import { z } from "zod";
import { runDebate } from "@/features/run-debate/server/debate-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agentSchema = z.object({
  providerId: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(200),
  position: z.enum(["FOR", "AGAINST"]),
});

const bodySchema = z.object({
  topic: z.string().trim().min(1).max(2000),
  mode: z.literal("quick"),
  agentA: agentSchema,
  agentB: agentSchema,
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const events = runDebate(parsed.data);
  const signal = request.signal;
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
