# TODO

## Feature ideas

Build order (decided 2026-07-18): named scenario storage -> scenario comparison
page -> meltdown optimizer. All three now exist (optimizer v1 2026-07-21). The
optimizer's results view is just a comparison with a machine-generated scenario,
and hand-tweaked comparisons are the ground truth for validating the optimizer's
recommendations before trusting the search.

### Scenario comparison page
Side-by-side comparison of two or more saved scenarios: success rate, ending/estate
values, lifetime tax paid, year money runs out, income by source. Needs a way to
save named scenarios first (current storage holds a single plan under
`retirement_sim_v2`), then a comparison view — table of headline metrics plus
overlaid net-worth / Monte Carlo fan charts.

### RRSP meltdown optimizer
Recommend when to retire and how much RRSP/RRIF to decumulate in which years,
rather than the user hand-tuning `rrspMeltStartAge`/`rrspMeltAmount` by eye.
Fleshed out 2026-07-18.

**v1 implemented 2026-07-21** (`src/utils/meltdownOptimizer.ts` +
`MeltdownOptimizerView`): pure search loop over EXISTING engine inputs, no engine
changes. Decision variables per person: fixed-dollar annual melt amount (grid
scaled to RRSP balance and window, coarse pass + refinement; melt start fixed at
retirement age) and — on by default, with an opt-out toggle — CPP start age
{60, 65, 70} and OAS start age {65, 70}, filtered to ages the person hasn't
already passed. Couples use coordinate descent (sweep one person's sub-grid
holding the other fixed, ≤3 sweeps). Objective: maximize `netEstateValue`;
constraint: `totalShortfall` ≤ $1k; MC-validate winner + top runners-up only,
demote a winner whose success rate drops >1pt below baseline. Results render
through the comparison components as ephemeral runs (baseline vs "Suggested
meltdown") with a plain-language recommendation card and Save-as-plan. Search
runs chunked on the main thread with progress + AbortSignal.

**v2 — melt-to-threshold (the big one).** Parameterize melt as bracket top-up, not
dollars: "withdraw enough to bring taxable income up to threshold T," T from a
small natural set (top of fed bracket 1, bracket 2, OAS clawback floor ~$93k).
Requires a top-up melt mode in `simulatePersonBaseYear` alongside the fixed-amount
one — the main new engine work (`solveGrossWithdrawal` already does the
marginal-tax/clawback gross-up math). Why it beats fixed dollars: self-adjusting
(melt shrinks automatically when CPP/OAS start, goes to zero when RRIF minimums
cover the threshold — no hard stop at CPP start, which fixed-dollar v1 can't
express), collapses the search space (~5 thresholds instead of a dollar grid),
and the answer is explainable ("fill the 20.5% bracket from 60-70"). Move the
search into a web worker at the same time — the v1 chunked-main-thread pattern
won't scale to threshold × start-age × 2-person grids with MC validation.

**v3 — more knobs and objectives.**
- Objective picker: default stays net estate after terminal tax (naturally
  penalizes both under-melting (46%+ terminal hit) and over-melting (paying 30%
  now to dodge 25% later)); alternative = maximize sustainable spending (outer
  bisection on `postRetirementSpend`). Lifetime tax + clawback stays a *display
  metric only* — optimizing it is degenerate (broke people pay no tax).
- "Never trigger OAS clawback" income-ceiling constraint checkbox — eating some
  clawback is often mathematically optimal but users viscerally hate it; the
  knob is cheap and builds trust.
- Retirement-age bounds as an opt-in decision variable (lifestyle choice, don't
  search it by default).

**Modeling gap that biases recommendations (decide before trusting post-65
advice):** only RRIF minimums (72+) count as eligible pension income today — the
voluntary melt gets neither the $2,000 pension income credit nor pension income
splitting. Real-world meltdown practice partially converts RRSP→RRIF at 65
precisely to unlock both; for couples with lopsided RRSPs, splitting melt income
at 65-71 is a significant win the engine can't see, so the optimizer currently
over-favors pre-65 melting. Fix = model early RRIF conversion (treat post-65 melt
as RRIF income in `eligiblePensionIncome` and the splitting optimizer), likely
behind an explicit "convert to RRIF at 65" flag.

**SEO landing page (proposed 2026-07-21, not yet approved):** a prerendered MPA
route like `/rrsp-meltdown/` in the CPP-calculator mold (vite.config.ssr.ts +
scripts/prerender.mjs already support this). "RRSP meltdown" is a high-intent,
advice-shaped Canadian query where competitors are mostly advisor blog posts,
not interactive tools; the SPA dashboard itself can't rank for it (the
optimizer is view state, not a URL). Title should lead with "RRSP Meltdown
Calculator" ("calculator" is what people search; "optimizer" isn't). Content:
what a meltdown is, when it helps/hurts, OAS-clawback and GIS caveats, then a
CTA deep-linking into the app's optimizer — needs a `?optimize=1` query param
handled like the wizard's `?setup=1`.

**Known blind spot to disclose in the UI:** GIS is not modeled. For low-income
households, pre-65 meltdown is often about protecting GIS eligibility — the
optimizer's recommendations can't capture that. A footnote near the results is
probably enough; silence is not.

**Free from the engine** (for reference): RRIF minimums 71+, balance caps, TFSA
room, terminal full inclusion, spousal rollover, melt destination TFSA-first then
non-reg surplus sweep via `receivesSurplus`.

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
