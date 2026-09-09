/**
 * OpenCode gateway headers (`@arena/ai`, `packages/ai/src/opencode-gateway.ts`).
 *
 * Since 2026-09-05/06 the hosted OpenCode gateway (base URL host
 * `opencode.ai`, paths `/zen/go/v1/*` and `/zen/v1/*`) rejects inference
 * requests that lack the `x-opencode-session` header with
 * `400 {"type":"MissingSessionID"}`. It expects a STABLE per-conversation
 * session id (same value across every request of one conversation, fresh id
 * per conversation) plus a real client `User-Agent` instead of the SDK
 * default. Auth is unchanged (Bearer).
 *
 * This module is pure: no fs, no secrets, no globals. Callers thread an
 * explicit `sessionKey` through (the debate engine derives stable
 * per-match+slot keys); this helper only decides whether headers apply.
 */

/** Workspace version, mirrored from the root `package.json` (no fs reads here). */
export const ARENA_VERSION = "0.3.0";

/** Client identifier sent as `User-Agent` on OpenCode gateway requests. */
export const ARENA_USER_AGENT = `ai-debate-arena/${ARENA_VERSION}`;

/** Session header required by the OpenCode gateway. */
export const OPENCODE_SESSION_HEADER = "x-opencode-session";

/** True only when the base URL host is exactly `opencode.ai` (case-insensitive). */
export function isOpencodeGateway(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "opencode.ai";
  } catch {
    return false;
  }
}

/**
 * Extra request headers for a provider base URL. Returns the session +
 * `User-Agent` pair when the host is exactly `opencode.ai`, otherwise `{}` —
 * inert for every other provider (no behavior change off-gateway).
 */
export function opencodeGatewayHeaders(baseUrl: string, sessionKey: string): Record<string, string> {
  if (!isOpencodeGateway(baseUrl)) return {};
  return { [OPENCODE_SESSION_HEADER]: sessionKey, "User-Agent": ARENA_USER_AGENT };
}
