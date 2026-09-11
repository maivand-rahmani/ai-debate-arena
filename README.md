# AI Debate Arena

Two AI debaters argue a motion you set in six focused turns — two openings, then four targeted responses — before an AI judge scores both sides and declares a winner.
Runs locally on Next.js; bring any OpenAI-compatible provider (OpenAI, OpenRouter, local Ollama).
npm workspaces monorepo: `@arena/web` (the Next app) + `@arena/debate-engine`, `@arena/ai`, `@arena/types` packages (see `docs/architecture.md`).

## Stack

- Next.js 16 (App Router) + React + TypeScript
- Tailwind CSS · `zod` for runtime validation · `vitest` for tests
- `ai` + `@ai-sdk/openai-compatible` for model calls · `tsx` for the provider CLI

## Install

```bash
npm install
npm run provider:add   # id, display name, base URL, API type, default model, API key
npm run dev            # binds to http://127.0.0.1:3000 (loopback only)
```

`provider:add` writes `~/.ai-debate-arena/providers.json` (override via
`AI_DEBATE_ARENA_PROVIDER_FILE`) with `0600` permissions; the key is never
printed or committed. Add a second provider, or reuse one for both sides.

## First debate

1. Setup screen: enter a motion in the topic field.
2. Per side, pick a provider + model and a FOR/AGAINST position (positions auto-mirror).
3. Keep mode on Quick (Standard/Hardcore are "coming soon") and hit **Start match**. Quick alternates six times, one decisive point at a time.
4. Watch each speech in the broadcast caption, advance at your pace, then let the judge panel evaluate.
5. Verdict: animated score reveal, winner highlight, reasoning, 8-field criteria breakdown.

## Commands

| Command                | What it does                             |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Local dev server (loopback `127.0.0.1`)  |
| `npm start`            | Production server after `build` (loopback `127.0.0.1`) |
| `npm run build`        | Production build                         |
| `npm run lint`         | ESLint over the repo                     |
| `npm run typecheck`    | `tsc --noEmit`                           |
| `npm test`             | `vitest run` across all workspaces (33 files)    |
| `npm run provider:add` | Interactive provider setup (see above)   |

## Where things live

- `apps/web/` — Next.js app (`src/{app,features,widgets,shared}`, `scripts/`)
- `packages/debate-engine/` — match formats, prompts, rubric, verdict, runner
- `packages/ai/` — model factory + safe errors · `packages/types/` — wire types
- `TODO.md` — backlog and MVP definition of done
- `docs/architecture.md` — workspaces, layers, data flow, extension points
- `docs/arena-visual-system.md` — current broadcast-stage visual system, 3D contracts, asset rules, and agent change guide
- `docs/debate-engine.md` — match formats, stream contract, judge rubric
- `docs/providers.md` — provider setup, endpoints, key safety
- `docs/development.md` — checks, tests, adding a match format

## Security

API keys live server-only in the `0600` JSON store; the UI only ever sees redacted `apiKeyHint`s.

**Local-only assumption.** The dev and production startup commands (`npm run
dev`, `npm start`) bind to `127.0.0.1` on purpose. The Next API has **no
authentication, no CSRF protection, and no origin checks**: it trusts whoever
can reach it. That is safe only while the server is reachable solely from your
own machine. Exposing the server on `0.0.0.0` or a LAN address is
**not supported** and must not be attempted until authentication, CSRF, and a
device-pairing flow exist. See `docs/security/v0.4-threat-model.md` for the
full threat model, residual risks, and what is deliberately not implemented
yet (no external source host, no process sandbox; model adjudication is not
truth and local consent is not authentication).

## Why these dependencies

- `ai` — `streamText`/`generateText` with token streaming and `maxOutputTokens`.
- `@ai-sdk/openai-compatible` — one factory for OpenAI, OpenRouter, Ollama, any compatible base URL.
- `zod` — request bodies, provider config, and judge JSON validated at runtime.
- `tailwind` — dark cinematic theme without a component library.
- `vitest` — fast unit tests for runner ordering, verdict parsing, redaction.
- `tsx` — runs the `provider:add` CLI with no build step.

## Current visual foundation

The main surface is a full-viewport broadcast arena. The active 3D runtime is
client-only R3F/Rapier with procedural stylized stand-ins while final GLBs are
being commissioned. It uses walnut/cream studio architecture, terracotta/plum
contender stations, a honey Judge platform, player-facing detailed computers,
aligned framed signage, and a patterned broadcast floor. Read
`docs/arena-visual-system.md` before changing the visual language or 3D layout;
it is the source of truth for future programming-mode workstation work.
