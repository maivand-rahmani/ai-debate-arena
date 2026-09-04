# Providers

Providers use `@ai-sdk/openai-compatible` and are stored server-side in
`~/.ai-debate-arena/providers.json` (override with
`AI_DEBATE_ARENA_PROVIDER_FILE`). The file is created with restricted permissions;
API keys are never returned by listing or printed by the CLI.

Run `npm run provider:add` and answer the prompts. Existing IDs are replaced.
Use `listProviders()` for safe redacted metadata and `createConfiguredModel()` only
from server code.
