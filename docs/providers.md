# Providers

Any OpenAI-compatible chat API. Schema (`shared/config/provider.ts`):

| Field      | Rule                                              |
| ---------- | ------------------------------------------------- |
| `id`       | 1–64 chars, `[A-Za-z0-9_-]`; re-adding replaces   |
| `name`     | Display name, 1–100 chars                         |
| `baseUrl`  | http(s) URL of the compatible endpoint            |
| `model`    | Default model id, 1–200 chars                     |
| `api`      | `"chat"` (default) or `"responses"`; see below    |
| `apiKey`   | 1–4096 chars; stored, never returned or printed   |

Use `api: "responses"` when the endpoint only serves the OpenAI Responses API
(`POST {baseUrl}/responses`) instead of Chat Completions; the model factory
then uses `createOpenAI(...).responses(model)` from `@ai-sdk/openai`.

## Storage

`~/.ai-debate-arena/providers.json` (override: `AI_DEBATE_ARENA_PROVIDER_FILE`).
Written atomically (tmp file + rename) with `0600`; parent dir `0700`.
Missing file reads as `{ providers: [] }`. Server-only (`server-only` import;
`createConfiguredModel` builds the `@ai-sdk/openai-compatible` model per call).

## Masking

`redactProviderConfig` strips `apiKey`, adds `apiKeyHint`: first 4 + 8 `•` +
last 4 chars (all `•` for keys ≤ 8 chars). The CLI confirms the save without
echoing the key.

## CLI

```bash
npm run provider:add
# Provider id · Display name · Base URL [https://api.openai.com/v1] ·
# API type (chat/responses) [chat] · Default model [gpt-4o-mini] · API key
```

## Endpoints

- `GET /api/providers` → `{ providers: [{ id, name, baseUrl, model, api, apiKeyHint }] }`.
- `POST /api/debate` takes `providerId` + per-side `model` (may differ from the
  stored default); unknown ids fail as safe `error` events, not stack traces.

## Safe errors (`shared/api/llm/errors.ts`)

`toSafeErrorMessage` maps: 401/403 → auth failure ("check the configured API
key"); 429 → rate limit ("wait and try again"); timeouts/`AbortError` →
"timed out"; ENOTFOUND/ECONNREFUSED/fetch-failed → "unreachable, check base
URL"; other statuses → `failed (status N)`. Unknown messages are sanitized
(credentialed URLs, `sk-…`, `apiKey=…`, Bearer tokens redacted, ≤200 chars) —
keys and credentialed URLs never reach the client.

## Examples

- OpenRouter: baseUrl `https://openrouter.ai/api/v1`, model e.g.
  `openai/gpt-4o-mini`, key = OpenRouter key.
- Local Ollama: baseUrl `http://localhost:11434/v1`, model e.g. `llama3.1`,
  any non-empty key (Ollama ignores it, schema requires one).
