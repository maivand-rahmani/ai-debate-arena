import "server-only";

/**
 * Bounded request-body reader shared by API routes that must reject
 * oversized bodies BEFORE parsing them (challenge route; the debate route
 * keeps its own inline copy to avoid touching the live stream path).
 *
 * Reads the body with a hard byte cap, rejecting without buffering the whole
 * payload. Returns `null` when the body exceeds the cap or is not valid
 * UTF-8.
 */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export async function readBoundedJsonBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_JSON_BODY_BYTES) {
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
