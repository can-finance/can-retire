# CLAUDE.md

## Orchestration & delegation

The main session model plans, orchestrates, reviews, and verifies — it does not
write implementation code itself. Delegate code-writing to subagents (Agent tool)
with an explicit `model:` picked by task complexity:

- **haiku** — trivial mechanical edits: renames, copy changes, config tweaks,
  applying an exactly-specified one-liner.
- **sonnet** — routine well-scoped changes: a component or function following
  existing patterns, simple tests, small refactors, fully-specified copy/UI work.
- **opus** — anything with real design judgment or risk: engine/tax-logic
  changes, multi-file features, subtle refactors, tricky test design.

When in doubt between two tiers, take the higher one. The orchestrator always
verifies the result itself (diff review, typecheck, tests in the Docker dev
container) — especially for haiku/sonnet work. Caution: resuming a subagent via
SendMessage does not preserve its `model:` override — spawn a fresh agent for
coding continuations instead.

**Why:** cost/usage management — match model cost to task difficulty and keep the
expensive orchestrator tier for planning and review.

## Changelog policy

CHANGELOG.md records **user-facing impact only**: new features, behavior changes
that alter results or workflows, and fixes to visible bugs. Do not add entries for
internal refactors, test/CI/dev-tooling work, performance tweaks, code comments,
or minor label/text edits — git history carries that detail. When in doubt, ask:
"would a user of craptool.ca notice or care?" If not, leave it out. Keep entries in
Keep-a-Changelog sections (Added / Changed / Fixed) and note when a change alters
previously computed projections.
