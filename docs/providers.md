# Providers

Any OpenAI-compatible chat API. Schema (`apps/web/src/shared/config/provider.ts`):

| Field      | Rule                                              |
| ---------- | ------------------------------------------------- |
| `id`       | 1–64 chars, `[A-Za-z0-9_-]`; re-adding replaces   |
| `name`     | Display name, 1–100 chars                         |
| `baseUrl`  | http(s) URL of the compatible endpoint            |
| `model`    | Default model id, 1–200 chars                     |
| `api`      | `"chat"` (default) or `"responses"`; see below    |
| `apiKey`   | 1–4096 chars; stored, never returned or printed   |

Use `api: "responses"` when the endpoint only serves the OpenAI Responses API
(`POST {baseUrl}/responses`) instead of Chat Completions; `buildAiModel` in
`@arena/ai` then uses `createOpenAI(...).responses(model)` from
`@ai-sdk/openai`, otherwise `createOpenAICompatible(...).languageModel(model)`.
The chat-vs-responses branching lives entirely in `@arena/ai` — callers pass
the stored provider record through unchanged.

### Responses-only judge fallback

The judge first requests schema-validated output when the provider supports it.
If a Responses-only model does not produce that form, the web adapter retries
with a schema-free JSON instruction over streaming, then once through the
ordinary Responses transport if the stream is empty. This keeps models that
support ordinary response generation — but not structured schemas — usable as
judges. The adapter does not force a temperature on that fallback; the provider
keeps its own compatible default.

## Storage

`~/.ai-debate-arena/providers.json` (override: `AI_DEBATE_ARENA_PROVIDER_FILE`).
Written atomically (tmp file + rename) with `0600`; parent dir `0700`.
Missing file reads as `{ providers: [] }`. Server-only (`server-only` import
in `apps/web/src/shared/config/`); resolution runs provider-db → `@arena/ai`
`buildAiModel` per call, so `@arena/ai` itself never touches fs or secrets.

## Masking

`redactProviderConfig` strips `apiKey`, adds `apiKeyHint`: first 4 + 8 `•` +
last 4 chars (all `•` for keys ≤ 8 chars). The CLI confirms the save without
echoing the key.

## CLI (`apps/web/scripts/provider-add.ts`)

```bash
npm run provider:add            # tsx apps/web/scripts/provider-add.ts, from the repo root
# Provider id · Display name · Base URL [https://api.openai.com/v1] ·
# API type (chat/responses) [chat] · Default model [gpt-4o-mini] · API key
```

## Endpoints

- `GET /api/providers` → `{ providers: [{ id, name, baseUrl, model, api, apiKeyHint }] }`.
- `POST /api/providers` — body `{ id, name, baseUrl, model, api?, apiKey }`
  → `200` with the bare redacted record
  `{ id, name, baseUrl, model, api, apiKeyHint }`;
  `400 { error, issues: [{ field, message }] }` on validation failure.
- `PUT /api/providers/[id]` — body `{ name?, baseUrl?, model?, api?, apiKey? }`
  (`apiKey` omitted or `""` preserves the stored key; a non-empty value
  rotates it) → `200` with the bare redacted record; `404 { error }` for
  unknown ids; `400 { error, issues }` on validation failure.
- `DELETE /api/providers/[id]` → `204` (empty); `404 { error }` unknown.
- `POST /api/providers/[id]/test` — one minimal non-streaming probe call
  (fresh `probe-<uuid>` session key, 15 s timeout, 16-token cap)
  → `200 { ok: true, latencyMs }` or
  `200 { ok: false, error: { code, message } }` where `code` is one of
  `auth | rate_limit | timeout | unreachable | upstream | unknown`
  (mapped through the safe typed provider errors in `@arena/ai`);
  `404 { error }` for unknown ids. No response body ever contains an API key.
- `POST /api/debate` takes `providerId` + per-side `model` (may differ from the
  stored default); unknown ids fail as safe `error` events, not stack traces.

The CLI (`npm run provider:add`) remains supported for creating providers;
it stores through the same `addProvider` path as `POST /api/providers`.

## Safe errors (`@arena/ai`, `packages/ai/src/errors.ts`)
`toSafeErrorMessage` maps: 401/403 → auth failure ("check the configured API
key"); 429 → rate limit ("wait and try again"); timeouts/`AbortError` →
"timed out"; ENOTFOUND/ECONNREFUSED/fetch-failed → "unreachable, check base
URL"; other statuses → `failed (status N)`. Unknown messages are sanitized
(credentialed URLs, `sk-…`, `apiKey=…`, Bearer tokens redacted, ≤200 chars) —
keys and credentialed URLs never reach the client. `toSafeProviderErrorCode`
adds a stable machine-readable class for the same branches
(`auth | rate_limit | timeout | unreachable | upstream | unknown`), used by
`POST /api/providers/[id]/test`.

## OpenCode gateway headers (`@arena/ai`, `packages/ai/src/opencode-gateway.ts`)

The hosted OpenCode gateway (host `opencode.ai`, `/zen/go/v1/*`, `/zen/v1/*`)
requires `x-opencode-session` (stable per conversation) plus a real client
`User-Agent`, else `400 {"type":"MissingSessionID"}`. `buildAiModel` takes an
explicit `sessionKey` option and sends
`{ x-opencode-session: <key>, User-Agent: ai-debate-arena/<version> }` on
BOTH adapters (chat completions and Responses API, streaming and
non-streaming) only when the base-URL host is exactly `opencode.ai`
(case-insensitive) — every other provider sees zero behavior change. The
debate engine derives the key per match slot
(`sessionKeyForMatchSlot(matchId, "agent-a" | "agent-b" | "judge")`), so
streaming turns, retries, and re-judges of one match reuse the same keys
while different matches/slots differ. Probe calls
(`POST /api/providers/[id]/test`) use a fresh `probe-<uuid>` key per click.

## Examples

- OpenRouter: baseUrl `https://openrouter.ai/api/v1`, model e.g.
  `openai/gpt-4o-mini`, key = OpenRouter key.
- Local Ollama: baseUrl `http://localhost:11434/v1`, model e.g. `llama3.1`,
  any non-empty key (Ollama ignores it, schema requires one).
