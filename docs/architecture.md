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
| apps/web | `@arena/web` | Routes, UI, server-only provider/match stores, web adapter, Standard session adapter | engine, ai, types | — (leaf) | engine internals via `@arena/*/src/*` deep paths (barrels only) |
| packages/debate-engine | `@arena/debate-engine` | Quick format runner, Standard agent lifecycle + session/tool ports, prompts, rubric, verdict, contracts, `runDebate`/`runJudge` | types | web, future `apps/api` + `apps/worker` | react/next/three/`@ai-sdk/*`/`ai`/`server-only`/`@arena/ai`. Core orchestration uses `node:crypto` only; the Standard `run_code` executor in `standard.ts` additionally uses portable Node runtime builtins (`node:child_process`, `node:fs/promises`, `node:os`, `node:path`) |
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
  react/next/three/ai-sdk/`server-only`/`@arena/ai` inside
  `debate-engine`/`types`. `node:crypto` is the only approved builtin for the
  runner/domain core. The Standard tool registry (`standard.ts`) deliberately
  reaches the local Node runtime for `run_code`; that executor is the one
  approved exception and stays behind the injected tool port.
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

All of the following runs on the local Next.js/Node server; the browser only
sends the request and reads the NDJSON stream back.

```
Client (arena-screen → use-debate-stream → debate-stream.ts)
  │  POST /api/debate { topic, mode:"quick"|"standard", agentA, agentB }  (zod, 400 on invalid)
  ▼
ReadableStream NDJSON  ←  runDebate() generator (@arena/debate-engine/runner)
  │
  ├─ Quick: per format turn → webCallModel (streamText)
  │
  └─ Standard: opening + paired ready/depletion lifecycle
       per side: createStandardAgentSession (match-long private session)
         move: observe public state → AI SDK ToolLoopAgent → createWebModel
               → native tool calls → webRunStandardTool (web_search/fetch_url/run_code)
               → consume results → speak (one public move)
       runner emits tool-start/tool-result/standard-state + turn events
  │
  ▼  judge leg (both modes) → webCallModel → generateText → parseDebateVerdict
  ▼  model calls resolve through provider-store.getProvider → @arena/ai buildAiModel
     → AI provider (OpenAI-compatible baseUrl + apiKey, server-only)
  ▼  verdict; webSaveMatch persists the redacted MatchRecord
Client reducer appends tokens → turns → verdict; abort() cancels fetch.
```

Standard agent model calls therefore go `createStandardAgentSession` → AI SDK
`ToolLoopAgent` → `createWebModel`; `webCallModel` owns Quick's per-turn model
calls and the judge leg for both modes.

## Deployment shapes

There is one Next.js web product with two runtime shapes, not separate web and
desktop applications.

```text
Public website
  browser → hosted Next.js server → Quick match
  Standard / Extreme selection → preview + GitHub/local-run call to action

Local full product
  browser on localhost → local Next.js/Node.js server
                       → Standard agents and match orchestrator
                       → local tools, local runtimes, internet tools, providers
```

The browser renderer remains a normal web client. It asks server routes to run
agent actions; the Node.js server process running on the user's computer owns
filesystem, process, repository, runtime, and other local integrations. Results
return through the same ordered stream used by the match UI.

The shared engine, agent workflow, event protocol, UI, and tool contracts must
remain portable across Windows and macOS. Most implementations should use
cross-platform Node.js APIs directly. Add a thin platform helper only when an
actual difference exists in paths, executable discovery, or process behavior.
Do not add Electron, Tauri, or another native desktop wrapper.

## Judge path

After the match's agent moves — six fixed turns in Quick, or the Standard
lifecycle's variable number of moves — the runner emits `judge-start`, calls
`generateText` (default: agent A's provider) with the full transcript, rubric,
and public Standard tool events, parses strict JSON via `parseDebateVerdict`,
emits `verdict`, then `done`.

## Boundary rule

**UI knows nothing about providers or the engine.** Client code touches only
tolerant local wire shapes in `shared/api/debate-stream.ts` (`openDebateStream`,
partial-payload guards) plus `shared/api/matches.ts`; canonical types are
re-exported from `@arena/types` where identical. Credentials and
`provider-store`/`provider-db` are `server-only`.

## Standard agent runtime (shipped)

Quick keeps its fixed six-turn format and is the public website's playable
first look. Standard is the agent-versus-agent game run through the local web
server and browser UI. The match orchestrator creates two independent,
match-long agent sessions and keeps them alive for the whole match. Each session
owns its selected model, fixed side and objective, private working context,
tool loadout, and match-local resources. The sessions share only public match
events; neither receives the other's private context.

**Lifecycle.** Both sides always receive an opening move. The runner then plays
paired open rounds. A side signals `ready` on a move; when both are ready the
match ends, and when only one is ready one paired answer round runs so neither
loses the right to reply. A side that can no longer afford a speech is forced to
close, and a generous move ceiling only prevents broken matches. The resolved
ceiling is `profile.rounds` (never below the two mandatory openings).

**Per-move loop.** The runner hands the active session the current public state
and its remaining resources. The session decides its own order: it may run zero
or more tools through the injected `runTool` port, consume each result back into
the same conversation, adapt, and then deliver one public move through its
internal `speak` call. Tool choice, sequencing, and strategy belong to the
agent; the runner applies costs, capture order, and ending rules.

**Sessions and tools.** `createWebStandardAgentSession`
(`apps/web/.../server/standard-agent-adapter.ts`) is the local-server binding:
one match-long AI SDK session per side with a bounded rolling private
conversation, native tools, and the `speak` delivery tool. `webRunStandardTool`
(`web-adapter.ts`) dispatches `web_search`, `fetch_url`, and `run_code` to the
engine registry; the browser never executes a tool. Private chain-of-thought is
never streamed or persisted.

**Stream events.** Standard adds three public event types to the ordered v1
stream: `tool-start` and `tool-result` (stable call identity, side, bounded
output/error, and a `rejected` flag for refused over-budget attempts) and
`standard-state` (authoritative per-side credits, executed vs refused tool
counts, accumulated `ready` intent, and move/ceiling status). Turn ordering is
`phase → tool-start/tool-result* → token* → turn → standard-state`, then
`judge-start → verdict → done`. The runner publishes tool results in invocation
order even when they complete in parallel.

**Current limits** (`MATCH_PROFILES.standard` + Standard defaults): starting
credits 12, speech cost 1, tool cost 2, up to 2 tools per move, 8 s per-tool
timeout, an emergency ceiling of 12 moves, and a 24,000-character per-side
private context budget. Stakes, live challenges, and knockouts are later
Standard gameplay built on this same stream; Extreme may later extend the local
web-server model with container-backed execution, but it has no detailed
architecture until Standard is complete.
