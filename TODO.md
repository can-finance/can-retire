# TODO

## Feature ideas

### RRSP meltdown optimizer
Recommend when to retire and how much RRSP/RRIF to decumulate in which years,
rather than the user hand-tuning `rrspMeltStartAge`/`rrspMeltAmount` by eye.
Pure search loop over existing engine inputs (`src/utils/meltdownOptimizer.ts`
+ `MeltdownOptimizerView`), no engine changes — an objective-mode abstraction
lets each mode define its own decision variables, scoring, and feasibility bar
over one shared coordinate-descent search. Two objective modes have shipped:
v1 (maximize net estate, v0.8.0) and Phase 2 (max sustainable spend, v0.9.0).
Phase 2's success-bar machinery is the pattern Phase 3 should reuse — a
user-pickable 75/85/95% MC bar enforced by an adaptive bracket-and-refine
step-down (gap-scaled steps, baseline-rate warm start, upward search so a low
warm start can't understate the answer), with the planner logic kept pure and
unit-tested MC-free.

- **Phase 3 — "When can I retire?" (next up).** See spec below.
- **Phase 4 — the engine phase.** See spec below.

**Implementation order (decided 2026-07-22):** Phase 3, then Phase 4 (engine
work), then backlog knobs. Rationale: performance is currently fine, so the
worker solves a problem we don't have yet; Phase 3 is pure search-layer work —
high user value, zero engine risk — while the engine phase carries the only
real regression risk and refines the *form* of answers rather than answering
new questions. Nothing in the objectives is discarded when the engine phase
lands: candidate grids swap dollars→thresholds, outer loops unchanged.

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
income today — the voluntary melt gets neither the $2,000 pension income credit
nor pension income splitting. Real-world meltdown practice partially converts RRSP→RRIF at 65
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

**SEO follow-up:** watch Search Console for whether "meltdown"-flavoured
queries justify a second, meltdown-titled page alongside the shipped
`/rrsp-withdrawal-strategy/`, or just an H1 tweak there.

**Free from the engine** (for reference): RRIF minimums 71+, balance caps, TFSA
room, terminal full inclusion, spousal rollover, melt destination TFSA-first then
non-reg surplus sweep via `receivesSurplus`.

### Year audit view — Phase 2
V1 shipped in v0.11.0; full plan in `docs/year-audit-plan.md`. Remaining:
Phase 2 "show the tax math" — re-run the pure `tax.ts` functions per year for a
bracket-by-bracket display. Known residual to fix or disclose: the withdrawal
solver's tax estimate still omits the pension/dividend/payroll credit arguments
`getFinalStats` uses (~$275 worst-year cash-flow residual in the default
scenario).

### Monte Carlo realism — class-specific volatility (from 2026-07-18 discussion)
Current model: a single `volatility` drives one lognormal draw applied identically
to `capitalGrowth`/`rrspGrowth`/`tfsaGrowth`; the dividend slices ride that same
draw at a fixed beta; the interest/bond and cash slices pay a fixed yield and their
principal never moves.

What's already done (v0.11.0): lognormal draws (volatility drag modelled, sub-−100%
returns impossible), and price appreciation on the dividend and foreign-dividend
slices at `DIVIDEND_EQUITY_BETA * (capitalGrowth − yield)`, beta = 0.85
(`projection.ts`, `growNonReg`). Because `capitalGrowth` is the shocked draw and the
yields are unshocked, those slices already carry an effective market beta of ~0.85 —
so the *correlation* half of the one-factor model is in place.

What remains is per-class sigma, not per-class price growth:
- Shock slice *balances*, not yields — dividend stocks and bonds have stable income
  but volatile prices. One market draw `Z` per year: capital-gain slice at ~15% vol
  × Z, dividend slice at ~13% vol × Z. Beta 0.85 was chosen to match that
  13%-vs-15% relationship; keep the two consistent if either moves.
- Give the interest/bond slice its own small independent draw (~5% vol for bond
  funds, ~0 for GICs) — but do NOT give every class an independent draw;
  uncorrelated shocks fake a diversification benefit and inflate success rates.
- Implementation notes: the slice-weight renormalization for uneven slice growth
  already exists (`projection.ts`, `growNonReg`) and covers the dividend slices;
  each slice's price rate is floored at −100% so a blended growth factor can never
  go negative; ACB stays untouched (price moves are unrealized); keep yield income
  consistently on pre- or post-shock balances (today it is charged on the
  start-of-year balance in Step 1, before Step 6 growth).
- Yield-only volatility (shocking `returnRates.interest`/`dividend`) was considered
  and rejected — barely widens the fan, models the wrong risk.

## Low priority / deferred

Deferred items, none blocking release. Context for the onboarding ones below: the
wizard edits a seeded draft; Save commits `retirement_sim_v2` exactly once;
Skip/Cancel writes nothing; storage hooks never write on mount (first-run
eligibility depends on key absence).

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

### GIS not modeled — blind spot to disclose in the UI
For low-income households, pre-65 meltdown is often about protecting GIS
eligibility, and the optimizer's recommendations can't capture that. A footnote
near the optimizer results is probably enough; silence is not. The
`/rrsp-withdrawal-strategy/` page already carries a GIS caution, so the gap is
specifically the results view.

### Pre-existing mobile horizontal overflow
The year-by-year breakdown table (~1000px min width) forces horizontal scroll on
phones. Predates the onboarding work. Options: responsive column hiding, a
scroll-container with sticky first columns, or a card layout under `sm:`. Independent
of everything above.
