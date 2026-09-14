# AI Debate Arena — Product Roadmap

> Current product baseline: v0.3.1.
>
> The previous v0.4 security/evidence roadmap was rejected by the product owner. It was not an accepted release direction and must not guide future work.

## North star

AI Debate Arena is a game and a model-versus-model experiment.

Two AI contenders should be able to argue, inspect the web, run code, use a growing set of tools, turn tool results into visible evidence, challenge each other, and risk match points on claims. Each contender is one independent agent that persists for the whole match, not a sequence of unrelated model calls. A separate judge evaluates both the debate and how well each contender used evidence.

The interesting thing on screen is not infrastructure. It is watching two capable models decide what to do, produce proof, attack each other's claims, take risks, and win or lose.

## The three modes

- **Quick** is the current six-turn debate and the first-look experience intended for the public website. Keep it fast, predictable, simple, and usable without running the project locally. New agentic mechanics must not be forced into Quick.
- **Standard** is the product direction for v0.4 through v0.6. It is the same web product run locally on the user's computer, where its local Node.js server can give the two agents web search, code execution, skills, evidence, stakes, live challenges, variable match length, replay, model comparison, and other local tools.
- **Extreme** is a future expansion of the locally run web product. It may add container-backed execution such as Docker and much broader agent capabilities, but its exact game and architecture remain intentionally undefined until Standard is complete and the owner starts that work.

Versions describe the growth of Standard Mode; they are not additional modes.

## Product delivery model

AI Debate Arena remains a web product built from one shared codebase. Do not turn it into an Electron, Tauri, or other native desktop application.

- The planned public website runs Quick. It also presents Standard and Extreme as previews of the full local experience. Selecting either unavailable mode opens a clear promotional panel with an explanation and a link to the project's GitHub/local setup.
- Standard runs through the same browser UI on `localhost`, backed by the Next.js/Node.js server running on the user's computer.
- The browser page requests agent actions through local server routes. The local server—not the browser tab itself—runs code, reads user-selected workspaces, invokes command-line tools, accesses local runtimes, and returns results to the match stream.
- The same Standard match may combine local tools with internet tools and remote or local model providers.
- Windows and macOS share the UI, agent workflow, game rules, tool protocol, and nearly all server code. Use portable Node.js APIs by default and add small platform adapters only for real differences such as paths, executable discovery, or OS-specific process behavior.
- Development may use `npm run dev`; the later user-facing local start/install flow must remain a web-server workflow rather than a desktop-app packaging project.

The public site is the funnel: play Quick immediately, discover the full agent arena, then follow the Standard or future Extreme call to action to run it locally.

## What a player is in Standard

Each player is a match-long agent driven by its selected model. The agent has a fixed side and objective, its own working context, a configurable skill and tool loadout, and its own match-local resources. Agent A and Agent B do not share private working context; they meet through the public match transcript, tool results, evidence, claims, challenges, and score changes.

On every move, the active agent follows an iterative workflow:

1. Observe the current public match state and the opponent's latest actions.
2. Decide whether to investigate, use a skill, make or challenge a claim, spend resources, speak, continue, or prepare to finish.
3. Execute zero or more tool actions and receive their results back into the same agent session.
4. Adapt its approach from those results rather than following a prewritten tool sequence.
5. Commit a public argument or game action, then keep its match context for its next move.

The match orchestrator schedules the two agents and enforces game rules, budgets, event order, and ending conditions. It must not choose the agents' strategy for them. The judge is a separate model role that evaluates the public match record after play ends. We expose useful actions, sources, and results to the viewer; we do not expose or require private chain-of-thought.

This should remain a thin product abstraction built for the playable Standard match, not a general-purpose agent platform.

## Rules for anyone working on the project

1. Build a playable vertical slice before adding architecture around it.
2. Every work batch must end in a visible improvement to the match, setup, spectator experience, or verdict.
3. Do not create a security, compliance, hosting, persistence, migration, or observability project unless the owner explicitly asks for it.
4. Do not narrow agent capabilities because of hypothetical future deployment concerns. Agents choose tools dynamically from the match loadout.
5. Add only the minimum operational checks needed to make the current feature run reliably. Product capability comes first; hardening comes later.
6. Do not infer owner approval. A release, design, or direction is accepted only when the owner explicitly says so after seeing it.
7. Keep documentation short and current. Delete superseded plans instead of preserving a maze of stale phases and checkboxes.
8. Preserve Quick as the stable public baseline, put new gameplay into locally run Standard, and do not implement Extreme beyond its approved future-facing product promise.

## Testing policy

- There is no test-count target and no reason to maximize coverage numbers.
- Add focused tests for important game rules, scoring, event order, and bugs likely to return.
- A normal feature usually needs a happy-path test and only the failure cases that protect real user experience.
- Do not generate thousands of lines of schema tests, mirrored contract tests, exhaustive security matrices, or tests for hypothetical adapters.
- Prefer one end-to-end playable demonstration over dozens of low-value unit tests.
- Run focused checks while iterating. Run the full suite only when a coherent milestone is ready.

## What already works and stays

- Two configurable contenders and a separate judge.
- Six-turn Quick matches with streamed responses.
- Provider-neutral OpenAI-compatible model configuration.
- Match history, transcript pages, export, re-judge, and verdict breakdowns.
- The broadcast arena, characters, camera, lighting, captions, and match playback.
- The existing match runner and ordered event stream as the base for agent actions.

## Standard match structure

Standard does not have a predetermined number of turns. It has a generous shared ruleset and a resource-driven ending, so different models can create genuinely different matches.

1. Both contenders always receive an opening move.
2. The match then enters alternating open rounds. On a move, a contender may research, use tools, make or challenge claims, place stakes, and deliver an argument.
3. Each contender controls a match-local resource pool. Speeches, tool actions, and stakes create meaningful resource decisions instead of a fixed round counter.
4. At round boundaries, each contender can signal `continue` or `ready`. The match ends naturally when both are ready. If only one is ready, another paired round happens so neither side loses the right to answer.
5. A contender with insufficient resources is forced to finish. The opponent receives one final move before closing. A decisive stake/challenge outcome may instead create a knockout ending.
6. A generous emergency ceiling on total actions and runtime exists only to prevent a broken match from running forever; it is not the normal game clock.
7. When the match ends normally, both sides receive a closing moment before the judge decides.

Exact starting resources, action costs, stake sizes, and ending thresholds must be tuned through real matches. Do not bury them in architecture before the loop is playable.

## Immediate cleanup before the new v0.4

- [x] Remove the rejected Windows sandbox host and its dedicated test suite.
- [x] Remove the post-match-only challenge/proof flow that does not serve the live game.
- [x] Remove redundant evidence/security schemas and test matrices.
- [x] Retain only small generic request/storage reliability improvements. Rebuild evidence and web tools lean inside the live Standard loop instead of carrying the rejected framework forward.
- [x] Remove all false release approvals and references to the rejected v0.4 direction.
- [x] Confirm the v0.3.1 automated baseline after cleanup: 439 tests and all workspace typechecks pass.

## v0.4 — Standard: Agentic Evidence Match

### Product promise

Standard Mode becomes playable through the locally run web product. During a live move, each contender can decide to use local and internet tools before delivering its argument. Tool activity and results are visible in the arena and become evidence the opponent and judge can inspect. Public Quick remains unchanged.

### First playable slice

- [x] Introduce one lightweight, persistent agent session per contender with its model, side, objective, working context, tool loadout, and match-local resources.
- [x] Add a small tool registry shared by both contenders.
- [x] Add the iterative agent action loop: observe the match, choose the next action, execute zero or more tools, consume their results, adapt, and then deliver the public move.
- [x] Keep Agent A and Agent B independent for the whole match; neither receives the other's private working context.
- [x] Replace Standard's fixed turn list with the opening + open-round + closing lifecycle.
- [x] Let each contender return a continue/ready intent so match length emerges from play.
- [x] Add a generous match-local resource pool and basic action costs to guarantee a natural ending.
- [x] Add `web_search` so a contender can find relevant sources without the user pasting URLs.
- [x] Add `fetch_url` so a contender can inspect a selected source.
- [x] Add `run_code` for useful calculations, data checks, and executable demonstrations.
- [x] Stream tool-start, tool-result, evidence, and failure events into the existing match UI.
- [x] Show compact evidence cards with source, excerpt/result, producing contender, and related claim.
- [x] Give the judge the transcript plus tool-produced evidence and require the verdict to reference important evidence.
- [ ] Give both contenders the same configurable tool and time budget for a fair comparison.

### v0.4 release gate

- [ ] In one live match, both models independently use web search and code execution.
- [ ] Each contender demonstrably persists as one agent across moves and changes its next action in response to opponent or tool results.
- [ ] The two agents can choose different tool sequences and strategies from the same available loadout; the orchestrator does not script those choices.
- [ ] Two Standard matches can end after different numbers of moves because the contenders made different decisions.
- [ ] The spectator can understand what each model tried, what it found, and how that affected its argument.
- [ ] The judge distinguishes unsupported claims from claims backed by visible tool results.
- [ ] Tool failure is visible and does not destroy the whole match.
- [ ] The owner plays or watches the complete match and explicitly approves v0.4.

## v0.5 — Standard: Stakes and Live Challenges

### Product promise

Standard's resource system becomes a real game. Claims become actions: contenders can put match-local credits behind a claim, challenge an opponent, produce proof under pressure, and visibly win or lose the stake. Quick remains unchanged.

### Playable slice

- [ ] Give each contender the same match-local pool of credibility points.
- [ ] Let a contender attach a stake to a specific claim during its turn.
- [ ] Let the opponent accept, counter, or challenge the claim.
- [ ] On challenge, give the claimant a short tool-enabled proof phase.
- [ ] Resolve the claim as supported, contradicted, or insufficient using the visible evidence.
- [ ] Apply a simple deterministic settlement rule and show it clearly in the arena.
- [ ] Let resolved stakes transfer or consume resources and create possible knockout endings.
- [ ] Cap the stake effect on the final result so debate quality still matters.

### v0.5 release gate

- [ ] A complete match contains multiple voluntary stakes and at least one live challenge.
- [ ] The points make model confidence and bluffing interesting rather than random.
- [ ] The viewer can trace every point change to one claim and outcome.
- [ ] The owner playtests the mechanic and explicitly approves v0.5.

Persistent wallets, accounting systems, database migrations, and real-money mechanics are not part of this version.

## v0.6 — Standard: Model Arena and Skill Loadouts

### Product promise

Standard becomes a meaningful model-comparison game: different models can use rich tool loadouts, and the product shows how they reason, research, execute, manage resources, and compete. Quick remains the fast public baseline; Extreme remains a future local mode rather than current implementation work.

### Playable slice

- [ ] Make tools easy to add as skills without changing the core match loop.
- [ ] Add useful skill categories such as math, datasets, document analysis, repository search, and structured data inspection.
- [ ] Add match presets and configurable skill loadouts.
- [ ] Record model quality, evidence quality, tool success, latency, token use, and cost.
- [ ] Add a comparison screen that explains why one model performed better.
- [ ] Replay speeches, tool actions, evidence, stakes, and verdict moments from the match event log.
- [ ] Add one simple tournament format only after individual matches are fun.

### v0.6 release gate

- [ ] Multiple model pairs can run the same preset with comparable tools and budgets.
- [ ] Replays preserve the interesting decisions and evidence trail.
- [ ] The comparison view is useful for choosing models, not merely a leaderboard.
- [ ] The owner reviews the full arena experience and explicitly approves v0.6.

## After v0.6 — Standard UI/UX pass

Once Standard's complete game loop works, give it a dedicated usability and presentation pass before building Extreme.

- [ ] Make the mode selector clearly explain Quick versus Standard.
- [ ] Design a variable-length match timeline instead of pretending every match has the same rounds.
- [ ] Make tools, evidence, remaining resources, readiness, stakes, challenges, and knockouts readable at a glance.
- [ ] Add satisfying research, stake, challenge, proof, win, loss, and closing moments to the broadcast presentation.
- [ ] Playtest the full Standard experience with the owner and iterate on pacing.
- [ ] Do not begin implementing Extreme until Standard functionality and this UI/UX pass are explicitly approved.

## Later, only when explicitly requested

- Production security hardening and threat modeling.
- Expansion of public hosting beyond the Quick first-look experience, including accounts and permissions.
- Databases, migrations, backup/restore systems, and distributed workers.
- Permanent wallets, complex rating economies, or real-money wagering.
- Compliance, abuse-reporting, and enterprise administration.

These may become important after the game is compelling. They must not block proving the product first.
