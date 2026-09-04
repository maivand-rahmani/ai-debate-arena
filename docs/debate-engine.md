# Debate engine

## Phase machine

7 states in `entities/debate/state.ts`, strictly linear (`NEXT_PHASE`):

```
CREATED → OPENING_A → OPENING_B → REBUTTAL_A → REBUTTAL_B → JUDGING → FINISHED
```

`transitionPhase` throws on any other edge; `advanceDebate` steps once.
`appendTurn` grows `turns` immutably; `attachVerdict` sets the verdict and
forces `FINISHED`. Sides: `A` speaks in `OPENING_A`/`REBUTTAL_A`, `B` in the
`_B` phases; each side holds a fixed `FOR`/`AGAINST` position.

## Runner loop (`runDebate`, `features/run-debate/server`)

Async generator with injectable `deps.callModel` (tests stub it; no network).
Per agent phase: set state → emit `phase` → build system + user prompt →
`streamText` with `policy.agentMaxOutputTokens` → emit `token*` → append turn →
emit `turn`. Then `judge-start` → `generateText` with
`policy.judgeMaxOutputTokens` → `parseDebateVerdict` → `verdict` → `done`.
Model errors emit `error` (via `toSafeErrorMessage`) then `done`; an invalid
judge JSON emits `Judge returned invalid verdict` then `done`.

## Token economy (`shared/token-policy.ts`, active: Quick)

| Policy   | agent out | judge out | rounds | maxContextChars | maxHistoryTurns |
| -------- | --------- | --------- | ------ | --------------- | --------------- |
| Quick    | 1200      | 1000      | 4      | 12000           | 6               |
| Standard | 2000      | 1500      | 4      | 24000           | 10              |
| Hardcore | 3000      | 2000      | 4      | 48000           | 16              |

v0.1 keeps the same 4 phases for all tiers; only budgets differ. UI gates
non-Quick modes.

## Prompt strategy

Short by design. System: debater identity + side + FOR/AGAINST stance + topic +
"one focused argument, do not converse, respect token budget, plain text".
User prompt: topic + phase + last-N turns sliced by `maxHistoryTurns`
(`prompt.ts`), so context stays bounded as history grows.

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

## Judge rubric + verdict shape

Rubric (0–100 each side): argument quality, rebuttal quality, consistency,
relevance. The judge must reply with STRICT JSON only:

```json
{"winner":"A","scoreA":82,"scoreB":74,
 "criteria":{"argumentQualityA":85,"argumentQualityB":75,"rebuttalA":80,"rebuttalB":72,
 "consistencyA":83,"consistencyB":74,"relevanceA":84,"relevanceB":73},
 "reasoning":"…"}
```

Missing/partial `criteria` default from `scoreA`/`scoreB`; anything else
invalid fails parsing and becomes an `error` event, never a guess.
