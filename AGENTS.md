# AI Debate Arena — Instructions for Coding Agents

Read `TODO.md` before planning work. It contains the current product direction.

## Product-first directive

AI Debate Arena is a game about two capable AI models competing with arguments, tools, evidence, challenges, and stakes. The user's priority is a compelling playable match, not infrastructure.

- Quick Mode is the existing fixed six-turn debate and should remain stable.
- All v0.4–v0.6 gameplay work belongs to Standard Mode.
- Standard has variable match length driven by agent decisions, tool/action spending, stakes, and match-local resources rather than a predetermined turn count.
- Extreme Mode is reserved. Do not invent requirements or roadmap tasks for it until the user explicitly asks.
- Through v0.6, add only enough UI to make new Standard mechanics usable and understandable. The dedicated Standard UI/UX pass comes after the full loop works and before any Extreme work.
- Build the smallest end-to-end playable feature first and show its visible result.
- Web search, code execution, and extensible tool use are core product capabilities. Do not replace them with user-pasted evidence, hash checks, post-match review forms, or deny-by-default capability architecture.
- Do not start security, compliance, authentication, hosting, persistence, migration, backup, distributed-worker, or observability initiatives unless the user explicitly requests them.
- Minimal reliability work that is necessary for the current feature is allowed. It must stay subordinate to the playable outcome.
- Never claim or record user approval, review, sign-off, or acceptance unless the user explicitly provided it after seeing the result.

## Keep work small

- Before a broad refactor or a large cross-cutting batch, implement one working vertical slice.
- Do not expand the roadmap on your own. Record only work needed for the currently approved product milestone.
- Do not preserve obsolete plans for historical completeness; Git already preserves history.
- Avoid speculative abstractions and adapters without a current caller.

## Testing

- There is no test-count or coverage target.
- Add a few high-value tests for game rules, scoring, event ordering, and regressions.
- Do not create thousands of lines of repetitive contract, schema, security, denial, cleanup, or hypothetical-platform tests.
- Prefer a working browser demonstration of the complete flow over a large synthetic test matrix.
- Run focused checks during implementation and the full existing suite at coherent milestones.

## Current rejected work

The security-oriented v0.4 prototype committed after `d3aa378` is not an accepted product direction. Reuse only pieces that directly support the live agentic match. Do not treat its completed checkboxes or security documents as requirements.
