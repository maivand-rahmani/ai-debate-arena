# Debate engine (`@arena/debate-engine`)

Framework-free package (`packages/debate-engine/src`): no React/Next and no AI
SDK. The runner, prompts, rubric, verdict, and contracts use only `node:crypto`
(`randomUUID`) as a builtin. The Standard tool registry (`standard.ts`) is the
one deliberate exception: its `run_code` executor uses portable Node runtime
builtins (`node:child_process`, `node:fs/promises`, `node:os`, `node:path`) to
run JavaScript/Python in a temp file. That executor stays behind the injected
tool port; the runner core never touches the filesystem. The Next app consumes
the package through the `"."` barrel; golden fixtures go through `"./testing"`.
Future `apps/api` + `apps/worker` will consume the same entry points without
React/Next.

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

### Standard agent format (shipped)

Standard is not a longer fixed turn list. The runner hosts two independent,
match-long agent sessions: one for A and one for B. Each retains its model,
side, objective, private working context, tool loadout, and current match
resources between moves. The engine stays platform-neutral; the locally running
Next.js/Node.js server supplies the actual local and internet tool
implementations through injected ports (`runTool` + `createStandardAgentSession`).

Lifecycle: both sides always open (the ceiling can never be lower than two
moves), then paired open rounds run. When both sides signal `ready` the match
ends; when only one is ready, one paired closing round follows. A side that
cannot afford a speech is forced to close, and a generous move ceiling only
prevents broken matches. The resolved ceiling is `profile.rounds`.

Per move, an agent observes the public match state and chooses its own next
action. It may execute zero or more tools, receive each result into the same
session, adapt, and then make a public argument (`speak`). The runner validates
and records actions, charges resources, alternates control, and evaluates ending
rules; it does not preselect the agent's tools or strategy. Only public actions
and results enter the shared transcript and event stream. The judge remains a
separate role over that public record.

## Runner loop (`runDebate`, `packages/debate-engine/src/runner.ts`)

Async generator with injectable `deps.callModel` / `deps.runTool` /
`deps.createStandardAgentSession` (tests stub them; no network).

- **Quick**: per format-owned turn: set state → emit `phase` → build system +
  user prompt → `streamText` with `policy.agentMaxOutputTokens` → emit `token*`
  → append turn → emit `turn`.
- **Standard**: run the opening + paired-round lifecycle. Each move emits
  `phase`, then any `tool-start`/`tool-result`, then `token*`, `turn`, and a
  `standard-state` snapshot. Tool results are published in stable invocation
  order even when they complete in parallel, and live progress must agree with
  the session's final tool list.

Both modes end with `judge-start` → `generateText` with
`policy.judgeMaxOutputTokens` → `parseDebateVerdict` → `verdict` → `done`.
Model errors emit `error` (via `toSafeErrorMessage`) then `done`; an invalid
judge JSON emits `Judge returned invalid verdict` then `done`.

## Token economy (`packages/debate-engine/src/token-policy.ts`, active: Quick)

| Policy   | agent out | judge out | rounds | maxContextChars | maxHistoryTurns |
| -------- | --------- | --------- | ------ | --------------- | --------------- |
| Quick    | 3000      | 4000      | 6      | 18000           | 8               |
| Standard | 3500      | 4500      | 12     | 24000           | 10              |
| Hardcore | 5000      | 6000      | 4      | 48000           | 16              |

Quick and Standard are enabled; Hardcore stays a disabled placeholder. For
Quick, `rounds` is the fixed six-turn count. For Standard it is the emergency
move ceiling (never below the two mandatory openings); the normal clock is the
resource/ready lifecycle. A match stream is bounded by a seven-minute lifecycle
timeout. Standard resources: each side starts with 12 credits, a speech costs 1,
a tool call costs 2, up to 2 tools may be folded into a move, each tool is bound
to 8 s, and the private per-side context is capped at `maxContextChars`.
Hardcore and Extreme remain undefined beyond their product promise.

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
Both take their side effects as injected ports — the runner core never reaches
the network or disk:

- `callModel` (required): `(args) => Promise<{ text, chunks }>` — the web
  adapter (`apps/web/src/features/run-debate/server/web-adapter.ts`) implements
  it via provider resolution + `@arena/ai` + the `ai` SDK.
- `saveMatch` (optional): persists the redacted match record; web passes
  `webSaveMatch`, other consumers may omit it.
- `runTool` (Standard): `(tool, input, signal) => Promise<StandardToolResult>` —
  executes one registered tool. Web binds it to the engine's `STANDARD_TOOLS`
  registry; Quick ignores it.
- `createStandardAgentSession` (Standard): `(input) => StandardAgentSession` —
  the host creates one match-long private session per side. Web binds it to the
  AI SDK adapter; Quick ignores it. Private context is never streamed or saved.
- Judge contract: structured-output `generateText` first, one deterministic
  temperature-0 plain-text retry, then `Judge returned invalid verdict` —
  a verdict is never fabricated. `toSafeErrorMessage` is duplicated into
  `runner.ts` under a v0.3 freeze contract (keep in sync with `@arena/ai`).

## Stream contract (`POST /api/debate` → `application/x-ndjson`, one object/line)

Every event carries `{ v: 1, matchId, seq }` with a strictly increasing `seq`.

- `{"type":"phase","phase":"quick-a-opening","side":"A"}`
- `{"type":"token","side":"A","text":"…"}`
- `{"type":"turn","turn":{"id":"quick-a-opening","side":"A","phase":"OPENING_A","content":"…","model":"…","createdAt":"…"}}` (legacy `phase` is retained for compatibility; `id` is the stable format-owned turn key)
- `{"type":"tool-start","tool":{…callId, side, tool, query, createdAt}}` (Standard)
- `{"type":"tool-result","result":{…callId, side, tool, query, ok, output, error?, rejected?, createdAt}}` (Standard; `rejected` marks a refused over-budget attempt)
- `{"type":"standard-state","state":{…credits, toolsUsed, toolsRejected, ready, movesUsed, moveLimitReached, closingRound}}` (Standard)
- `{"type":"judge-start"}`
- `{"type":"verdict","verdict":{…DebateVerdict…}}`
- `{"type":"error","message":"…"}`
- `{"type":"done"}`

Order guarantee:
- Quick: `phase → token* → turn`, repeated for the format's turns (six).
- Standard: per move `phase → (tool-start → tool-result)* → token* → turn →
  standard-state`, driven by the opening + paired-round lifecycle.
- Both then emit `judge-start → verdict → done`. On failure: `error` then
  `done` (`done` is always last). Client disconnect aborts `request.signal`; the
  route returns the generator (`events.return()`) so no further provider calls
  happen.

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
