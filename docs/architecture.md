# Architecture

Feature-Sliced Design under `src/` (`app` composes routes; `pages` is a stub).
UI and engine meet only at two HTTP boundaries — the UI imports no provider or
engine internals.

| Layer      | Contains                                                              |
| ---------- | --------------------------------------------------------------------- |
| `app`      | Routes: `/` page, `POST /api/debate` (NDJSON), `GET /api/providers`   |
| `entities` | Debate domain: `types`, `state`, `prompt`, `prompts`, `verdict`       |
| `features` | `create-debate` (setup form), `run-debate/{server,lib,ui}`            |
| `widgets`  | `arena-screen` — composes setup form, corners, judge panel            |
| `shared`   | `token-policy`, `config/provider[-store]`, `api/{llm,debate-stream}` |

## Data flow

```
Client (arena-screen → use-debate-stream → debate-stream.ts)
  │  POST /api/debate { topic, mode:"quick", agentA, agentB }   (zod, 400 on invalid)
  ▼
ReadableStream NDJSON  ←  runDebate() generator (features/run-debate/server)
  │  per phase: provider-store.getProvider → createConfiguredModel → streamText
  ▼  AI provider (OpenAI-compatible baseUrl + apiKey, server-only)
Client reducer appends tokens → turns → verdict; abort() cancels fetch.
```

## Judge path

After 4 agent turns the runner emits `judge-start`, calls `generateText`
(default: agent A's provider) with the full transcript + rubric, parses strict
JSON via `parseDebateVerdict`, emits `verdict`, then `done`.

## Boundary rule

**UI knows nothing about providers or the engine.** Client code touches only
`shared/api/debate-stream.ts` types + `openDebateStream`; credentials and
`provider-store`/`model.ts` are `server-only`.

## Extension points (unimplemented)

- **Credits/betting:** attach at `app` layer as a wrapper around `runDebate`
  input/output; domain types stay untouched until then.
- **CHALLENGE/PROOF phases:** add members to `DebatePhase`, extend `NEXT_PHASE`
  in `state.ts`, add instructions in `prompts.ts`, extend `AGENT_PHASES` in the
  runner, then the stream contract and UI reducer (`docs/development.md`).
