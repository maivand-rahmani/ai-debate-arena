# Development

Tested on Node 22 + npm 11. No `.env` needed; provider secrets live in the
`0600` JSON store, never in env files.

## Checks (run all before submitting, from the repo root)

```bash
npm install    # once: installs all workspaces (apps/*, packages/*)
npm run lint       # eslint .
npm run typecheck  # typecheck --workspaces
npm test           # test --workspaces
npm run build      # builds @arena/web
```

Per-workspace runs (same commands, scoped):

```bash
npm -w @arena/web run dev            # Next dev server
npm -w @arena/web run test           # web suite only
npm -w @arena/debate-engine run test # engine suite only
npm -w @arena/ai run typecheck       # single-package check
```

## Tests (33 files, `npm test` runs every workspace suite, node env)

| File                                                        | Covers                                              |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `packages/debate-engine/tests/debate.test.ts`               | Phase progression, judge JSON accept/reject         |
| `packages/debate-engine/tests/state.test.ts`                | `appendTurn` immutability, `attachVerdict` finish   |
| `packages/debate-engine/tests/verdict.test.ts`              | Criteria present/missing/invalid                    |
| `packages/debate-engine/src/token-policy.ts` (`token-policy.test.ts`) | Quick P0 limits, per-policy budgets, tier scaling |
| `apps/web/src/shared/config/provider.test.ts`               | Schema validation, key redaction                    |
| `packages/ai/tests/errors.test.ts`                          | Safe-error mapping, no key/URL leakage              |
| `packages/debate-engine/tests/runner.test.ts`               | Event order via stubbed model, error→done           |

The runner test stubs `deps.callModel`, so no network or `server-only`
imports execute under vitest.

## Judge eval (rubric v1 vs v2, F9-25)

```bash
npx tsx apps/web/scripts/judge-eval.mjs                        # full run: 6 fixtures x v1/v2 = 12 judge calls
npx tsx apps/web/scripts/judge-eval.mjs --dry-run              # plan only: no network, no file writes
npx tsx apps/web/scripts/judge-eval.mjs "--only=clear-A,1"     # retry one fixture,version cell (quote the flag in PowerShell)
```

Scripts live in `apps/web/scripts/` — always run them from the repo root
(the eval report path and `@/` alias resolve from there).

Each case runs the golden transcript through the production `runJudge`
pipeline against the configured provider (default: first entry in the
provider store; override with `--provider=` / `--model=` or
`AI_DEBATE_EVAL_PROVIDER` / `AI_DEBATE_EVAL_MODEL`). Results append to
`docs/eval/rubric-v1-vs-v2.md` as one section per run (`ERROR` cells on
per-case failure, run continues). `npm run eval:judge` is the same entry
point; on some npm versions `--args` are not forwarded, so prefer `npx tsx`
when passing flags. `AI_DEBATE_EVAL_DEBUG=1` prints raw judge output on
failing cases.

## Adding a phase end-to-end

1. `packages/debate-engine/src/types.ts` — extend `DebatePhase` (and turn-phase union).
2. `packages/debate-engine/src/state.ts` — add the `NEXT_PHASE` edge.
3. `packages/debate-engine/src/prompts/agent-prompt.ts` — add or update its
   phase-specific instruction and bump `AGENT_PROMPT_VERSION` for wording changes.
4. `packages/debate-engine/src/runner.ts` — extend `AGENT_PHASES`.
5. `docs/debate-engine.md` — extend the stream contract (byte-identical rest).
6. `apps/web/src/features/run-debate/lib` + `ui` — handle the new phase in reducer/panels.

## Build note

`next build` emits one expected Turbopack warning: dynamic filesystem access
in `provider-store.ts` (traced from `/api/providers`) pulls the project into
tracing. Harmless for this local app — no action needed.

## Clean-install verification

- Date: 2026-09-04 (UTC); fresh clone → temp `clean-install-check2`, documented flow (`npm install`).
- Env: node v22.13.1, npm 11.5.2.
- `npm install` — pass (~16s, 511 packages audited, 0 vulnerabilities).
- `npm run typecheck` (`tsc --noEmit`) — pass (~4s).
- `npx vitest run` — FAIL (exit 1, ~1.5s; rolldown startup error: `Cannot find native binding` / `Cannot find module '@rolldown/binding-wasm32-wasi'` via `./rolldown-binding.wasi.cjs`; captured as-is, no workaround applied).
- `npm run build` (`next build`) — pass (~15s; only the expected Turbopack dynamic-filesystem-access warning in `provider-db.ts`).
- Note: `npm ci` currently hits the same npm optional-dependencies bug for rolldown native bindings on this platform (workaround: use `npm install`).
- Secret sweep (2026-09-04): no real keys in tracked files or history (only `sk-FAKE*` placeholders in the safe-error tests, now `packages/ai/tests/errors.test.ts`); secret store `providers.json` lives outside the repo and is untracked.
