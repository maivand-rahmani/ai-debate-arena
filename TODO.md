# AI Debate Arena — Master TODO / Roadmap

> The single working backlog for AI Debate Arena from v0.1 through v0.6.
>
> Status snapshot: 2026-09-04  
> Baseline: the original PHASE 0–8 backlog and the current project context.

This file is written for both the product owner and an autonomous coding agent. It is intentionally ordered: close v0.1 before starting v0.2, and do not pull a future feature into an earlier release merely because it is interesting.

## How to use this file

1. Read the current version, its phase dependencies, and the relevant release gate.
2. Select the highest-priority unchecked task that is not blocked.
3. Implement the smallest complete slice.
4. Run the applicable tests, typecheck, lint, build, and manual check.
5. Mark the task complete only after there is evidence in code, tests, or a documented manual verification.
6. Keep completed tasks. If a decision changes, add a note or a replacement task; never erase history.
7. Before starting a later version, pass the previous version's release gate.

### Status and priority legend

- [x] Completed in the inherited baseline. Re-verify at the release gate if the task has not been checked against the current tree.
- [ ] Not complete.
- [P0] Blocker or required for the current release.
- [P1] Important for a credible release, but may follow the first working slice.
- [P2] Useful improvement that must not block the release.
- [P3] Future or deliberately deferred work.

Task IDs are stable references for commits, agent handoffs, and release notes. Dependencies use those IDs.

## Current status

The inherited baseline says that the core local arena is already assembled:

- Feature-Sliced frontend structure exists.
- The domain debate engine and state machine exist.
- OpenAI-compatible providers, local CLI configuration, and server-side secret storage exist.
- Streaming, the arena UI, the judge, token policy, tests, documentation stubs, and frontend/backend integration exist.

The v0.1 MVP is not considered released until the open closure tasks in PHASE 1, PHASE 2, PHASE 6, PHASE 7, and PHASE 8 are complete. The most important known closure items are safe model-factory errors, disconnect cleanup, a provider-backed or faithful integration happy path, smoke coverage, and the final release checklist.

## Product Vision

AI Debate Arena is a local-first arena where two configurable AI agents argue a topic, respond to one another under bounded rules, and receive a structured evaluation from a separate judge agent.

The product should make an AI debate:

- observable in real time rather than a blank waiting screen;
- understandable, with visible positions, rounds, criteria, and reasoning;
- reproducible, with the exact configuration and transcript preserved;
- extensible, so challenges, evidence, sandbox checks, tournaments, and replays can be added without rewriting the core engine;
- private and provider-neutral, with the user's computer acting as the application server and support for OpenAI-compatible endpoints.

The product is not just a chat screen. The central product object is a bounded, inspectable match:

Topic + rules + two agent configurations → ordered debate events → transcript → structured verdict → optional evidence, credits, replay, or tournament records.

## Version Strategy

| Version | Product promise | Primary architectural focus | Release must not ship without |
|---|---|---|---|
| v0.1 | A complete local Quick debate can run from setup to verdict. | Stable foundation, provider boundary, state machine, streaming, arena UI. | A clean local install, safe provider configuration, streamed match, structured judge result, and tested failure paths. |
| v0.2 | A user can trust, inspect, compare, export, and re-judge a debate. | Versioned contracts, prompt/rubric quality, evaluation fixtures, budgets, reliability, explainability. | Regression evidence that judge and engine changes do not silently degrade match quality or cost. |
| v0.3 | The Arena becomes a memorable broadcast-style 3D/2.5D experience. | Arena scene, characters, desks, judge, lighting, emotion, camera choreography, and readable overlays. | The user approves the visual direction before implementation; a complete match remains readable and usable. |
| v0.4 | A debate can challenge claims and attach bounded, auditable evidence or safe proof results. | Evidence/challenge domain, provenance, capability boundaries, safe execution contracts. | Backward-compatible old matches, explicit provenance, bounded resource use, and security tests. |
| v0.5 | Repeated local competition has durable fictional credits and ratings. | Local persistence, repository ports, immutable ledger, profiles, settlement invariants. | No negative balances, idempotent settlement, migrations/backups, and clear fictional-only product language. |
| v0.6 | Matches can be replayed, organized into tournaments, and shared as controlled public artifacts. | Append-only events, replay compatibility, tournament lifecycle, optional distribution boundary. | Offline replay, resumable tournament state, privacy controls, and a safe share/host contract. |

### Version boundaries

- v0.1 supports Quick only. Standard and Hardcore remain disabled or clearly marked Coming Soon.
- v0.2 may enable Standard only after the policy, quality, and budget gates pass. Hardcore remains experimental until there is evidence that its cost and context behavior are acceptable.
- v0.3 is a visual/product redesign release. It changes the Arena presentation without changing the core debate contract.
- v0.4 adds evidence and challenge mechanics as opt-in capabilities. A normal Quick match must continue to work without them.
- v0.5 uses fictional credits only. Real-money betting, payments, and financial accounts are out of scope through v0.6.
- v0.6 can introduce an optional hosted or public adapter, but the local-first core must remain usable without a central service.

## Phase Map

The original PHASE 0–8 baseline is preserved. PHASE 4 now contains the dedicated v0.3 Arena redesign. PHASE 9–12 carry the later product work as v0.2, v0.4, v0.5, and v0.6.

| Phase | Name | Version focus | Outcome | Main dependencies |
|---|---|---|---|---|
| 0 | Project Foundation | v0.1 | Understandable repository, tooling, domain boundaries. | None |
| 1 | Provider System | v0.1, hardening in v0.2 | Safe, configurable OpenAI-compatible model access. | Phase 0 |
| 2 | Debate Engine | v0.1, quality in v0.2, extensions in v0.4 | Bounded match orchestration and extensible state transitions. | Phases 0–1 |
| 3 | Judge | v0.1, judge quality in v0.2, evidence adjudication in v0.4 | Structured and inspectable verdicts. | Phase 2 |
| 4 | Arena UI | v0.1, v0.3 redesign, later UX | A readable arena that feels like a broadcast rather than a generic chat dashboard. | Phases 0–3 |
| 5 | Streaming | v0.1, durable events in v0.6 | Real-time event delivery with safe cancellation. | Phases 1–2 |
| 6 | Integration | every version | Stable contracts between UI, API, engine, storage, and future adapters. | Phases 1–5 |
| 7 | QA | every version | Tests and acceptance evidence for each release gate. | All active phases |
| 8 | MVP Release | v0.1 | A formally closed and documented local MVP. | Phases 0–7 |
| 9 | Quality and Evaluation Lab | v0.2 | Trustworthy prompts, judge behavior, budgets, transcripts, and re-judging. | Phase 8 |
| 10 | Evidence, Challenges, and Safe Execution | v0.4 | Auditable claims/evidence and bounded proof capabilities. | Phase 9 + v0.3 UI |
| 11 | Persistence, Credits, and Ratings | v0.5 | Durable local competition with an auditable fictional economy. | Phases 9–10 |
| 12 | Replay, Tournaments, and Distribution | v0.6 | Replayable matches, tournament lifecycle, and controlled sharing. | Phases 9–11 |

### Dependency path

Foundation → Provider/Engine → Judge/Streaming → Integration/QA → v0.1 release → Quality Lab → Arena redesign → Evidence/Safe Execution → Persistence/Economy → Replay/Tournaments/Distribution.

The path is intentionally conservative. Quality comes before the visual redesign, and versioned event contracts come before evidence, economy, or public competition because those features amplify any ambiguity in the match model.

## Detailed TODO by phase and version

## PHASE 0 — Project Foundation

Milestone: a new developer or coding agent can understand the repository, run checks, and locate the domain boundaries without reverse-engineering the whole application.

### v0.1 baseline — inherited completed work

- [x] [P0] F0-01 Create the Next.js + TypeScript + Tailwind application shell in src/app.
- [x] [P0] F0-02 Establish the Feature-Sliced structure with entities, features, widgets, shared, pages, and the app layer.
- [x] [P0] F0-03 Add clear dev, build, lint, typecheck, and test commands.
- [x] [P0] F0-04 Define domain types for debate phases, agents, turns, configuration, and match state.
- [x] [P0] F0-05 Implement the CREATED → OPENING_A → OPENING_B → REBUTTAL_A → REBUTTAL_B → JUDGING → FINISHED state machine with transition tests.
- [x] [P0] F0-06 Add a centralized token-policy module with the initial agent and judge output limits of 1200 and 1000 tokens.
- [x] [P0] F0-07 Add .gitignore, a local configuration directory, and documentation stubs.

### v0.1 closure

- [ ] [P0] F0-08 Verify a clean install from a fresh checkout using the documented commands.
- [ ] [P0] F0-09 Document the server-only/client-safe boundary and the import rules that prevent secrets from entering the client bundle. Depends on F0-02 and F1-02.
- [ ] [P1] F0-10 Record the first architecture decision note for local-first storage, provider abstraction, and the decision not to add a database in v0.1.

### Later foundation work

- [ ] [P1] F0-11 v0.2 Define versioned domain-contract ownership: which layer owns MatchConfig, MatchEvent, Transcript, and Verdict.
- [ ] [P1] F0-12 v0.2 Add a lightweight schema/version compatibility policy for persisted or exported match data.
- [ ] [P1] F0-13 v0.4 Add capability discovery so optional evidence, challenge, and sandbox features are explicit rather than inferred from UI state.
- [ ] [P1] F0-14 v0.5 Add repository ports and migrations as a documented architectural boundary before introducing durable match and economy storage.
- [ ] [P1] F0-15 v0.6 Document the local core versus optional hosted/distribution adapters.

## PHASE 1 — Provider System

Milestone: the server can call a configured OpenAI-compatible model without exposing credentials, and provider failures become understandable product errors.

### v0.1 baseline — inherited completed work

- [x] [P0] F1-01 Define and validate provider configuration with provider name, base URL, API key, model ID, and redacted output.
- [x] [P0] F1-02 Implement a server-only local provider store with restrictive file permissions.
- [x] [P0] F1-03 Implement the interactive npm run provider:add CLI.
- [x] [P0] F1-04 Implement the OpenAI-compatible model factory.
- [x] [P0] F1-05 Implement GET /api/providers as a redacted provider list for the UI.
- [x] [P1] F1-06 Support the OpenAI Responses API endpoint alongside chat completions where the configured adapter requires it.

### v0.1 closure

- [ ] [P0] F1-07 Wrap model-factory failures into safe, typed errors for authentication, invalid configuration, unreachable endpoint, timeout, unsupported model, and provider response errors. Never expose API keys or raw secret-bearing request data. Depends on F1-04.
- [ ] [P0] F1-08 Add request cancellation and a bounded timeout path that reaches the model call from the match-run lifecycle. Depends on F1-07 and F2-06.
- [ ] [P1] F1-09 Add a mock OpenAI-compatible provider for contract and happy-path tests without a real credential. Depends on F1-04.

### v0.2 provider hardening

- [ ] [P1] F1-10 Define a small, explicit provider capability contract for streaming, structured output, cancellation, and Responses API support.
- [ ] [P1] F1-11 Add bounded retry behavior only where retrying is safe, observable, and does not silently duplicate a turn.
- [ ] [P1] F1-12 Add provider/model health verification with redacted diagnostics and no automatic calls on page load unless the user requests a check.
- [ ] [P2] F1-13 Add provider management in the UI for add, edit, delete, and test; preserve CLI support as a reliable fallback.
- [ ] [P2] F1-14 Add per-provider default generation settings while keeping the match snapshot authoritative.

### v0.4–v0.6 adapters

- [ ] [P1] F1-15 v0.4 Add an explicit user-controlled source/evidence adapter interface; do not grant arbitrary web or tool access to agents.
- [ ] [P1] F1-16 v0.4 Add a sandbox adapter interface with capability, resource, and network policy inputs.
- [ ] [P2] F1-17 v0.6 Add a hosted-provider adapter boundary only if public matches require it; do not couple the local engine to a remote service.

## PHASE 2 — Debate Engine

Milestone: a match is a bounded domain process, not orchestration logic hidden inside an API route or React component.

### v0.1 baseline — inherited completed work

- [x] [P0] F2-01 Build prompt context with history slicing.
- [x] [P0] F2-02 Add agent system prompts that identify the debate, topic, assigned position, rules, phase, and current round.
- [x] [P0] F2-03 Implement state helpers such as appendTurn and attachVerdict.
- [x] [P0] F2-04 Implement the injectable streaming debate runner.
- [x] [P0] F2-05 Enforce round/turn caps and output-token limits from the token policy.

### v0.1 closure

- [ ] [P0] F2-06 Propagate client disconnect and explicit cancel into the runner, abort the active provider request, and release match resources. Depends on F1-08.
- [ ] [P0] F2-07 Guarantee terminal cleanup for success, provider failure, parse failure, cancellation, and unexpected exception.
- [ ] [P0] F2-08 Reject illegal transitions with typed errors and ensure a failed match cannot continue as if it were healthy.
- [ ] [P1] F2-09 Add a small match-run integration test that proves the complete Quick sequence and terminal cleanup using the mock provider. Depends on F1-09 and F2-06.

### v0.2 engine quality

- [ ] [P0] F2-10 Extend token policy to define rounds, maximum context characters, history turns per policy, judge limits, and per-mode budgets. Keep Quick, Standard, and Hardcore as data-driven profiles.
- [ ] [P0] F2-11 Snapshot the effective MatchConfig, token policy, prompt versions, and provider/model metadata at match start. Never store the API key.
- [ ] [P1] F2-12 Introduce stable MatchEvent types for phase changes, thinking, token deltas, completed turns, errors, and verdicts.
- [ ] [P1] F2-13 Make history slicing explicit and test it against context overflow, empty history, long turns, and judge context.
- [ ] [P1] F2-14 Add a deterministic event sequence number and match ID to every server-to-client event.
- [ ] [P1] F2-15 Add a controlled re-judge operation that consumes a stored transcript without re-running Agent A or Agent B.
- [ ] [P1] F2-16 Enable Standard only behind a feature flag after F2-10, F3-08, F7-09, and the v0.2 release gate pass.
- [ ] [P2] F2-17 Keep Hardcore represented in policy and UI, but do not enable it until cost, context, and quality evidence justify it.

### v0.4 extension hooks

- [ ] [P0] F2-18 Add backward-compatible extension points for CHALLENGE, EVIDENCE, PROOF, and SANDBOX without changing the behavior of a plain Quick match.
- [ ] [P0] F2-19 Define bounded challenge budgets, phase ownership, and termination rules before implementing challenge UI.
- [ ] [P1] F2-20 Allow optional capability negotiation per match so evidence or sandbox phases cannot appear accidentally.
- [ ] [P1] F2-21 Add event-version migration tests for v0.2 transcripts entering the v0.4 engine.

## PHASE 3 — Judge

Milestone: the judge returns a valid, inspectable verdict and the product communicates uncertainty instead of pretending that a score is objective truth.

### v0.1 baseline — inherited completed work

- [x] [P0] F3-01 Define the basic DebateVerdict schema and tolerant JSON parsing.
- [x] [P0] F3-02 Include argument quality, rebuttal, consistency, and relevance criteria for both agents.
- [x] [P0] F3-03 Implement a judge prompt with a rubric over the full transcript and strict JSON output instructions.
- [x] [P1] F3-04 Apply lenient parsing for missing/partial criteria, derive safe defaults from scores, and emit an error event for invalid results.

### v0.1 closure and validation

- [ ] [P0] F3-05 Validate score ranges, winner/score consistency, required fields, and draw behavior after parsing. Depends on F3-01 and F3-04.
- [ ] [P1] F3-06 Show a safe fallback state when the judge fails; never invent a winner in the UI.

### v0.2 judge quality

- [ ] [P0] F3-07 Version the judge prompt and rubric; store the version with every verdict. Depends on F2-11.
- [ ] [P0] F3-08 Create representative golden transcripts and judge regression tests covering clear wins, close wins, draws, contradictions, irrelevant arguments, and malformed model output.
- [ ] [P1] F3-09 Add confidence/calibration fields and a documented policy for low-confidence verdicts and abstention.
- [ ] [P1] F3-10 Include compact supporting excerpts or turn references for each criterion so the user can inspect why a score was assigned.
- [ ] [P1] F3-11 Separate raw judge output, parsed verdict, and user-facing explanation; never let UI parsing become the domain validator.
- [ ] [P2] F3-12 Add optional multi-judge comparison as an experiment, not as a required v0.2 path.

### v0.4 evidence adjudication

- [ ] [P0] F3-13 Extend the rubric with claim-level evidence status, provenance quality, challenge outcome, and proof-result interpretation.
- [ ] [P0] F3-14 Make the judge distinguish “not proven”, “contradicted”, and “supported”; do not represent model confidence as factual certainty.
- [ ] [P1] F3-15 Show evidence-aware verdict explanations with citations to transcript events and evidence items.
- [ ] [P2] F3-16 Compare evidence-aware and transcript-only judgments for evaluation fixtures.

## PHASE 4 — Arena UI

Milestone: the interface feels like a premium debate arena while remaining readable, responsive, and operationally useful.

### v0.1 baseline — inherited completed work

- [x] [P1] F4-01 Implement a dark cinematic theme, typography, and an extended visual palette.
- [x] [P0] F4-02 Implement match creation with topic, provider/model selectors, positions, and automatic FOR/AGAINST mirroring that remains editable.
- [x] [P0] F4-03 Show Quick, Standard, and Hardcore in the mode selector with non-Quick modes disabled or marked Coming Soon.
- [x] [P1] F4-04 Implement the arena layout with distinct Agent A, Agent B, and Judge areas.
- [x] [P0] F4-05 Render agent speech as visually distinct speech panels rather than a generic ChatGPT message list.
- [x] [P1] F4-06 Add round, phase, thinking, speaking, judging, and finished indicators.
- [x] [P1] F4-07 Implement the separate judge panel with scores, reasoning, and winner presentation.
- [x] [P1] F4-08 Support desktop first, then tablet and mobile layouts without hiding the match outcome.

### v0.1 closure

- [ ] [P0] F4-09 Add usable loading, validation, provider-error, judge-error, cancellation, retry, and empty states.
- [ ] [P1] F4-10 Verify that no API key, raw provider error, or secret-bearing configuration is rendered in the browser.
- [ ] [P1] F4-11 Run a manual responsive smoke pass for match creation, active streaming, judge reveal, and failure states. Depends on F4-09.

### v0.2 trust and inspection

- [ ] [P1] F4-12 Add a transcript/timeline view with phase and turn filters, collapsed long turns, and clear speaker identity.
- [ ] [P1] F4-13 Add a “why this verdict” view tied to rubric criteria and transcript references.
- [ ] [P1] F4-14 Add match export and re-judge actions with clear version labels.
- [ ] [P1] F4-15 Add provider management UI only after the server-side validation and redaction flow is stable. Depends on F1-13.
- [ ] [P2] F4-16 Add accessible reduced-motion behavior and keyboard navigation for the arena.

### v0.3 Arena UI redesign — agreed concept

Milestone: a match feels like a funny, cinematic sports broadcast with two AI contenders and a central Judge, while the debate text stays easy to follow.

- [ ] [P0] F4-17 Before writing v0.3 UI code, pause and discuss the design brief with the user: scene layout, visual style, character direction, camera shots, lighting, emotions, and implementation scope. Do not start this redesign silently.
- [ ] [P0] F4-18 Confirm the stylized 3D/2.5D arena direction: two contenders seated at separate desks with computers, a Judge seated between them, an arena-like set, and a sports-broadcast feeling without copying UFC branding.
- [ ] [P0] F4-19 Build the main scene composition with two characters, two desks/computers, the central Judge, arena backdrop, round indicator, and match status.
- [ ] [P0] F4-20 Add state-driven lighting and a small set of planned camera changes for thinking, speaking, rebuttal, Judge speaking, and verdict. Do not build a free-roaming 3D camera.
- [ ] [P0] F4-21 Keep streamed speech as a readable first-class layer over or beside the 3D scene; the visual spectacle must not hide the debate.
- [ ] [P1] F4-22 Add simple character emotions and reactions tied to match events and phases; do not make an extra AI call only to decide an emotion.
- [ ] [P1] F4-23 Add a small curated meme-reaction library such as “Agent is cooking”, “Judge is not impressed”, and “Argument.exe stopped responding”, with mute and reduced-motion support.
- [ ] [P1] F4-24 Provide a responsive layout and a lightweight non-WebGL fallback that preserves the same match information.
- [ ] [P1] F4-25 Keep the first 3D pass lightweight: limited assets and animations, no physics, no free-roam world, and no complex character-rigging pipeline.
- [ ] [P0] F4-26 Review the working v0.3 Arena with the user before moving to v0.4; record the accepted direction and the remaining visual polish.

### v0.4 evidence and challenge UX

- [ ] [P0] F4-27 Add an explicit challenge request/resolution surface with remaining challenge budget.
- [ ] [P0] F4-28 Render evidence cards with provenance, source type, timestamp, and unverified/verified-by-rule status.
- [ ] [P1] F4-29 Make source content visibly untrusted and prevent it from looking like system instructions.
- [ ] [P1] F4-30 Show sandbox/proof status, resource limits, and failure reasons without exposing sensitive runtime details.

### v0.5–v0.6 competition UX

- [ ] [P1] F4-31 v0.5 Add local profiles, fictional wallet, ledger history, ratings, and settlement explanations.
- [ ] [P1] F4-32 v0.6 Add replay controls, event timeline scrubbing, tournament bracket, standings, and share/export actions.
- [ ] [P1] F4-33 v0.6 Add privacy labels and read-only public artifact views for shared matches.

## PHASE 5 — Streaming

Milestone: users see a trustworthy real-time match and the client can recover from ordering, cancellation, and failure conditions.

### v0.1 baseline — inherited completed work

- [x] [P0] F5-01 Connect the streaming debate runner to a Next.js API route.
- [x] [P0] F5-02 Stream token/status events for agent thinking, speaking, round changes, judging, and completion.
- [x] [P0] F5-03 Reduce server events into the arena state without coupling React components to provider internals.
- [x] [P1] F5-04 Surface provider and judge errors in the active match UI.

### v0.1 closure

- [ ] [P0] F5-05 Verify cancel/disconnect propagation from browser to API route to provider request. Depends on F2-06 and F1-08.
- [ ] [P0] F5-06 Ensure the stream closes exactly once for success, failure, cancel, and disconnect.
- [ ] [P1] F5-07 Add a client reconnect/closed-stream state that does not duplicate turns or fabricate completion.

### v0.2 contract hardening

- [ ] [P0] F5-08 Add match ID, monotonically increasing event sequence, event type, schema version, and terminal reason to the stream contract. Depends on F2-12 and F2-14.
- [ ] [P1] F5-09 Handle slow consumers and long token streams with bounded buffering/backpressure behavior.
- [ ] [P1] F5-10 Add a test matrix for event ordering, duplicate events, truncated streams, and late verdict events.

### v0.6 durable replay stream

- [ ] [P0] F5-11 Persist an append-only event log for replay without making the live UI depend on a remote stream. Depends on F2-12 and F11-01.
- [ ] [P1] F5-12 Support replay playback from stored events with no provider calls. Depends on F12-02.

## PHASE 6 — Integration

Milestone: the end-to-end path has explicit contracts and each layer can evolve without leaking implementation details into another layer.

### v0.1 baseline — inherited completed work

- [x] [P0] F6-01 Connect the match creation form to the debate API.
- [x] [P0] F6-02 Connect provider/model selection to server-side configuration.
- [x] [P0] F6-03 Connect stream events to the client reducer and arena widgets.
- [x] [P0] F6-04 Connect the parsed verdict to the judge panel and finished state.
- [x] [P1] F6-05 Keep provider keys and model-factory details server-only.

### v0.1 closure

- [ ] [P0] F6-06 Run a provider-backed happy path using either a real configured provider or the faithful mock provider, from create form through winner. Depends on F1-09, F2-09, and F5-06.
- [ ] [P0] F6-07 Add API contract tests for invalid configuration, missing provider, invalid mode, empty topic, cancellation, provider failure, malformed judge output, and successful completion.
- [ ] [P1] F6-08 Confirm that refreshing or navigating away cannot leave a live runner or secret-bearing process behind.

### v0.2–v0.6 integration contracts

- [ ] [P0] F6-09 v0.2 Define and validate MatchConfig, MatchEvent, Transcript, and DebateVerdict at the API/domain boundary.
- [ ] [P1] F6-10 v0.2 Add export/import of a redacted transcript and the exact non-secret configuration snapshot.
- [ ] [P0] F6-11 v0.4 Integrate evidence packets and challenge events without requiring evidence for legacy matches.
- [ ] [P0] F6-12 v0.5 Integrate local repositories behind ports; keep the engine independent of SQLite or another concrete store.
- [ ] [P1] F6-13 v0.6 Add stable read-only share/export contracts and an optional hosted adapter boundary.

## PHASE 7 — QA

Milestone: every release gate has repeatable evidence, not just a successful visual demo.

### v0.1 baseline — inherited completed work

- [x] [P0] F7-01 Test state transitions and illegal transitions.
- [x] [P0] F7-02 Test round progression and turn caps.
- [x] [P0] F7-03 Test tolerant judge parsing and verdict criteria.
- [x] [P0] F7-04 Test provider configuration validation and secret redaction.
- [x] [P0] F7-05 Test the initial token policy.
- [x] [P1] F7-06 Keep lint, typecheck, build, and unit-test commands available.

### v0.1 closure

- [ ] [P0] F7-07 Add a mock-provider end-to-end happy-path test from match creation through terminal verdict. Depends on F1-09 and F6-06.
- [ ] [P0] F7-08 Add a minimal browser smoke test for create → stream → judge → finished and the primary error state.
- [ ] [P0] F7-09 Add cancellation/disconnect tests and verify no active run remains afterward. Depends on F2-06 and F5-05.
- [ ] [P1] F7-10 Run a secret-safety check over server responses, browser state, logs, and build output.
- [ ] [P1] F7-11 Record a clean-install verification and the supported runtime/package-manager assumptions.

### v0.2 evaluation

- [ ] [P0] F7-12 Build a small fixture suite for prompt, context slicing, mode budgets, and judge verdict regression. Depends on F2-10, F2-11, and F3-08.
- [ ] [P0] F7-13 Track token usage, latency, error rate, and completion rate per fixture without logging secrets or full prompts by default.
- [ ] [P1] F7-14 Add contract tests for transcript export/import and re-judge behavior.
- [ ] [P1] F7-15 Add an evaluation report format that compares prompt/rubric versions.

### v0.3 Arena redesign QA

- [ ] [P0] F7-16 Verify the three-character arena composition, two desks/computers, central Judge, and readable speech layer on the main desktop layout.
- [ ] [P0] F7-17 Verify lighting and camera changes for thinking, speaking, rebuttal, Judge speaking, and verdict states.
- [ ] [P1] F7-18 Verify emotion/meme reactions, mute/reduced-motion behavior, and that no extra model calls are made for mood.
- [ ] [P1] F7-19 Verify responsive behavior, lightweight performance, and the non-WebGL fallback.

### v0.4 security and evidence QA

- [ ] [P0] F7-20 Test evidence provenance, size/type limits, malformed evidence, and prompt-injection-like source content.
- [ ] [P0] F7-21 Test challenge budgets, termination, event migration, and evidence-free legacy matches.
- [ ] [P0] F7-22 Test sandbox capability denial, timeout, output cap, cleanup, and network-disabled behavior.
- [ ] [P1] F7-23 Run an explicit threat-model review before enabling any external source or code execution adapter.

### v0.5–v0.6 QA

- [ ] [P0] F7-24 v0.5 Test ledger invariants, idempotent settlement, cancellation/refund, migrations, backup, restore, and import.
- [ ] [P0] F7-25 v0.6 Test replay equivalence, bundle compatibility, tournament resume, failure handling, privacy redaction, and read-only sharing.
- [ ] [P1] F7-26 v0.6 Add bounded load/performance tests for local tournament runs and event-log growth.

## PHASE 8 — MVP Release (v0.1)

Milestone: a new user can run a complete local Quick debate and see a trustworthy structured verdict.

### Release work

- [ ] [P0] F8-01 Close all v0.1 P0 tasks: F0-08, F1-07, F1-08, F2-06, F2-07, F2-08, F3-05, F4-09, F5-05, F5-06, F6-06, F6-07, F7-07, F7-08, and F7-09.
- [ ] [P0] F8-02 Complete the manual acceptance path: fresh install → provider:add → dev server → create topic → select two models → Quick → Start → watch all turns → judge evaluation → winner.
- [ ] [P0] F8-03 Confirm no API key is exposed in UI, network payloads intended for the client, logs, or committed files.
- [ ] [P0] F8-04 Confirm a provider failure, judge failure, invalid form, and user cancellation end in a clear recoverable UI state.
- [ ] [P1] F8-05 Finish README instructions for installation, provider setup, first debate, architecture map, and this TODO.
- [ ] [P1] F8-06 Finish the short architecture, debate-engine, providers, and development documentation.
- [ ] [P1] F8-07 Add a v0.1 changelog/release note with known limitations and supported provider assumptions.
- [ ] [P1] F8-08 Create the v0.1.0 release commit/tag only after the working tree and release evidence are reviewed.
- [ ] [P1] F8-09 Freeze the v0.1 contract: no Standard/Hardcore, evidence, sandbox, credits, tournaments, or public hosting in the MVP.

## PHASE 9 — Quality and Evaluation Lab (v0.2)

Milestone: a user can inspect a match, export it, re-judge it, and understand whether a prompt or judge change improved the product.

Dependencies: F8-01 through F8-09.

### Contract and reproducibility foundation

- [ ] [P0] F9-01 Define runtime-validated, versioned schemas for MatchConfig, MatchEvent, Transcript, and DebateVerdict. Depends on F0-11 and F6-09.
- [ ] [P0] F9-02 Store a redacted match snapshot containing provider name, model ID, mode, positions, rules, token policy, prompt versions, and timestamps. Never store API keys.
- [ ] [P0] F9-03 Assign stable match IDs and ordered event IDs; make terminal state and terminal reason explicit.
- [ ] [P0] F9-04 Implement redacted JSON and human-readable Markdown transcript export.
- [ ] [P1] F9-05 Implement import validation with schema version checks and actionable errors.
- [ ] [P1] F9-06 Add an architecture note for compatibility and migration of exported transcripts.

### Prompt, rubric, and judge quality

- [ ] [P0] F9-07 Move agent and judge prompts into versioned templates with explicit template IDs and change notes.
- [ ] [P0] F9-08 Define the v0.2 rubric in one source of truth, including score ranges, weights, draw policy, and confidence semantics.
- [ ] [P0] F9-09 Create a compact but representative golden transcript suite and judge regression fixtures. Depends on F3-08.
- [ ] [P1] F9-10 Add turn references or short evidence excerpts to the verdict explanation.
- [ ] [P1] F9-11 Add a compare-report format for two prompt/rubric versions over the same fixture set.
- [ ] [P1] F9-12 Add re-judge from an imported/stored transcript without re-running the debaters. Depends on F2-15 and F9-04.
- [ ] [P2] F9-13 Explore a multi-judge panel as an opt-in experiment; do not make it a dependency of the release.

### Budgets, modes, and reliability

- [ ] [P0] F9-14 Implement Quick, Standard, and Hardcore as centralized policy profiles with rounds, context, output, and judge limits. Depends on F2-10.
- [ ] [P0] F9-15 Add hard enforcement and clear UI explanation for context, token, timeout, and turn limits.
- [ ] [P1] F9-16 Record aggregate token usage, latency, and failure reason per match; avoid full-prompt logging by default.
- [ ] [P1] F9-17 Add context-compaction tests that preserve required topic, position, rules, and recent arguments.
- [ ] [P1] F9-18 Add provider timeout/cancellation/retry behavior to the evaluation matrix.
- [ ] [P1] F9-19 Enable Standard behind a feature flag only after the v0.2 gate passes.
- [ ] [P2] F9-20 Keep Hardcore disabled by default and document its expected cost/context tradeoff.

### Trust and product UX

- [ ] [P1] F9-21 Add transcript timeline/filter/collapse controls.
- [ ] [P1] F9-22 Add a “why this verdict” view connected to rubric criteria and turn references.
- [ ] [P1] F9-23 Add export and re-judge actions with prompt/rubric version labels.
- [ ] [P2] F9-24 Add editable provider management in the UI after F1-13 is complete.

### v0.2 milestone and exit

- [ ] [P0] F9-25 Demonstrate two prompt/rubric versions evaluated over the same fixtures with a readable comparison report.
- [ ] [P0] F9-26 Demonstrate export → import → re-judge without calling Agent A or Agent B.
- [ ] [P0] F9-27 Pass the v0.2 release gate and update the changelog before starting the v0.3 Arena redesign.

## PHASE 10 — Evidence, Challenges, and Safe Execution (v0.4)

Milestone: a user can challenge a bounded claim, inspect the attached provenance, and see whether a proof/evaluator result was accepted without confusing it with absolute truth.

Dependencies: v0.3 Arena redesign, F9-01 through F9-27, especially F2-18, F3-13, and F7-20 through F7-23.

### Evidence domain

- [ ] [P0] F10-01 Define Claim, EvidenceItem, Provenance, Challenge, ChallengeResponse, ProofResult, and EvidenceStatus domain types.
- [ ] [P0] F10-02 Define evidence event schemas and version them independently from provider response formats.
- [ ] [P0] F10-03 Add claim/evidence references to transcripts and verdicts without making evidence mandatory for old matches.
- [ ] [P0] F10-04 Define explicit statuses such as supported, contradicted, insufficient, unverified, and unavailable.
- [ ] [P1] F10-05 Add provenance fields for source type, user/provider origin, timestamp, content hash, and extraction method.

### User-supplied evidence first

- [ ] [P0] F10-06 Support a bounded user-supplied evidence packet using pasted text or approved local files.
- [ ] [P0] F10-07 Enforce evidence size, type, count, and context limits before content reaches an agent or judge.
- [ ] [P0] F10-08 Render evidence as untrusted content and isolate it from system/developer instructions.
- [ ] [P1] F10-09 Add optional source adapters behind an explicit user action and capability flag; web search is not automatic.
- [ ] [P1] F10-10 Cache source metadata and content hashes for repeatable inspection without silently claiming freshness.

### Challenge mechanics

- [ ] [P0] F10-11 Implement bounded challenge requests with ownership, remaining budget, target claim, and termination rule.
- [ ] [P0] F10-12 Let the challenged agent respond with evidence or an explicit inability to prove the claim.
- [ ] [P0] F10-13 Let the judge adjudicate challenge outcomes and attach the decision to the relevant claim and events.
- [ ] [P0] F10-14 Preserve a valid terminal verdict when a challenge, evidence source, or proof adapter fails.
- [ ] [P1] F10-15 Add UI for requesting, answering, and resolving a challenge.

### Safe proof and sandbox boundary

- [ ] [P0] F10-16 Define a SandboxAdapter port with declared capabilities, input/output schemas, limits, and denial reasons.
- [ ] [P0] F10-17 Make network access, filesystem access, process execution, and secrets explicit capabilities; default all to denied.
- [ ] [P1] F10-18 Implement one narrow deterministic proof/evaluator adapter with time, memory, output, and cleanup limits.
- [ ] [P1] F10-19 Add process isolation and temporary-resource cleanup appropriate to the supported local runtime.
- [ ] [P1] F10-20 Keep Docker or a remote sandbox as an optional adapter, not a hard dependency for the local core.
- [ ] [P2] F10-21 Add more proof adapters only after the first adapter has security and reliability evidence.

### v0.4 milestone and exit

- [ ] [P0] F10-22 Demonstrate a normal evidence-free Quick match still works unchanged.
- [ ] [P0] F10-23 Demonstrate a challenge with a bounded evidence packet, visible provenance, and judge adjudication.
- [ ] [P0] F10-24 Demonstrate sandbox denial, timeout, malformed output, and cleanup without hanging the match.
- [ ] [P0] F10-25 Complete the threat-model review and pass the v0.4 release gate.

## PHASE 11 — Persistence, Credits, and Ratings (v0.5)

Milestone: a user can run repeated local matches with durable history, fictional stakes, and ratings that remain auditable after restart.

Dependencies: v0.3 Arena redesign, F9-01 through F9-27, F10-01 through F10-25, and especially F6-12.

### Persistence foundation

- [ ] [P0] F11-01 Define repository ports for profiles, matches, events, transcripts, verdicts, ledger entries, and tournaments.
- [ ] [P0] F11-02 Add a local SQLite adapter or another documented embedded store only after the repository port is stable; keep configuration secrets outside match storage.
- [ ] [P0] F11-03 Add schema migrations, version checks, file locking, and a clear data directory policy.
- [ ] [P0] F11-04 Add local backup, restore, export, and corruption/error messaging.
- [ ] [P0] F11-05 Import v0.2 redacted transcripts without inventing missing economy or profile data.
- [ ] [P1] F11-06 Add retention controls and a way to remove local match history without deleting provider configuration accidentally.

### Local identity and profiles

- [ ] [P0] F11-07 Define stable local profile and agent IDs independent from display names or provider model IDs.
- [ ] [P0] F11-08 Add local profiles for agent configurations and human-created match presets without requiring accounts or authentication.
- [ ] [P1] F11-09 Preserve provider/model/prompt snapshots when a profile changes later.

### Fictional credits ledger

- [ ] [P0] F11-10 Define integer-based CreditAccount and immutable LedgerEntry types; never use floating-point money arithmetic.
- [ ] [P0] F11-11 Implement starting balances, optional entry stakes, settlement, cancellation, and refund as explicit ledger operations.
- [ ] [P0] F11-12 Enforce no-negative-balance, idempotency, conservation, and terminal-match settlement invariants.
- [ ] [P0] F11-13 Make all credits clearly fictional, local, and non-redeemable in product copy and UI.
- [ ] [P1] F11-14 Add an auditable ledger view showing why each balance changed.
- [ ] [P1] F11-15 Add configurable local caps and an opt-out path; do not pressure a user to stake credits.

### Ratings and competition signals

- [ ] [P1] F11-16 Define a rating model separate from credits; start with a documented Elo-like model or another simple deterministic baseline.
- [ ] [P1] F11-17 Update ratings only from valid terminal matches and record the calculation inputs.
- [ ] [P1] F11-18 Add local rankings and filters by model, provider, mode, prompt version, and date.
- [ ] [P2] F11-19 Add matchmaking suggestions after enough local history exists; do not hide the pairing logic.

### v0.5 milestone and exit

- [ ] [P0] F11-20 Restart the application and retain match history, profiles, ledger, and ratings.
- [ ] [P0] F11-21 Prove repeated settlement is idempotent and cannot create or destroy credits unexpectedly.
- [ ] [P0] F11-22 Restore a backup and import a v0.2 transcript successfully.
- [ ] [P0] F11-23 Pass the v0.5 release gate with fictional-only language and no payment path.

## PHASE 12 — Replay, Tournaments, and Distribution (v0.6)

Milestone: a completed match can be replayed offline, several matches can be run under tournament rules, and a user can share a controlled read-only artifact.

Dependencies: v0.3 Arena redesign, F11-01 through F11-23, especially F5-11 and F7-25.

### Replay

- [ ] [P0] F12-01 Define an append-only event-log format with schema version, match ID, sequence, timestamp, and terminal reason.
- [ ] [P0] F12-02 Implement replay state reconstruction from events without provider calls, network access, or secret configuration.
- [ ] [P0] F12-03 Make replay reproduce the transcript, phase progression, verdict, evidence references, and visible UI state.
- [ ] [P0] F12-04 Add export/import bundles with checksums, version metadata, and secret redaction.
- [ ] [P1] F12-05 Add replay speed controls, timeline seeking, phase filtering, and a comparison between original and re-judged verdicts.
- [ ] [P1] F12-06 Add compatibility tests for at least the v0.2 and v0.4 event formats.

### Tournament lifecycle

- [ ] [P0] F12-07 Define a tournament domain model with participants, rules, seeding, rounds, match slots, standings, and terminal states.
- [ ] [P0] F12-08 Implement one bounded format first, preferably single elimination, before adding round robin or Swiss formats.
- [ ] [P0] F12-09 Add deterministic pairing/seeding and explicit handling for provider failure, cancellation, draw, and disqualification.
- [ ] [P0] F12-10 Persist resumable tournament state and prevent a completed match from being settled twice.
- [ ] [P1] F12-11 Add bracket, standings, match detail, and tournament progress UI.
- [ ] [P2] F12-12 Add additional tournament formats only after the first format has replay and failure evidence.

### Controlled sharing and public matches

- [ ] [P0] F12-13 Define a read-only share artifact with privacy mode, included fields, omitted fields, and provenance labels.
- [ ] [P0] F12-14 Add local file/share import and export before requiring a hosted service.
- [ ] [P1] F12-15 Define an optional hosted API adapter with authentication, authorization, rate limits, and no provider-key upload.
- [ ] [P1] F12-16 Add public/private/unlisted controls and a deletion path for hosted artifacts.
- [ ] [P1] F12-17 Add content-safety and abuse-reporting hooks at the hosted boundary; keep them out of the local core.

### v0.6 milestone and exit

- [ ] [P0] F12-18 Replay a completed match offline from an exported bundle.
- [ ] [P0] F12-19 Resume a tournament after application restart and recover from a failed match according to documented rules.
- [ ] [P0] F12-20 Share a redacted read-only artifact that contains no provider credentials or private local paths.
- [ ] [P0] F12-21 Pass the v0.6 release gate and document what remains experimental.

## Release Gates

The release gates are the definition of a version, not a suggestion. A version is complete when all P0 work for that version is complete, the applicable gate passes, and the release evidence is documented.

### v0.1 Local Quick Arena

- [ ] Fresh install succeeds from the documented prerequisites.
- [ ] provider:add stores configuration locally with restrictive permissions and redacts API keys.
- [ ] The browser can list/select providers and models without receiving credentials.
- [ ] A Quick match runs through all intended phases with visible streaming status.
- [ ] Agent A and Agent B receive the correct topic, position, rules, history, and round.
- [ ] Output, rounds, context, and judge limits are enforced.
- [ ] The judge returns a validated structured verdict or a clear failure state.
- [ ] Invalid input, missing provider, provider timeout/failure, malformed judge output, cancel, and disconnect are recoverable.
- [ ] No active runner remains after terminal completion, failure, cancel, or disconnect.
- [ ] Unit tests, mock-provider integration test, smoke E2E, lint, typecheck, and build pass.
- [ ] README and core development docs describe the actual behavior and limitations.
- [ ] Standard/Hardcore, evidence, sandbox, credits, betting, tournaments, and public hosting are not accidentally enabled.

### v0.2 Trustworthy Debate Lab

- [ ] All v0.1 gates remain green.
- [ ] Match configuration, event stream, transcript, verdict, prompt, rubric, and policy versions are recorded without secrets.
- [ ] Export/import validation is versioned and tested.
- [ ] A stored transcript can be re-judged without re-running the debaters.
- [ ] Golden fixtures cover judge and prompt regressions, including draws and malformed outputs.
- [ ] Token usage, latency, and failure metrics are measurable without default secret/prompt leakage.
- [ ] Quick remains stable; Standard is enabled only if its policy and evaluation evidence pass.
- [ ] The user can inspect why a verdict was produced.

### v0.3 Arena UI Redesign

- [ ] All v0.2 gates remain green.
- [ ] The coding agent pauses before implementation and discusses the scene plan with the user.
- [ ] The main arena has two contenders at desks with computers, a central Judge, and a sports-broadcast/UFC-like atmosphere without copying UFC branding.
- [ ] The 3D/2.5D scene changes lighting and camera emphasis for thinking, speaking, rebuttal, Judge speaking, and verdict.
- [ ] Character emotions and curated meme reactions are driven by match events without extra AI calls just for mood.
- [ ] Streamed speech, round status, and verdict remain readable at all times.
- [ ] The scene stays lightweight, responsive, and has a usable non-WebGL fallback.
- [ ] The user reviews the working redesign before v0.4 work begins.

### v0.4 Evidence and Safe Execution

- [ ] All v0.3 gates remain green.
- [ ] Evidence, claims, challenges, and proof results are typed, bounded, provenance-aware, and versioned.
- [ ] Evidence is opt-in, visibly untrusted, and cannot override system/developer instructions.
- [ ] A challenge always has a finite budget and a terminal path.
- [ ] Legacy evidence-free matches remain compatible.
- [ ] Sandbox capabilities default to denied; time, memory, output, network, filesystem, and cleanup rules are tested.
- [ ] Threat-model and prompt-injection reviews are complete before external sources or execution are enabled.

### v0.5 Local Competitive Economy

- [ ] All v0.4 gates remain green.
- [ ] Local storage survives restart, has migrations, backup, restore, and clear corruption handling.
- [ ] Profiles and match snapshots are stable across display-name or provider changes.
- [ ] Credits are fictional, integer-based, local, auditable, and non-redeemable.
- [ ] Settlement is idempotent and never produces a negative balance or double reward.
- [ ] Ratings are separate from credits and use documented inputs.
- [ ] No payment, subscription, real-money betting, or financial-account path exists.

### v0.6 Replay and Competition Platform

- [ ] All v0.5 gates remain green.
- [ ] Replay reconstructs a match offline without provider calls or secrets.
- [ ] Exported bundles have schema versions, checksums, compatibility tests, and privacy redaction.
- [ ] A tournament has deterministic pairing, resumable state, and documented failure/draw behavior.
- [ ] Shared artifacts are read-only by default and expose only intentionally included data.
- [ ] Any hosted boundary has authentication, authorization, rate limits, privacy controls, deletion, and content-safety hooks.
- [ ] Local-first operation still works without the hosted adapter.

## Definition of Done

### Individual task

A task is done when it is implemented as part of a coherent work batch and does not leave the product in a knowingly broken state. Add a focused test when the task changes domain logic or a critical failure path. Do not create a separate commit, full QA cycle, or document for every small checkbox.

### Phase

A phase is done when its milestone can be demonstrated, all P0 tasks are complete, direct dependencies are complete, and one consolidated phase check has been run.

### Version

A version is done when:

- every earlier version gate remains green;
- all current-version P0 tasks are complete;
- P1 omissions are explicitly listed as non-blocking and do not compromise safety, correctness, or the core product promise;
- release notes, migration notes, and known limitations are updated together at the milestone;
- the release gate is checked in this file;
- the version is tagged or otherwise identified in the repository.

## Architectural Principles

1. Local-first by default. The user's computer runs the application and owns local configuration and history unless a later feature explicitly opts into a service.
2. Domain logic first. Debate Engine, Provider Layer, Judge, Match State, token policy, event contracts, and persistence ports do not belong inside React components.
3. UI does not know provider details. The UI consumes safe domain/API contracts and never sees API keys, raw model clients, or provider request formats.
4. Server-only secrets. Credentials are read and used on the server, never serialized into client state, logs, exports, or replay bundles.
5. Ports and adapters. OpenAI-compatible providers, evidence sources, sandbox runners, storage engines, and hosted services are replaceable adapters behind narrow interfaces.
6. Bounded execution. Every model turn, context, round, challenge, evidence packet, sandbox run, retry, and tournament has explicit limits.
7. Events are the spine of observability. A match should be explainable from ordered events, not from incidental UI state.
8. Version contracts before expansion. Persisted/exported data and events need schema versions and migration rules before replay, economy, or public sharing.
9. Provenance over certainty. Evidence and judge confidence must be labeled; the product must not present model output as objective truth.
10. Additive evolution. New capabilities should not break evidence-free Quick matches or invalidate older transcripts without a migration path.
11. Test invariants, not only snapshots. State transitions, budgets, redaction, ledger arithmetic, event ordering, and cleanup deserve focused tests.
12. Minimize dependencies and complexity. Add a library or service only when its value is documented and the simpler local design is insufficient.

## Non-goals

### Explicitly out of v0.1

- Authentication, accounts, subscriptions, payments, or real-money betting.
- Social feeds, comments, community profiles, or public leaderboards.
- Tournaments, matchmaking, and persistent economy.
- A central cloud server or mandatory centralized database.
- Docker or unrestricted code execution sandbox.
- Automatic web search, GitHub tools, arbitrary autonomous tool use, or agent-controlled network access.
- Complex long-term agent memory.
- A separate custom integration for every model provider.
- Enabling Standard or Hardcore before their policies and quality evidence are ready.

### Still out through v0.6 unless separately approved

- Real-money wagering, financial custody, payouts, or regulated gambling mechanics.
- Unrestricted autonomous browsing, arbitrary tool execution, or unreviewed source ingestion.
- A microservice rewrite driven only by hypothetical scale.
- A hosted platform without authentication, authorization, privacy, rate limits, deletion, and abuse controls.
- Treating a judge verdict as ground truth rather than a model-based evaluation with evidence and confidence.

## Future Extensions

These ideas are intentionally recorded but are not dependencies of v0.1–v0.6:

- Human-versus-AI and human-in-the-loop judging.
- Team debates, more than two agents, cross-examination, and audience questions.
- Multi-judge calibration, judge tournaments, and model-vs-model evaluation suites.
- Optional web evidence with source freshness, citation verification, and user-controlled browsing.
- More deterministic proof adapters for math, code, data, and formal claims.
- Voice, multimodal arguments, diagrams, and live captioning.
- Hosted synchronization, organization workspaces, permissions, and model/provider sharing.
- Community match libraries and a public benchmark dataset built from consented/redacted artifacts.
- Adaptive prompt policies and learned cost/quality routing.
- Real-money mechanics only as a separate compliance, safety, and product program; never as an implicit extension of fictional credits.

## Autonomous Coding-Agent Workflow

Use this loop for each coherent work batch or milestone:

1. Read this file and identify the active version and phase.
2. Select a small group of related tasks that can be implemented together.
3. Check their dependencies and reuse the existing architecture before adding abstractions.
4. Implement the group as one vertical slice.
5. Run one appropriate check pass after the group: focused tests for domain changes, plus lint/typecheck/build when the batch or phase warrants it.
6. Review security, cancellation, token, and data-redaction implications at the batch or phase level.
7. Mark the verified tasks complete and update documentation only when public behavior or an architectural contract changed.
8. Make a commit at a meaningful batch or milestone boundary, not after every checkbox.
9. Run the full release gate at the end of the phase.
10. Before v0.3 implementation, pause and discuss the Arena design with the user. Do not silently start the 3D redesign.
11. Do not begin a later version while the current release gate has an unresolved P0.

Recommended agent responsibilities:

- Architect: boundaries, contracts, dependencies, migrations, and architecture notes.
- Debate Engine: state machine, runner, prompts, context, policies, and event semantics.
- Provider: adapters, configuration, secrets, timeouts, cancellation, and mock provider.
- Judge/Evaluation: rubric, parsing, fixtures, calibration, and re-judge behavior.
- Frontend: arena, creation flow, timeline, evidence, replay, accessibility, and responsive UX.
- QA/Security: tests, release gates, failure paths, redaction, threat modeling, and regression checks.
- Documentation/Release: README, development docs, changelog, migration notes, and TODO maintenance.

Do not create more agents than the work requires. Every agent must have a bounded responsibility and must return test evidence plus the files or modules changed.

## Decision Log

- v0.1 remains local-first and Quick-only.
- The original PHASE 0–8 backlog is preserved as the baseline; completed tasks are not deleted.
- Quality/evaluation is a separate v0.2 phase because stronger judge behavior and reproducibility are prerequisites for evidence, credits, and competition.
- Evidence and sandbox are separate concerns: evidence can be user-supplied and auditable; execution must be capability-limited and denied by default.
- v0.3 is a dedicated Arena UI redesign: three stylized characters, two desks with computers, a central Judge, sports-broadcast staging, changing lights, emotions, and camera shots.
- The coding agent must discuss and confirm the v0.3 Arena design with the user before implementing it, then review the working result with the user before moving on.
- Credits in v0.5 are fictional and local. Real-money betting is not part of this roadmap.
- Replay is based on versioned ordered events, not on re-running providers, and is delivered in v0.6.
- Public matches begin as redacted read-only artifacts; a hosted service is optional and must have its own security boundary.
