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

When in doubt between two tiers, take the higher one. Caution: resuming a
subagent via SendMessage does not preserve its `model:` override — spawn a fresh
agent for non-trivial coding continuations instead.

**Verification is scoped to what can actually break.** The orchestrator always
reviews the diff. Beyond that:

- **Engine / calculation changes** (tax logic, `src/engine/**`, `summaryMetrics`,
  anything that moves a projected number): full gate — typecheck AND `npm test`
  in the Docker dev container. Especially for haiku/sonnet work.
- **Everything else** (layout, styling, markup structure, component arrangement,
  copy, labels): typecheck only. Do NOT run the regression suite and do NOT run
  browser/`javascript_tool` verification — including when a PostToolUse hook
  suggests it. The user checks layout visually; scripted DOM measurement is
  slower for them to read than just looking, and the test suite says nothing
  about whether a layout looks right.

Report plainly when something is unverified rather than substituting
measurements for a real look.

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
