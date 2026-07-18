# TODO

## Feature ideas

Build order (decided 2026-07-18): named scenario storage -> scenario comparison
page -> meltdown optimizer. The optimizer's results view is just a comparison with
a machine-generated scenario, and hand-tweaked comparisons are the ground truth for
validating the optimizer's recommendations before trusting the search.

### Scenario comparison page
Side-by-side comparison of two or more saved scenarios: success rate, ending/estate
values, lifetime tax paid, year money runs out, income by source. Needs a way to
save named scenarios first (current storage holds a single plan under
`retirement_sim_v2`), then a comparison view — table of headline metrics plus
overlaid net-worth / Monte Carlo fan charts.

### RRSP meltdown optimizer
Recommend when to retire and how much RRSP/RRIF to decumulate in which years,
rather than the user hand-tuning `rrspMeltStartAge`/`rrspMeltAmount` by eye.
Fleshed out 2026-07-18; mostly a search loop over existing engine inputs.

**Decision variables** (per person): melt start age, melt end (or until exhausted),
melt size; household-level and opt-in: retirement age, CPP/OAS start ages (CPP
timing interacts strongly — delaying CPP to 70 creates the cheap-melt window).

**Parameterize melt as bracket top-up, not dollars**: "withdraw enough to bring
taxable income up to threshold T," T from a small natural set (top of fed bracket 1,
bracket 2, OAS clawback floor ~$91k). Tiny discrete grid (~5 thresholds x ~15 start
ages x 2 people = a few thousand engine runs, few ms each — web worker), the answer
is explainable ("fill the 20.5% bracket from 60-70"), and it self-adjusts as
CPP/RRIF minimums ramp in. Requires adding a top-up melt mode to the engine
alongside the fixed-amount one — the main new engine work.

**Objective** (user picks; default = maximize net estate value after terminal tax —
it naturally penalizes both under-melting (46%+ terminal hit) and over-melting
(paying 30% now to dodge 25% later)). Alternatives: maximize sustainable spending
(outer bisection on `postRetirementSpend`); lifetime tax + clawback is a *display
metric only* — optimizing it is degenerate (broke people pay no tax).

**Constraints.** Free from the engine: RRIF minimums 71+, balance caps, TFSA room,
terminal full inclusion, spousal rollover. Optimizer must enforce: no shortfall
(deterministic, same $1k tolerance as `runMonteCarlo`); MC-validate only the winner
+ runners-up rather than every candidate (200 iters x thousands of candidates is too
slow). Optional user knobs: income ceiling ("never trigger OAS clawback"),
retirement-age bounds (opt-in — it's a lifestyle choice), co-optimize CPP toggle.
Melt destination = TFSA-first then non-reg as a fixed rule (surplus-sweep machinery
already exists via `receivesSurplus`).

**New UI**: objective picker, the optional constraint knobs, and a results view
showing recommendation vs baseline (estate delta, lifetime tax delta, year-by-year
melt schedule). Overlaps with the scenario comparison page — design together.

### Monte Carlo realism (from 2026-07-18 discussion)
Current model: single `volatility`, one normal shock added identically to
`capitalGrowth`/`rrspGrowth`/`tfsaGrowth`; interest & dividend slices pay a fixed
yield and their principal never moves.
- **Lognormal draws** (do first, cheap): replace `mean + vol*Z` with
  `exp(mu + sigma*Z) - 1`, `mu = ln(1+mean) - sigma^2/2`. Fixes the missing
  volatility drag on median outcomes and makes sub-−100% returns impossible.
- **Per-asset-class price volatility** (one-factor model): shock slice *balances*,
  not yields — dividend stocks and bonds have stable income but volatile prices.
  One market draw `Z` per year: capital-gain slice at ~15% vol × Z, dividend slice
  at ~13% vol × Z (dividend stocks are ~0.85+ market-correlated), interest/bond
  slice with its own small independent draw (~5% vol for bond funds, ~0 for GICs).
  Do NOT give each class an independent draw — uncorrelated shocks fake a
  diversification benefit and inflate success rates. Implementation notes: the
  slice-weight renormalization for uneven slice growth already exists
  (`projection.ts` ~line 747) and generalizes; ACB stays untouched (price moves are
  unrealized); keep yield income consistently on pre- or post-shock balances.
  Yield-only volatility (shocking `returnRates.interest`/`dividend`) was considered
  and rejected — barely widens the fan, models the wrong risk.

## Low priority / deferred

Deferred items, none blocking release. Context: the onboarding wizard edits a seeded
draft; Save commits `retirement_sim_v2` exactly once; Skip/Cancel writes nothing;
storage hooks never write on mount (first-run eligibility depends on key absence).

### Corrupt-storage self-healing
`hasSavedPlan()` now validates the stored plan (so relaunch copy is honest), but a
corrupt `retirement_sim_v2` blob is never auto-repaired — it persists until the user
edits something (any edit overwrites it with sanitized state). Reaching this state
realistically requires devtools tampering or storage corruption, so: fix only if a
real report surfaces. A repair would live in `usePersistentState`'s initializer
(write back the sanitized fallback when parse/sanitize fails) — but note that
re-introducing ANY mount-time write must not break first-run onboarding eligibility
(see `src/utils/onboarding.ts` and the `hasChanged` gate in
`src/hooks/usePersistentState.ts`).

### Wizard-behind perf
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

### Refresh-mid-wizard draft persistence
A page refresh mid-wizard silently discards typed-but-unsaved entries (the commit
contract stays intact; storage is never half-written). If wanted: persist the draft +
screen/step under a `retirement_onboarding_draft_v1` key on step transitions, offer
"Continue where you left off?" on the intro, delete the key on Save/Skip. Decided
2026-07-17 to ship without it and see whether anyone misses it.

### Playwright / E2E smoke
The only onboarding behaviors without automated coverage are browser-physical ones —
scroll locking, focus restoration, mobile header layout — currently verified
manually. A minimal Playwright smoke (fresh visitor → quick start → save → reload;
mobile viewport pass) is worth adding around v1.0; not before (new toolchain + CI
cost).

### Pre-existing mobile horizontal overflow
The year-by-year breakdown table (~1000px min width) forces horizontal scroll on
phones. Predates the onboarding work. Options: responsive column hiding, a
scroll-container with sticky first columns, or a card layout under `sm:`. Independent
of everything above.
