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

**Implementation order (decided 2026-07-22):** Phase 2 = "maximum sustainable
spending" (shipped in v0.9.0), Phase 3 = "when can I retire?" (next up), Phase 4 = the engine phase
(melt-to-threshold + early RRIF conversion + web worker together), then backlog
knobs. Rationale: performance is currently fine, so the worker solves a problem
we don't have yet; the objective modes are pure search-layer work — high user
value, zero engine risk — while the engine phase carries the only real
regression risk and refines the *form* of answers rather than answering new
questions. Nothing in the objectives is discarded when the engine phase lands:
candidate grids swap dollars→thresholds, outer loops unchanged.

**Phase 2 — "Maximum sustainable spending" mode (specced & implemented
2026-07-22, v0.9.0).** Second member of the objective family: fix retirement
age, solve for the highest `postRetirementSpend` the plan can fund. As built:
objective-mode abstraction extracted (Phase 3 slots into it); per-candidate
deterministic bisection to $500; `withdrawalStrategy` searched in max-spend
mode only; MC success bar user-pickable 75/85/95 (default 85) enforced by an
adaptive bracket-and-refine step-down (gap-scaled steps, warm start from the
baseline rate, upward search so a low warm start can't understate) — pure
planner helpers unit-tested MC-free. Spec notes below kept for rationale.

- *Where things live:* search loop + candidate builders in
  `src/utils/meltdownOptimizer.ts` (coordinate descent over per-person
  {melt, cppStartAge, oasStartAge}; feasibility = `totalShortfall <= 1000`
  from `computeSummaryMetrics`; MC validation via `runMonteCarlo`). UI in
  `src/components/optimizer/MeltdownOptimizerView.tsx` (setup / running /
  results phases; results = before/after `DecisionTable` + ephemeral
  `ComparisonRun`s through the comparison components).
- *Mechanics:* per strategy candidate, max spend = bisection on
  `postRetirementSpend` (~10 deterministic runs to ~$500 precision;
  feasibility is monotone in spend). Compose it as the scoring function:
  rank candidates by their max sustainable spend instead of netEstateValue —
  the descent loop's shape is unchanged, each evaluation just costs ~10 runs.
- *Grid can be much coarser than the estate objective:* under max-spend, the
  voluntary melt amount matters little (deficit-driven withdrawals drain the
  RRSP anyway; melt mostly reorders taxes). The big levers are CPP/OAS
  deferral and withdrawal order — consider adding `withdrawalStrategy`
  (tax-efficient vs rrsp-first) as a searched variable here. Coarser grid
  offsets the 10x per-candidate cost; net ~2-4x today's search. This is the
  feature that starts really justifying the web worker.
- *Success bar (key design decision):* deterministic max-spend is dangerously
  optimistic and people will LIVE on this number. Bisect deterministically for
  speed, then step the spend DOWN until Monte Carlo success clears a
  user-chosen threshold (75/85/95%, conservative default). Do not bisect on
  MC success directly — at 200 iterations it wobbles a few points and the
  bisection wanders; deterministic-first + MC step-down (or extra iterations
  for only the final probes) sidesteps it.
- *UI:* objective picker on the setup screen ("Leave the largest estate" vs
  "Spend the most in retirement"). Max-spend headline: "You could sustainably
  spend $X/yr — $Y/yr more than planned"; add an "Annual spending" row to the
  before/after table; the recommended `SimulationInputs` carry the raised
  `postRetirementSpend`, so Apply/Save/comparison flows work unchanged. The
  estate default stays: it naturally penalizes both under-melting (46%+
  terminal hit) and over-melting (paying 30% now to dodge 25% later). Lifetime
  tax + clawback stays a *display metric only* — optimizing it is degenerate
  (broke people pay no tax).
- *Caveat to disclose in results:* the engine models flat inflation-adjusted
  spending; real spending is front-loaded (go-go/slow-go/no-go), so a flat
  max is conservative early and generous late. Footnote for v1; spending
  phases are their own future feature.
- *Architecture:* this and "When can I retire?" (below) are the same
  feasibility check pointed at different variables — whichever is built first
  should extract an objective-mode abstraction (objective = {decision vars,
  scoring fn, feasibility bar, headline formatter}) so the other comes nearly
  free.

**Phase 3 — "When can I retire?" mode (specced 2026-07-21).** The third member of the
objective family — all three are duals of the same feasibility check: fix two
of {retirement age, spending, estate}, solve for the third. This one: minimize
retirement age subject to the plan staying funded. Implementation is small on
top of the existing optimizer: outer bisection over `retirementAge`
(feasibility is essentially monotone in it; ~4-6 evals — the engine already
extends earnings/accumulation years automatically when the age moves), inner
check = "does ANY feasible strategy exist at this age" (reuse the meltdown
search, since delaying CPP/optimal melt can make an age feasible that naive
withdrawals can't). The key design decision is the success bar: deterministic
no-shortfall is a weak answer (assumes average returns every year) — the
honest version is a Monte Carlo threshold, user-pickable (e.g. 75/85/95% =
aggressive/balanced/conservative), and it moves the answer by years. Couples:
v1 shifts both retirement ages together; staggered retirement is a later
refinement. SEO note: "when can I retire calculator" is a far bigger query
than anything meltdown-related — when this ships it deserves its own
prerendered landing page in the /rrsp-withdrawal-strategy/ mold.

**Phase 4 — the engine phase: melt-to-threshold + early RRIF conversion + web
worker.** Take deliberately, as one phase, AFTER the objectives — and build the
regression harness first: the engine is pure and deterministic, so golden-master
tests (snapshot full year-by-year outputs for a battery of scenarios; require
the existing fixed-dollar path to stay byte-identical) catch exactly the class
of mistake this work risks. The risk is concentrated in reordering
`simulatePersonBaseYear`: melt currently computes BEFORE investment income, but
a top-up melt needs taxable-income-so-far, forcing a reorder inside a
mutation-heavy, order-dependent function. Watch: the surplus-reinvestment
"is melting" gate, couple splitting, RRIF-minimum overlap after 72, and
threshold semantics (bracket tops are *taxable*-income concepts; the OAS
clawback floor is a *net*-income concept; dividend gross-up inflates taxable).

The melt-to-threshold design itself: parameterize melt as bracket top-up, not
dollars — "withdraw enough to bring taxable income up to threshold T," T from a
small natural set (top of fed bracket 1, bracket 2, OAS clawback floor ~$93k).
New top-up mode in `simulatePersonBaseYear` alongside the fixed-amount one,
purely additive behind a new optional field (`solveGrossWithdrawal` already
does the marginal-tax/clawback gross-up math; the top-up solve is mostly
subtraction). Why it beats fixed dollars: self-adjusting (melt shrinks
automatically when CPP/OAS start, goes to zero when RRIF minimums cover the
threshold — no hard stop at CPP start, which fixed-dollar can't express),
collapses the search space (~5 thresholds instead of a dollar grid), and the
answer is explainable ("fill the 20.5% bracket from 60-70"). Move the search
into a web worker in the same phase — by then max-spend's ~10-runs-per-candidate
scoring will be stressing the chunked-main-thread pattern. Bundle the early
RRIF conversion fix (next paragraph) here too: same function, same regression
harness, and it's arguably the more important correctness change.

**Modeling gap that biases recommendations (fix in Phase 4, decide before
trusting post-65 advice):** only RRIF minimums (72+) count as eligible pension
income today — the
voluntary melt gets neither the $2,000 pension income credit nor pension income
splitting. Real-world meltdown practice partially converts RRSP→RRIF at 65
precisely to unlock both; for couples with lopsided RRSPs, splitting melt income
at 65-71 is a significant win the engine can't see, so the optimizer currently
over-favors pre-65 melting. Fix = model early RRIF conversion (treat post-65 melt
as RRIF income in `eligiblePensionIncome` and the splitting optimizer), likely
behind an explicit "convert to RRIF at 65" flag.

**Backlog knobs (any time, small).**
- "Never trigger OAS clawback" income-ceiling constraint checkbox — eating some
  clawback is often mathematically optimal but users viscerally hate it; the
  knob is cheap and builds trust.
- Retirement-age bounds as an opt-in decision variable in the estate objective
  (lifestyle choice, don't search it by default; distinct from Phase 3, which
  *solves for* the age).

**SEO landing page — shipped 2026-07-21** at `/rrsp-withdrawal-strategy/`
(prerendered MPA route in the how-it-works mold; vite.config.ssr.ts and
scripts/prerender.mjs were generalized to N pages). Leads with "RRSP
Withdrawal Strategy Calculator" (broader head term than "meltdown"), with
meltdown/decumulation as prominent secondary terms; FAQPage JSON-LD; CTA
deep-links into the optimizer via `?optimize=1` (captured/stripped in
Dashboard like the wizard's `?setup=1`; `#start=` share links win). Future
SEO follow-ups: watch Search Console for whether "meltdown"-flavoured queries
justify a second, meltdown-titled page or an H1 tweak.

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
