# TODO — low priority

Deferred items, none blocking release. Context: the onboarding wizard edits a seeded
draft; Save commits `retirement_sim_v2` exactly once; Skip/Cancel writes nothing;
storage hooks never write on mount (first-run eligibility depends on key absence).

## Corrupt-storage self-healing
`hasSavedPlan()` now validates the stored plan (so relaunch copy is honest), but a
corrupt `retirement_sim_v2` blob is never auto-repaired — it persists until the user
edits something (any edit overwrites it with sanitized state). Reaching this state
realistically requires devtools tampering or storage corruption, so: fix only if a
real report surfaces. A repair would live in `usePersistentState`'s initializer
(write back the sanitized fallback when parse/sanitize fails) — but note that
re-introducing ANY mount-time write must not break first-run onboarding eligibility
(see `src/utils/onboarding.ts` and the `hasChanged` gate in
`src/hooks/usePersistentState.ts`).

## Wizard-behind perf
Two deliberate trade-offs from the peek-first design, revisit only if low-end users
report jank:
- The invisible Dashboard stays mounted (full DOM + recharts ResizeObservers) during
  the opaque wizard steps — potentially ~10 min of Full setup. Unmounting or
  `content-visibility: hidden` would save memory/resize work but reintroduces the
  mount-timing complexity the current design paid down.
- The intro's first paint waits on the full dashboard render behind the scrim (the
  heaviest render of the session lands on 40%-visible pixels). Could defer the
  background mount a beat (startTransition / idle callback) to make the intro card
  paint first.

## Refresh-mid-wizard draft persistence
A page refresh mid-wizard silently discards typed-but-unsaved entries (the commit
contract stays intact; storage is never half-written). If wanted: persist the draft +
screen/step under a `retirement_onboarding_draft_v1` key on step transitions, offer
"Continue where you left off?" on the intro, delete the key on Save/Skip. Decided
2026-07-17 to ship without it and see whether anyone misses it.

## Playwright / E2E smoke
The only onboarding behaviors without automated coverage are browser-physical ones —
scroll locking, focus restoration, mobile header layout — currently verified
manually. A minimal Playwright smoke (fresh visitor → quick start → save → reload;
mobile viewport pass) is worth adding around v1.0; not before (new toolchain + CI
cost).

## Pre-existing mobile horizontal overflow
The year-by-year breakdown table (~1000px min width) forces horizontal scroll on
phones. Predates the onboarding work. Options: responsive column hiding, a
scroll-container with sticky first columns, or a card layout under `sm:`. Independent
of everything above.
