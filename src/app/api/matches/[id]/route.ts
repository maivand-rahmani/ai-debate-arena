import { exportMatchMarkdown } from "@/features/run-debate/server/export";
import { loadMatchRecord, matchRecordPath } from "@/shared/config/match-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MatchRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(request: Request, context: MatchRouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    matchRecordPath(id);
  } catch {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }
  const record = await loadMatchRecord(id);
  if (!record) {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }
  if (new URL(request.url).searchParams.get("format") === "markdown") {
    return new Response(exportMatchMarkdown(record), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="match-${record.matchId}.md"`,
      },
    });
  }
  return Response.json(record);
}
