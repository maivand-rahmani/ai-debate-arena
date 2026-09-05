import { listProviders } from "@/shared/config/provider-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const providers = await listProviders();
  return Response.json({ providers });
}
