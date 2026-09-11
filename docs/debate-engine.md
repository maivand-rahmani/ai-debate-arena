# Debate engine (`@arena/debate-engine`)

Framework-free package (`packages/debate-engine/src`): no React/Next,
no AI SDK, no filesystem — `node:crypto` (`randomUUID`) is its only builtin.
The Next app consumes it through the `"."` barrel; golden fixtures go through
`"./testing"`. Future `apps/api` + `apps/worker` will consume the same entry
points without React/Next.

## Match formats

`packages/types/src/match-format.ts` owns the speaking order as data. A
`MatchTurnSpec` has a stable `id`, speaking `side`, semantic `role`, display
`order`, and presentation `label`. The runner, reducer, history, captions, and
scene signal resolve that same descriptor instead of hard-coding phase names.

The active Quick format is deliberately short and watchable:

```
1 A opening → 2 B opening → 3 A response → 4 B response → 5 A response → 6 B response → judge
```

`state.ts` still exposes the old linear phase helpers for v0.3 transcripts and
tests. They are compatibility support, not the source of truth for new runs.
`appendTurn` remains immutable and `attachVerdict` still produces a finished
state; each side keeps its fixed `FOR`/`AGAINST` position.

## Runner loop (`runDebate`, `packages/debate-engine/src/runner.ts`)

Async generator with injectable `deps.callModel` (tests stub it; no network).
Per format-owned turn: set state → emit `phase` → build system + user prompt →
`streamText` with `policy.agentMaxOutputTokens` → emit `token*` → append turn →
emit `turn`. Then `judge-start` → `generateText` with
`policy.judgeMaxOutputTokens` → `parseDebateVerdict` → `verdict` → `done`.
Model errors emit `error` (via `toSafeErrorMessage`) then `done`; an invalid
judge JSON emits `Judge returned invalid verdict` then `done`.

## Token economy (`packages/debate-engine/src/token-policy.ts`, active: Quick)

| Policy   | agent out | judge out | rounds | maxContextChars | maxHistoryTurns |
| -------- | --------- | --------- | ------ | --------------- | --------------- |
| Quick    | 3000      | 4000      | 6      | 18000           | 8               |
| Standard | 3500      | 4500      | 4      | 24000           | 10              |
| Hardcore | 5000      | 6000      | 4      | 48000           | 16              |

The active Quick match has a seven-minute lifecycle bound. Standard and
Hardcore remain disabled until each gets its own approved format and quality
evidence.

## Prompt strategy

The active prompt establishes a fixed side and position, asks for persuasion
rather than a generic essay, prohibits invented evidence and opponent
impersonation, and requires a 180–300-word speech. An opening makes one
decisive argument. A response names one opponent claim and gives one focused
counterclaim, rather than recapping the debate. The user prompt includes the
format-owned turn, bounded transcript, and a separate view of the opponent's
arguments. Prompt context is built in
`packages/debate-engine/src/prompts/context.ts` and rendered by the dedicated
agent prompt module.

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

- `{"type":"phase","phase":"quick-a-opening","side":"A"}`
- `{"type":"token","side":"A","text":"…"}`
- `{"type":"turn","turn":{"id":"quick-a-opening","side":"A","phase":"OPENING_A","content":"…","model":"…","createdAt":"…"}}` (legacy `phase` is retained for compatibility; `id` is the stable format-owned turn key)
- `{"type":"judge-start"}`
- `{"type":"verdict","verdict":{…DebateVerdict…}}`
- `{"type":"error","message":"…"}`
- `{"type":"done"}`

Order guarantee: `phase → token* → turn`, repeated for every turn in the
selected format (six for Quick),
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
