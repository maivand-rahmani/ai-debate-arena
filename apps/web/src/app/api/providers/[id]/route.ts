import { ZodError } from "zod";
import { deleteProvider, updateProvider } from "@/shared/config/provider-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProviderRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

function toIssues(error: ZodError): Array<{ readonly field: string; readonly message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export async function PUT(request: Request, context: ProviderRouteContext): Promise<Response> {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  let updated;
  try {
    updated = await updateProvider(id, body);
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "Invalid provider configuration", issues: toIssues(error) }, { status: 400 });
    }
    throw error;
  }
  if (!updated) {
    return Response.json({ error: "Provider not found" }, { status: 404 });
  }
  return Response.json(updated);
}

export async function DELETE(_request: Request, context: ProviderRouteContext): Promise<Response> {
  const { id } = await context.params;
  const existed = await deleteProvider(id);
  if (!existed) {
    return Response.json({ error: "Provider not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
