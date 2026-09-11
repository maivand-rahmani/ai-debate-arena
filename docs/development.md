# Development

Tested on Node 22 + npm 11. No `.env` needed; provider secrets live in the
`0600` JSON store, never in env files.

## Checks

Run focused checks while iterating. Run the full set below when a coherent
playable milestone is ready, not after every small edit.

```bash
npm install    # once: installs all workspaces (apps/*, packages/*)
npm run lint       # eslint .
npm run typecheck  # typecheck --workspaces
npm test           # test --workspaces
npm run build      # builds @arena/web
```

Per-workspace runs (same commands, scoped):

```bash
npm -w @arena/web run dev            # Next development server
npm -w @arena/web run test           # web suite only
npm -w @arena/debate-engine run test # engine suite only
npm -w @arena/ai run typecheck       # single-package check
```

## Iteration workflow

Start with the user-visible flow, wire the smallest implementation through the
runner and UI, and watch it in the browser. Add architecture only when the
working slice proves that it is needed. `TODO.md` and the repository-level
`AGENTS.md` are the current product and testing rules.

## 3D visual changes

Read [`arena-visual-system.md`](arena-visual-system.md) before changing the
broadcast stage. The active scene is procedural and client-only until final
GLBs arrive; the GLB manifest/loader is an extension boundary, not permission
to add missing-file requests to the default runtime. Keep screen glass facing
the seated players, keep workstation cables and props attached to the layout,
and keep visual meshes separate from Rapier colliders. Any change to seating,
monitor distance, banner framing, floor geometry, camera framing, or lights
must update the focused 3D tests and receive a live desktop preview.

Focused checks:

```bash
npm -w @arena/web run test -- src/widgets/broadcast-stage/3d
npm -w @arena/web run typecheck
npm -w @arena/web run lint -- src/widgets/broadcast-stage/3d
npm -w @arena/web run build
```

## Tests

There is no test-count or coverage target. Add a small number of tests that
protect game rules, scoring, event order, or a real regression. Do not mirror
the same contract exhaustively across layers and do not build test matrices for
hypothetical infrastructure.

| File                                                        | Covers                                              |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `packages/debate-engine/tests/debate.test.ts`               | Phase progression, judge JSON accept/reject         |
| `packages/debate-engine/tests/state.test.ts`                | `appendTurn` immutability, `attachVerdict` finish   |
| `packages/debate-engine/tests/verdict.test.ts`              | Criteria present/missing/invalid                    |
| `packages/debate-engine/src/token-policy.ts` (`token-policy.test.ts`) | Quick six-turn limits, per-policy budgets, tier scaling |
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

## Adding a match format

1. Define its ordered `MatchTurnSpec` entries in
   `packages/types/src/match-format.ts`; use stable IDs and an existing
   semantic role (`opening` or `response`) where possible.
2. Register the format in `MATCH_FORMATS` and give it an explicit profile in
   `packages/debate-engine/src/token-policy.ts`. Keep it disabled until its
   product rules and evaluation evidence are approved.
3. Add a role-specific prompt rule only when the existing opening/response
   instruction is not sufficient.
4. Add the smallest focused runner/UI test that protects the new behavior.
5. Update `docs/debate-engine.md`, this guide, and `TODO.md` with the format's
   order, limits, and compatibility expectations.

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
