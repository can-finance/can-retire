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

**Verification is scoped to what a human glance cannot catch.** The orchestrator
always reviews the diff. Beyond that:

- **Logic with a non-obvious failure mode** — tax rules and `src/engine/**`,
  `summaryMetrics`, persistence and sanitizers, history/state machines, anything
  that moves a projected number: full gate. Typecheck AND `npm test` in the
  Docker dev container, and WRITE tests for the new behaviour. Especially for
  haiku/sonnet work. A wrong number or a broken Back button looks exactly like a
  right one, which is precisely when a test earns its cost.
- **Simple UI changes** — layout, styling, alignment, colour, copy, labels,
  markup structure, component arrangement: typecheck only. Do NOT run the
  regression suite, do NOT run browser/`javascript_tool` verification (including
  when a PostToolUse hook suggests it), and do NOT write new tests. The user
  reviews every change visually as it lands and is faster at it than a Docker
  vitest run.

When a change is a mix, test the logic half and leave the presentation half
alone. Report plainly when something is unverified rather than substituting
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
