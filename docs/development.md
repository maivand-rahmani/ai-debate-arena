# Development

Tested on Node 22 + npm 11. No `.env` needed; provider secrets live in the
`0600` JSON store, never in env files.

## Checks (run all before submitting)

```bash
npm run lint       # eslint .
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run build      # next build
```

## Tests (18 across 7 files, `vitest run`, node env)

| File                                              | Covers                                              |
| ------------------------------------------------- | --------------------------------------------------- |
| `entities/debate/debate.test.ts`                  | Phase progression, judge JSON accept/reject         |
| `entities/debate/state.test.ts`                   | `appendTurn` immutability, `attachVerdict` finish   |
| `entities/debate/verdict.test.ts`                 | Criteria present/missing/invalid                    |
| `shared/token-policy.test.ts`                     | Quick P0 limits, per-policy budgets, tier scaling   |
| `shared/config/provider.test.ts`                  | Schema validation, key redaction                    |
| `shared/api/llm/errors.test.ts`                   | Safe-error mapping, no key/URL leakage              |
| `features/run-debate/server/debate-runner.test.ts` | Event order via stubbed model, error→done           |

The runner test stubs `deps.callModel`, so no network or `server-only`
imports execute under vitest.

## Adding a phase end-to-end

1. `entities/debate/types.ts` — extend `DebatePhase` (and turn-phase union).
2. `entities/debate/state.ts` — add the `NEXT_PHASE` edge.
3. `entities/debate/prompts.ts` — add its one-line `PHASE_INSTRUCTIONS`.
4. `features/run-debate/server/debate-runner.ts` — extend `AGENT_PHASES`.
5. `docs/debate-engine.md` — extend the stream contract (byte-identical rest).
6. `features/run-debate/lib` + `ui` — handle the new phase in reducer/panels.

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
- Secret sweep (2026-09-04): no real keys in tracked files or history (only `sk-FAKE*` placeholders in `src/shared/api/llm/errors.test.ts`); secret store `providers.json` lives outside the repo and is untracked.
