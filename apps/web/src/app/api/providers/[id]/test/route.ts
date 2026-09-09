import { testProvider } from "@/shared/config/provider-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProviderTestRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(_request: Request, context: ProviderTestRouteContext): Promise<Response> {
  const { id } = await context.params;
  const result = await testProvider(id);
  if (!result) {
    return Response.json({ error: "Provider not found" }, { status: 404 });
  }
  return Response.json(result);
}
