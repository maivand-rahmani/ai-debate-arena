# AI Debate Arena — TODO / Backlog

Priorities: **[P0]** blocker for MVP · **[P1]** important · **[P2]** nice to have · **[P3]** future

Definition of done for MVP: clone → install → `npm run provider:add` → `npm run dev` → create debate in UI → watch streamed match → see structured judge verdict.

---

## PHASE 0 — Project Foundation

- [x] [P0] Next.js + TypeScript + Tailwind app shell (`src/app`)
- [x] [P0] Feature-sliced directory structure (`entities/features/widgets/shared/pages`)
- [x] [P0] Tooling: `dev`, `build`, `lint`, `typecheck`, `test` commands
- [x] [P0] Domain types: debate phases, agents, turns, config, state (`entities/debate/types.ts`)
- [x] [P0] Phase state machine CREATED→…→FINISHED with transition tests (`entities/debate/state.ts`)
- [x] [P0] Token policy module with central constants 1200/1000 (`shared/token-policy.ts`)
- [x] [P0] `.gitignore`, local config dir, docs stubs

## PHASE 1 — Provider System

- [x] [P0] Provider config schema + validation + API-key redaction (`shared/config/provider.ts`)
- [x] [P0] Server-only file store, 0600 perms (`shared/config/provider-store.ts`)
- [x] [P0] `npm run provider:add` interactive CLI (`scripts/provider-add.ts`)
- [x] [P0] OpenAI-compatible model factory (`shared/api/llm/model.ts`)
- [x] [P0] `GET /api/providers` — redacted provider list for UI
- [ ] [P1] Model factory: error wrapping (auth / unreachable / timeout) with safe messages
- [ ] [P2] Provider management in UI (add/edit without CLI)

## PHASE 2 — Debate Engine

- [x] [P0] Prompt context builder with history slicing (`entities/debate/prompt.ts`)
- [x] [P0] Agent system prompts: debate identity, position, phase instruction (`entities/debate/prompts.ts`)
- [x] [P0] State helpers: `appendTurn`, `attachVerdict`
- [x] [P0] Debate runner: streaming match loop with injectable model dep (`features/run-debate/server/debate-runner.ts`)
- [x] [P0] Round/turn cap + output-token enforcement from token policy
- [ ] [P1] Extend token policy: rounds count, max context chars, history turns per policy; differentiate Quick/Standard/Hardcore (UI still gates non-Quick)
- [ ] [P1] Server-side abort cleanup when client disconnects mid-match
- [ ] [P3] Extension hooks for CHALLENGE / PROOF / SANDBOX / EVIDENCE phases

## PHASE 3 — Judge

- [x] [P0] Basic verdict schema + tolerant JSON parsing (`entities/debate/verdict.ts`)
- [x] [P0] `DebateVerdict` criteria breakdown (argumentQuality/rebuttal/consistency/relevance × A/B)
- [x] [P0] Judge prompt: rubric over full transcript, strict JSON output
- [x] [P1] Verdict parse leniency: missing/partial criteria → defaults from scores; invalid → error event

## PHASE 4 — Arena UI

- [x] [P1] Dark cinematic theme, fonts, extended palette (`globals.css`, `tailwind.config.ts`)
- [x] [P0] Match creation flow: topic, provider+model pickers, FOR/AGAINST auto-mirror
- [x] [P0] Mode selector: Quick enabled, Standard/Hardcore "Coming Soon"
- [x] [P0] Arena screen: A vs B corners, round dots, live speech panels (not a chat list)
- [x] [P0] Judge panel: evaluating state → reasoning → animated score reveal → winner highlight
- [x] [P1] Animations: panel entrance, streaming caret, verdict reveal; prefers-reduced-motion respected
- [x] [P2] Tablet/mobile stacking (desktop-first)

## PHASE 5 — Streaming

- [x] [P0] `POST /api/debate` — NDJSON events: `phase | token | turn | judge-start | verdict | error | done`
- [x] [P0] Client stream reader + reducer (`shared/api/debate-stream.ts`, `features/run-debate/lib`)
- [x] [P1] Client-side abort on unmount / "End match"

## PHASE 6 — Integration

- [x] [P0] Arena wired to real `/api/debate` + `/api/providers` (mock timers removed)
- [x] [P0] Error states: no providers → CLI guide; provider failure → readable banner
- [x] [P1] Loading skeletons during provider fetch / first-token latency

## PHASE 7 — QA

- [x] [P0] Unit: runner event ordering (fake model), verdict parsing, state helpers, provider redaction
- [x] [P0] `typecheck` + `lint` + `test` (12 tests) + `build` green; dev-server smoke: page 200, providers 200, invalid body 400
- [ ] [P1] Happy-path manual run against a real/local provider (needs user API key) — record results
- [ ] [P2] Smoke e2e (playwright) — optional for MVP

## PHASE 8 — MVP Release

- [ ] [P0] README: real quick-start (provider add → first debate), dependency justifications
- [ ] [P0] docs/: architecture, debate-engine (incl. stream protocol), providers (API endpoints), development
- [ ] [P1] git init + initial commit + `v0.1.0` tag
- [ ] [P3] v0.2+: better prompts/judge, challenges · v0.3: sandbox/proof · v0.4: credits/betting (domain model stays extensible — no mechanics now) · v0.5: tournaments/replay

