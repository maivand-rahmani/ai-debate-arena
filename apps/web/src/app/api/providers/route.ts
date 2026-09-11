import { addProvider, listProviders, providerConfigSchema, redactProviderConfig } from "@/shared/config/provider-store";
import { LockTimeoutError } from "@/shared/config/record-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const providers = await listProviders();
  return Response.json({ providers });
}

function toIssues(error: unknown): Array<{ readonly field: string; readonly message: string }> {
  const issues = (error as { issues?: Array<{ path?: unknown; message?: unknown }> }).issues ?? [];
  return issues.map((issue) => ({
    field: Array.isArray(issue.path) ? issue.path.map(String).join(".") : "",
    message: typeof issue.message === "string" ? issue.message : "Invalid value",
  }));
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = providerConfigSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid provider configuration", issues: toIssues(parsed.error) }, { status: 400 });
  }
  let provider;
  try {
    provider = await addProvider(parsed.data);
  } catch (error) {
    if (error instanceof LockTimeoutError) {
      return Response.json({ error: "Another provider operation is in progress" }, { status: 409 });
    }
    throw error;
  }
  return Response.json(redactProviderConfig(provider));
}
