# Architecture

npm workspaces monorepo (`apps/*`, `packages/*`). The debate domain lives in
framework-free packages; the Next.js app in `apps/web` is one consumer.

```
ai-debate-arena/
  apps/web/                  @arena/web — Next 16 app (FSD, see below)
    src/{app,features,widgets,shared}/
    scripts/                 judge-eval.mjs, provider-add.ts
  packages/debate-engine/    @arena/debate-engine — domain + runner (no React/Next)
    src/                     domain types/state, prompts, rubric, verdict,
                             contract, token-policy, runner, index
    tests/                   engine suite (incl. runner + judge regression)
  packages/ai/               @arena/ai — buildAiModel factory + safe errors
    src/                     build-ai-model.ts, errors.ts, index.ts
  packages/types/            @arena/types — canonical wire types
    src/                     wire.ts (DebateSide, MatchMode),
                             streaming.ts (NDJSON event types)
  infrastructure/docker/     reserved for the v0.5 worker/sandbox images
```

| Package | npm name | Responsibility | Deps (ours) | Consumers | Forbidden imports |
| ------- | -------- | -------------- | ----------- | --------- | ----------------- |
| apps/web | `@arena/web` | Routes, UI, server-only provider/match stores, web adapter | engine, ai, types | — (leaf) | engine internals via `@arena/*/src/*` deep paths (barrels only) |
| packages/debate-engine | `@arena/debate-engine` | Phase machine, prompts, rubric, verdict, contracts, `runDebate`/`runJudge` | types | web, future `apps/api` + `apps/worker` | react/next/three/`@ai-sdk/*`/`ai`/node:fs/path/os/`server-only`/`@arena/ai` (node:crypto is the only approved builtin) |
| packages/ai | `@arena/ai` | `buildAiModel` (chat vs responses branching) + `toSafeErrorMessage` | none | web, future `apps/api` + `apps/worker` | fs/secrets — provider resolution stays in web |
| packages/types | `@arena/types` | Canonical NDJSON event types (`v:1`/`matchId`/`seq`), `DebateSide`, `MatchMode` | none | engine, ai (via engine), web | everything (leaf, types only) |

Dependency graph (one direction, no cycles):

```
apps/web ──→ @arena/debate-engine ──→ @arena/types
    │              (./testing fixtures for eval/route tests)
    └──────→ @arena/ai        (no deps of ours)
```

There is no `@arena/config`: server secrets stay in `apps/web`
(`shared/config/*`, `AI_DEBATE_ARENA_PROVIDER_FILE` /
`AI_DEBATE_ARENA_MATCH_DIR ?? homedir()`).

Enforcement:

- `exports` maps expose `"."` only (`debate-engine` adds `"./testing"`
  for golden fixtures) — deep `@arena/*/src/*` imports fail lint.
- `eslint.config.mjs` bans deep imports repo-wide and bans
  react/next/three/ai-sdk/fs/path/os/`server-only`/`@arena/ai` inside
  `debate-engine`/`types`.
- `ssr-boundary.test.ts` keeps three/rapier markers out of server output;
  Three.js/R3F/Rapier stay confined to `widgets/broadcast-stage/3d/`.

## Feature-Sliced Design (apps/web-internal)

FSD now describes `apps/web/src` only (`app` composes routes; `pages` is a
stub). The `entities` layer is retired — the debate domain moved to
`@arena/debate-engine`. UI and engine meet only at two HTTP boundaries —
the UI imports no provider or engine internals.

| Layer      | Contains                                                              |
| ---------- | --------------------------------------------------------------------- |
| `app`      | Routes: `/` page, `POST /api/debate` (NDJSON), `GET /api/providers`   |
| `features` | `create-debate` (setup form), `run-debate/{server,lib,ui}`            |
| `widgets`  | `arena-screen` — composes setup form, corners, judge panel            |
| `shared`   | `config/{provider,provider-db,provider-store,match-store}`, `api/{debate-stream,matches,providers}` |

Pre-existing deviation (kept, not fixed): `widgets → features`
type-only imports remain; new cross-layer imports should follow FSD
(app → features/widgets → shared).

## Data flow

```
Client (arena-screen → use-debate-stream → debate-stream.ts)
  │  POST /api/debate { topic, mode:"quick", agentA, agentB }   (zod, 400 on invalid)
  ▼
ReadableStream NDJSON  ←  runDebate() generator (@arena/debate-engine/runner)
  │  per phase: webCallModel (provider-db.getProvider → @arena/ai buildAiModel → streamText)
  ▼  AI provider (OpenAI-compatible baseUrl + apiKey, server-only)
Client reducer appends tokens → turns → verdict; abort() cancels fetch.
```

## Judge path

After 4 agent turns the runner emits `judge-start`, calls `generateText`
(default: agent A's provider) with the full transcript + rubric, parses strict
JSON via `parseDebateVerdict`, emits `verdict`, then `done`.

## Boundary rule

**UI knows nothing about providers or the engine.** Client code touches only
tolerant local wire shapes in `shared/api/debate-stream.ts` (`openDebateStream`,
partial-payload guards) plus `shared/api/matches.ts`; canonical types are
re-exported from `@arena/types` where identical. Credentials and
`provider-store`/`provider-db` are `server-only`.

## Extension points (unimplemented)

- **Credits/betting:** attach at `app` layer as a wrapper around `runDebate`
  input/output; domain types stay untouched until then.
- **CHALLENGE/PROOF phases:** add members to `DebatePhase`, extend `NEXT_PHASE`
  in `packages/debate-engine/src/state.ts`, add instructions in `prompts.ts`,
  extend `AGENT_PHASES` in the runner, then the stream contract and UI reducer (`docs/development.md`).
- **apps/api + apps/worker:** consume `@arena/debate-engine` + `@arena/ai`
  directly (no React/Next); DB-backed storage and docker sandbox deferred to
  v0.4/v0.5.
