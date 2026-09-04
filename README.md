# AI Debate Arena

Two AI debaters argue a motion you set — opening statements, rebuttals, then an AI judge scores both sides and declares a winner.
Runs locally on Next.js; bring any OpenAI-compatible provider (OpenAI, OpenRouter, local Ollama).

## Stack

- Next.js 16 (App Router) + React + TypeScript
- Tailwind CSS · `zod` for runtime validation · `vitest` for tests
- `ai` + `@ai-sdk/openai-compatible` for model calls · `tsx` for the provider CLI

## Install

```bash
npm install
npm run provider:add   # id, display name, base URL, default model, API key
npm run dev            # open http://localhost:3000
```

`provider:add` writes `~/.ai-debate-arena/providers.json` (override via
`AI_DEBATE_ARENA_PROVIDER_FILE`) with `0600` permissions; the key is never
printed or committed. Add a second provider, or reuse one for both sides.

## First debate

1. Setup screen: enter a motion in the topic field.
2. Per side, pick a provider + model and a FOR/AGAINST position (positions auto-mirror).
3. Keep mode on Quick (Standard/Hardcore are "coming soon") and hit **Start match**.
4. Watch tokens stream into each corner's speech panel, then the judge panel evaluates.
5. Verdict: animated score reveal, winner highlight, reasoning, 8-field criteria breakdown.

## Commands

| Command                | What it does                             |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Local dev server                         |
| `npm run build`        | Production build                         |
| `npm run lint`         | ESLint over the repo                     |
| `npm run typecheck`    | `tsc --noEmit`                           |
| `npm test`             | `vitest run` (18 tests)                  |
| `npm run provider:add` | Interactive provider setup (see above)   |

## Where things live

- `TODO.md` — backlog and MVP definition of done
- `docs/architecture.md` — layers, data flow, extension points
- `docs/debate-engine.md` — phase machine, stream contract, judge rubric
- `docs/providers.md` — provider setup, endpoints, key safety
- `docs/development.md` — checks, tests, adding a phase

## Security

API keys live server-only in the `0600` JSON store; the UI only ever sees redacted `apiKeyHint`s.

## Why these dependencies

- `ai` — `streamText`/`generateText` with token streaming and `maxOutputTokens`.
- `@ai-sdk/openai-compatible` — one factory for OpenAI, OpenRouter, Ollama, any compatible base URL.
- `zod` — request bodies, provider config, and judge JSON validated at runtime.
- `tailwind` — dark cinematic theme without a component library.
- `vitest` — fast unit tests for runner ordering, verdict parsing, redaction.
- `tsx` — runs the `provider:add` CLI with no build step.
