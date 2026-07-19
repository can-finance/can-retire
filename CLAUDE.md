# CLAUDE.md

## Orchestration & delegation

The main session model plans, orchestrates, reviews, and verifies. It MAY make
trivial single-file edits directly (an exactly-known one-liner or copy tweak in a
file it has already read) — spawning an agent for those costs more than it saves.
Everything larger is delegated to subagents (Agent tool) with an explicit
`model:` picked by task complexity:

- **haiku/sonnet** — well-scoped changes: a component or function following
  existing patterns, simple tests, small refactors, fully-specified copy/UI
  work. Batch several small related edits into ONE agent call rather than one
  agent per tweak — the cold-start overhead is flat per agent.
- **opus** — anything with real design judgment or risk: engine/tax-logic
  changes, multi-file features, subtle refactors, tricky test design.

When in doubt between two tiers, take the higher one. The orchestrator always
verifies the result itself (diff review, typecheck, tests in the Docker dev
container) — especially for haiku/sonnet work. Caution: resuming a subagent via
SendMessage does not preserve its `model:` override — spawn a fresh agent for
non-trivial coding continuations instead.

**Why:** cost/usage management — match model cost to task difficulty and keep the
expensive orchestrator tier for planning and review; but flat per-agent overhead
(~30k+ tokens of cold-start context) makes delegation a net loss for one-liners
(relaxed 2026-07-18 after reviewing session token accounting).

## Changelog policy

CHANGELOG.md records **user-facing impact only**: new features, behavior changes
that alter results or workflows, and fixes to visible bugs. Do not add entries for
internal refactors, test/CI/dev-tooling work, performance tweaks, code comments,
or minor label/text edits — git history carries that detail. When in doubt, ask:
"would a user of craptool.ca notice or care?" If not, leave it out. Keep entries in
Keep-a-Changelog sections (Added / Changed / Fixed) and note when a change alters
previously computed projections.
