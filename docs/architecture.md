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
                             match-format.ts (turn metadata/order),
                             streaming.ts (NDJSON event types)
```

| Package | npm name | Responsibility | Deps (ours) | Consumers | Forbidden imports |
| ------- | -------- | -------------- | ----------- | --------- | ----------------- |
| apps/web | `@arena/web` | Routes, UI, server-only provider/match stores, web adapter | engine, ai, types | — (leaf) | engine internals via `@arena/*/src/*` deep paths (barrels only) |
| packages/debate-engine | `@arena/debate-engine` | Format runner, prompts, rubric, verdict, contracts, `runDebate`/`runJudge` | types | web, future `apps/api` + `apps/worker` | react/next/three/`@ai-sdk/*`/`ai`/node:fs/path/os/`server-only`/`@arena/ai` (node:crypto is the only approved builtin) |
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

## 3D presentation boundary

The current visual system and the rules for extending it live in
[`docs/arena-visual-system.md`](arena-visual-system.md). The 3D widget is a
presentation boundary, not a second debate state machine:

- `scene-signal.ts` projects debate state into serializable visual intent;
- camera, lighting, pose, verdict, and prop directors consume that signal;
- `scene-layout.ts` owns shared spatial relationships and physics-clearance
  measurements;
- procedural meshes are the active fallback while local GLBs are unavailable;
- `arena-assets.ts` owns stable asset IDs/URLs/anchors and the client-only
  loader owns future GLB replacement;
- captions, HUD, verdict semantics, cancellation, and the 2D fallback stay
  outside the visual asset layer.

The scene's current art direction is premium stylized broadcast game art:
walnut/cream architecture, terracotta/plum contenders, honey Judge, detailed
player-facing workstations, a framed banner, and a patterned stage floor. Do
not describe or implement it as the old primitive-only blockout.

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
  │  per format turn: webCallModel (provider-db.getProvider → @arena/ai buildAiModel → streamText)
  ▼  AI provider (OpenAI-compatible baseUrl + apiKey, server-only)
Client reducer appends tokens → turns → verdict; abort() cancels fetch.
```

## Judge path

After the selected format's agent turns (six in Quick) the runner emits `judge-start`, calls `generateText`
(default: agent A's provider) with the full transcript + rubric, parses strict
JSON via `parseDebateVerdict`, emits `verdict`, then `done`.

## Boundary rule

**UI knows nothing about providers or the engine.** Client code touches only
tolerant local wire shapes in `shared/api/debate-stream.ts` (`openDebateStream`,
partial-payload guards) plus `shared/api/matches.ts`; canonical types are
re-exported from `@arena/types` where identical. Credentials and
`provider-store`/`provider-db` are `server-only`.

## Next product extension

Quick keeps its fixed six-turn format. Standard is an agent-versus-agent game.
The match orchestrator creates two lightweight, independent agent sessions and
keeps them alive for the full match. Each session owns its selected model,
fixed side and objective, private working context, available skills and tools,
and match-local resources. The sessions share only public match events; neither
agent receives the other's private context.

For each open move, the orchestrator gives the active agent the current public
state. The agent chooses its next action: use a tool, use another tool after
seeing the result, make or challenge a claim, stake resources, speak, or signal
readiness. Tool results return to that same session so it can adapt before
committing its public move. This loop may contain zero or multiple tool actions;
the orchestrator applies rules and costs but never scripts the strategy.

Public actions, tool calls, results, evidence, resource changes, speeches, and
readiness decisions join the existing ordered event stream. The arena,
transcript, separate judge, and later replay therefore observe one coherent
match story without exposing private chain-of-thought. Implement this as the
smallest abstraction needed by Standard, not as a generic agent framework.

Standard ends when both contenders are ready, resources force a finish, or a
decisive challenge creates a knockout; a generous emergency ceiling only
prevents broken infinite matches. Start with `web_search`, `fetch_url`, and
`run_code`. Stakes and challenges are match actions built on the same event
stream after the tool-enabled match is fun. Extreme has no architecture yet.
