# AI Debate Arena — Product Roadmap

> Current product baseline: v0.3.1.
>
> The previous v0.4 security/evidence roadmap was rejected by the product owner. It was not an accepted release direction and must not guide future work.

## North star

AI Debate Arena is a game and a model-versus-model experiment.

Two AI contenders should be able to argue, inspect the web, run code, use a growing set of tools, turn tool results into visible evidence, challenge each other, and risk match points on claims. A separate judge evaluates both the debate and how well each contender used evidence.

The interesting thing on screen is not infrastructure. It is watching two capable models decide what to do, produce proof, attack each other's claims, take risks, and win or lose.

## The three modes

- **Quick** is the current six-turn debate. Keep it fast, predictable, and simple. New agentic mechanics must not be forced into Quick.
- **Standard** is the product direction for v0.4 through v0.6. Web search, code execution, skills, evidence, stakes, live challenges, variable match length, replay, and model comparison all belong here.
- **Extreme** is reserved for later ideas. Do not design, document, or implement it until the owner explicitly starts that discussion.

Versions describe the growth of Standard Mode; they are not additional modes.

## Rules for anyone working on the project

1. Build a playable vertical slice before adding architecture around it.
2. Every work batch must end in a visible improvement to the match, setup, spectator experience, or verdict.
3. Do not create a security, compliance, hosting, persistence, migration, or observability project unless the owner explicitly asks for it.
4. Do not narrow agent capabilities because of hypothetical future deployment concerns. Agents choose tools dynamically from the match loadout.
5. Add only the minimum operational checks needed to make the current feature run reliably. Product capability comes first; hardening comes later.
6. Do not infer owner approval. A release, design, or direction is accepted only when the owner explicitly says so after seeing it.
7. Keep documentation short and current. Delete superseded plans instead of preserving a maze of stale phases and checkboxes.
8. Preserve Quick as the stable baseline, put new gameplay into Standard, and leave Extreme untouched.

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

- [ ] Remove the rejected Windows sandbox host and its dedicated test suite.
- [ ] Remove the post-match-only challenge/proof flow that does not serve the live game.
- [ ] Remove redundant evidence/security schemas and test matrices.
- [ ] Keep only reusable pieces: basic evidence identity/provenance, generic request reliability, and the HTTPS page fetcher if it can become a live agent tool.
- [ ] Remove all false release approvals and references to the rejected v0.4 direction.
- [ ] Confirm the existing v0.3.1 match still runs after cleanup.

## v0.4 — Standard: Agentic Evidence Match

### Product promise

Standard Mode becomes playable. During a live move, each contender can decide to use tools before delivering its argument. Tool activity and results are visible in the arena and become evidence the opponent and judge can inspect. Quick remains unchanged.

### First playable slice

- [ ] Add a small tool registry shared by both contenders.
- [ ] Add the agent action loop: choose a tool, receive its result, continue reasoning, then deliver the turn.
- [ ] Replace Standard's fixed turn list with the opening + open-round + closing lifecycle.
- [ ] Let each contender return a continue/ready intent so match length emerges from play.
- [ ] Add a generous match-local resource pool and basic action costs to guarantee a natural ending.
- [ ] Add `web_search` so a contender can find relevant sources without the user pasting URLs.
- [ ] Add `fetch_url` so a contender can inspect a selected source.
- [ ] Add `run_code` for useful calculations, data checks, and executable demonstrations.
- [ ] Stream tool-start, tool-result, evidence, and failure events into the existing match UI.
- [ ] Show compact evidence cards with source, excerpt/result, producing contender, and related claim.
- [ ] Give the judge the transcript plus tool-produced evidence and require the verdict to reference important evidence.
- [ ] Give both contenders the same configurable tool and time budget for a fair comparison.

### v0.4 release gate

- [ ] In one live match, both models independently use web search and code execution.
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

Standard becomes a meaningful model-comparison game: different models can use rich tool loadouts, and the product shows how they reason, research, execute, manage resources, and compete. Quick remains the fast baseline; Extreme remains untouched.

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

Once Standard's complete game loop works, give it a dedicated usability and presentation pass before discussing Extreme.

- [ ] Make the mode selector clearly explain Quick versus Standard.
- [ ] Design a variable-length match timeline instead of pretending every match has the same rounds.
- [ ] Make tools, evidence, remaining resources, readiness, stakes, challenges, and knockouts readable at a glance.
- [ ] Add satisfying research, stake, challenge, proof, win, loss, and closing moments to the broadcast presentation.
- [ ] Playtest the full Standard experience with the owner and iterate on pacing.
- [ ] Do not begin Extreme until Standard functionality and this UI/UX pass are explicitly approved.

## Later, only when explicitly requested

- Production security hardening and threat modeling.
- Authentication, accounts, permissions, and public hosting.
- Databases, migrations, backup/restore systems, and distributed workers.
- Permanent wallets, complex rating economies, or real-money wagering.
- Compliance, abuse-reporting, and enterprise administration.

These may become important after the game is compelling. They must not block proving the product first.
