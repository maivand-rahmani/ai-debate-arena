# Debate engine (`@arena/debate-engine`)

Framework-free package (`packages/debate-engine/src`): no React/Next,
no AI SDK, no filesystem — `node:crypto` (`randomUUID`) is its only builtin.
The Next app consumes it through the `"."` barrel; golden fixtures go through
`"./testing"`. Future `apps/api` + `apps/worker` will consume the same entry
points without React/Next.

## Phase machine

7 states in `packages/debate-engine/src/state.ts`, strictly linear (`NEXT_PHASE`):

```
CREATED → OPENING_A → OPENING_B → REBUTTAL_A → REBUTTAL_B → JUDGING → FINISHED
```

`transitionPhase` throws on any other edge; `advanceDebate` steps once.
`appendTurn` grows `turns` immutably; `attachVerdict` sets the verdict and
forces `FINISHED`. Sides: `A` speaks in `OPENING_A`/`REBUTTAL_A`, `B` in the
`_B` phases; each side holds a fixed `FOR`/`AGAINST` position.

## Runner loop (`runDebate`, `packages/debate-engine/src/runner.ts`)

Async generator with injectable `deps.callModel` (tests stub it; no network).
Per agent phase: set state → emit `phase` → build system + user prompt →
`streamText` with `policy.agentMaxOutputTokens` → emit `token*` → append turn →
emit `turn`. Then `judge-start` → `generateText` with
`policy.judgeMaxOutputTokens` → `parseDebateVerdict` → `verdict` → `done`.
Model errors emit `error` (via `toSafeErrorMessage`) then `done`; an invalid
judge JSON emits `Judge returned invalid verdict` then `done`.

## Token economy (`packages/debate-engine/src/token-policy.ts`, active: Quick)

| Policy   | agent out | judge out | rounds | maxContextChars | maxHistoryTurns |
| -------- | --------- | --------- | ------ | --------------- | --------------- |
| Quick    | 2000      | 2000      | 4      | 12000           | 6               |
| Standard | 2000      | 2000      | 4      | 24000           | 10              |
| Hardcore | 3000      | 2000      | 4      | 48000           | 16              |

v0.1 keeps the same 4 phases for all tiers; only budgets differ. UI gates
non-Quick modes.

## Prompt strategy

Short by design. System: debater identity + side + FOR/AGAINST stance + topic +
"one focused argument, do not converse, respect token budget, plain text".
User prompt: topic + phase + last-N turns sliced by `maxHistoryTurns`
(`packages/debate-engine/src/prompt.ts`), so context stays bounded as history
grows.

## Runner ports

`runDebate` is an async generator; `runJudge` runs the judge leg standalone.
Both take their side effects as injected ports — the engine never touches the
network or disk:

- `callModel` (required): `(args) => Promise<{ text, chunks }>` — the web
  adapter (`apps/web/src/features/run-debate/server/web-adapter.ts`) implements
  it via provider resolution + `@arena/ai` + the `ai` SDK.
- `saveMatch` (optional): persists the redacted match record; web passes
  `webSaveMatch`, other consumers may omit it.
- Judge contract: structured-output `generateText` first, one deterministic
  temperature-0 plain-text retry, then `Judge returned invalid verdict` —
  a verdict is never fabricated. `toSafeErrorMessage` is duplicated into
  `runner.ts` under a v0.3 freeze contract (keep in sync with `@arena/ai`).

## Stream contract (`POST /api/debate` → `application/x-ndjson`, one object/line)

- `{"type":"phase","phase":"OPENING_A","side":"A"}`
- `{"type":"token","side":"A","text":"…"}`
- `{"type":"turn","turn":{"id":"…","side":"A","phase":"OPENING_A","content":"…","model":"…","createdAt":"…"}}`
- `{"type":"judge-start"}`
- `{"type":"verdict","verdict":{…DebateVerdict…}}`
- `{"type":"error","message":"…"}`
- `{"type":"done"}`

Order guarantee: `phase → token* → turn`, repeated for the 4 agent phases,
then `judge-start → verdict`, then `done`. On failure: `error` then `done`
(`done` is always last). Client disconnect aborts `request.signal`; the route
returns the generator (`events.return()`) so no further provider calls happen.

## Judge rubric + verdict shape (`rubric.ts` + `verdict.ts` in `packages/debate-engine/src`)

Rubric (0–100 each side): argument quality, rebuttal quality, consistency,
relevance. The judge must reply with STRICT JSON only:

```json
{"winner":"A","scoreA":82,"scoreB":74,
 "criteria":{"argumentQualityA":85,"argumentQualityB":75,"rebuttalA":80,"rebuttalB":72,
 "consistencyA":83,"consistencyB":74,"relevanceA":84,"relevanceB":73},
  "reasoning":"…"}
```

Missing/partial `criteria` default from `scoreA`/`scoreB` (see
`packages/debate-engine/src/verdict.ts`); anything else
invalid fails parsing and becomes an `error` event, never a guess.
