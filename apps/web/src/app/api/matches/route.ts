import { matchSummary } from "@/features/run-debate/server/export";
import { listMatchRecords } from "@/shared/config/match-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const records = await listMatchRecords();
  return Response.json({ matches: records.map(matchSummary) });
}
