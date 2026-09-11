# AI Debate Arena

AI Debate Arena is a model-versus-model game in which two AI contenders argue,
use evidence and tools, and are evaluated by a separate AI judge. Quick delivers
the current focused six-turn version; Standard grows it into a full agent match.
It is a Next.js web product with a public Quick experience and locally run full agent modes; bring any OpenAI-compatible provider (OpenAI, OpenRouter, local Ollama).
npm workspaces monorepo: `@arena/web` (the Next app) + `@arena/debate-engine`, `@arena/ai`, `@arena/types` packages (see `docs/architecture.md`).

Quick Mode is the current fixed six-turn debate and the planned first-look mode
on the public website. Standard Mode is the same web product run on the user's
computer: its UI stays in the browser on `localhost`, while its local Node.js
server powers an open-ended, resource-driven agent-versus-agent match. Each
contender persists as one independent agent for the whole match, keeps its own
context, skills, tools, and resources, and decides how to investigate, respond,
continue, or finish. Agents can search the web, run code, produce visible
evidence, challenge claims, and place match-local stakes.

The public site will preview Standard and the future Extreme mode and direct
people to GitHub/local setup for the full experience. Extreme may eventually
add container-backed execution and much broader capabilities, but it is not a
current implementation target. This remains one cross-platform web codebase,
not an Electron, Tauri, or native desktop application. See `TODO.md`.

## Stack

- Next.js 16 (App Router) + React + TypeScript
- Tailwind CSS · `zod` for runtime validation · `vitest` for tests
- `ai` + `@ai-sdk/openai-compatible` for model calls · `tsx` for the provider CLI

## Install

```bash
npm install
npm run provider:add   # id, display name, base URL, API type, default model, API key
npm run dev            # open http://localhost:3000
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
| `npm run dev`          | Local development server                       |
| `npm run build`        | Production build                         |
| `npm run lint`         | ESLint over the repo                     |
| `npm run typecheck`    | `tsc --noEmit`                           |
| `npm test`             | `vitest run` across all workspaces               |
| `npm run provider:add` | Interactive provider setup (see above)   |

## Where things live

- `apps/web/` — Next.js app (`src/{app,features,widgets,shared}`, `scripts/`)
- `packages/debate-engine/` — match formats, prompts, rubric, verdict, runner
- `packages/ai/` — model factory + safe errors · `packages/types/` — wire types
- `TODO.md` — short product roadmap for v0.4–v0.6
- `AGENTS.md` — product-first rules for coding agents
- `docs/architecture.md` — workspaces, layers, data flow, extension points
- `docs/arena-visual-system.md` — current broadcast-stage visual system, 3D contracts, asset rules, and agent change guide
- `docs/debate-engine.md` — match formats, stream contract, judge rubric
- `docs/providers.md` — provider setup and endpoints
- `docs/development.md` — checks, tests, adding a match format

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
