# Changelog

All notable changes to AI Debate Arena. Versions follow the roadmap in `TODO.md`.

## v0.3.0 — The Arena Becomes a Game (2026-09-05)

### Real-time 3D world (replaces the v0.3-first-pass CSS stage)
- The app surface is now a full-viewport WebGL arena built with pinned `@react-three/fiber@9` + `three@0.185` + `@react-three/drei@10` + `@react-three/rapier@2`, loaded behind an SSR-safe `CanvasGate` (dynamic `ssr:false`, WebGL capability probe via `useSyncExternalStore`, error boundary — server output contains zero three/rapier markers; enforced by `ssr-boundary.test.ts`).
- Broadcast set built from procedural primitives (no asset pipeline): wooden stage floor, cyclorama + arena walls, truss, three emissive signage panels (CanvasTexture), two contender desks with monitors/mic stands, central elevated Judge platform with gavel.
- Real physics: static colliders for floor/stage/walls/truss/desks/chairs/platform, fixed character capsules, dynamic gavel + two desk mics with the documented spawn-clearance invariant.

### The world reacts to the match
- `deriveSceneSignal` projects the existing `DebateRuntimeState` into a serializable signal fed to four in-canvas directors: CameraDirector (7 cinematic presets — wide/A/B/rebuttal/judge/verdict/error — blending with OrbitControls handoff and re-acquisition), LightingDirector (per-speaker spotlight states), character poses (contender 10 + judge 6 mood poses via named anchors; winner celebration / loser slump on verdict), and VerdictDirector (gavel strike + confetti burst, StrictMode-safe).
- Reactions: 7 curated meme captions (`deriveReaction`) with banner mute toggle; reduced-motion snaps directors and suppresses confetti. Zero extra AI calls for mood/emotion.
- Setup moved into the world: the idle Arena shows an in-scene BroadcastConsole (same draft/validation flows) instead of the old dashboard hero; the page no longer looks like a website shell around a form.

### Preserved
- Engine, reducer, stream contract, API routes, Quick mode, cancellation/error handling, judge verdict semantics, history drawer/export/rejudge — untouched (gate C diff-verified).
- Non-WebGL fallback: the full 2D broadcast stage + IdleSetup render unchanged when WebGL is absent — no user ever sees a blank canvas.

### Known limitations
- Character visuals are procedural primitive puppets (deliberate: no rigging pipeline yet); polish candidates will be recorded during the F4-26 user review.
- Judge model = first configured provider (selection UI deferred to v0.4 per provider-UI gate).
- `fiber@9` caps React `<19.3`; the 3D stack must bump together.

## v0.2.0 — Trustworthy Debate Lab (2026-09-04)

### Contracts & reproducibility
- Versioned domain contracts (`CONTRACT_VERSION = 1`): `matchConfigSchema`, `transcriptSchema`, `verdictSchemaRef`, `matchRecordSchema` in `src/entities/debate/contract.ts`, validated at the API boundary.
- Every match persists a redacted `MatchRecord` (`~/.ai-debate-arena/matches/<id>.json`): sides (provider name + model id only, never keys), profile, prompt/rubric versions, transcript, verdict, terminal reason, latency + token usage.
- Stream v1 envelope: every event carries `v`, `matchId`, monotonic `seq`; `done` carries `terminal: completed|error|cancelled`.

### Policy & enforcement
- `MATCH_PROFILES` centralize Quick/Standard/Hardcore as data (rounds, output caps, history window, per-side context chars). Quick behavior is unchanged and the only enabled mode.
- Agent history is windowed and char-capped per profile (oldest whole turns dropped first); the judge always sees the full transcript.
- Token usage and per-turn latency captured from the SDK into the match record (missing usage degrades to zeros, never throws).

### Judge & evaluation
- Prompts and rubric are versioned (`AGENT_PROMPT_VERSION`, `JUDGE_PROMPT_VERSION`, `RUBRIC_VERSIONS`); rubric criteria live in one module (`rubric.ts`). Rubric v2 adds band anchors, rebuttal emphasis, and an explicit draw policy — v1 remains the default and is pinned byte-identical by tests.
- Golden transcript fixtures (clear A/B, close match, contradiction, irrelevant, truncated) with a deterministic judge-regression suite pinning 9 normalized-output cases.
- `npm run eval:judge` runs the real configured judge over all fixtures × rubric versions and appends a comparison table (`docs/eval/rubric-v1-vs-v2.md`).

### Trust & inspection UI
- Match history drawer: saved matches with winner badges and re-judged indicators; expand to read the transcript (long turns collapse), the criteria bars ("why this verdict"), and judge reasoning with version labels.
- Export (Markdown + JSON) and re-judge actions for both stored and live matches; re-judge replaces the verdict in place without any debater calls.
- Match import endpoint validates contract version and rejects credential-like fields.

### Known limitations
- Standard and Hardcore remain disabled; enabling them is gated on real-model cost/quality evidence (see `docs/eval/`).
- The OpenCode Go Responses endpoint intermittently returns empty completions for long judge prompts (observed in the rubric v2 eval); the runner retries once and surfaces a clear failure — no verdict is ever fabricated.
- No browser-test dependency (Playwright) was added; E2E coverage is a scripted mock-provider suite (`src/app/api/debate/route.test.ts`) plus manual acceptance.

## v0.1.0 — Local Quick Arena (2026-09-04)

- First local release: Next.js + Feature-Sliced shell, server-only provider store with redacted listings, injectable streaming debate runner (Quick mode), tolerant judge parsing with structured-output support, NDJSON streaming API with cancellation and exactly-once close, dark cinematic arena UI with cancelled/error/retry states, token policy (agents/judge 2000, reasoning effort capped to low on OpenAI-style providers, 180 s match timeout), safe provider-error messages, 100+ unit/contract/e2e tests, clean-install evidence in `docs/development.md`.
- Supported provider assumptions: any OpenAI-compatible `/chat/completions` endpoint or OpenAI-style `/responses` endpoint; verified against OpenAI-compatible local endpoints and OpenCode Go (Responses API, reasoning-heavy models require the raised budgets).
