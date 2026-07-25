# Changelog

All notable changes to the Canadian Retirement Asset Planning tool are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Monte Carlo simulations now draw yearly returns lognormally.** The old model
  added a symmetric shock to the return, which ignored the drag that swings put
  on compound growth and could even produce a year worse than losing everything.
  Median outcomes and success rates shift slightly lower now that volatility drag
  is modelled correctly, and returns can no longer fall below −100%. Deterministic
  projections are unchanged; optimizer recommendations validated against Monte
  Carlo may shift.

### Fixed
- **The projected net estate no longer double-counts the terminal tax bill.** The
  tax due on the deemed disposition at death was subtracted twice — once from the
  account balances and again from the estate figure — so the estate left to heirs
  was understated by a full terminal-tax bill, and could even show as negative.
  Net estate values now rise accordingly, the "before tax" figure beside them is
  genuinely the estate before terminal tax, and previously computed projections
  change.
- **Retirement withdrawals now account for the age credit from 65 on.** When
  sizing an RRSP/RRIF withdrawal to hit a spending target, the engine was pricing
  the tax using the age you started the plan at rather than your age in that year,
  so from 65 onward it drew too little and yearly spending landed roughly $1,000
  short of target. Withdrawals now land on target; projections from age 65 on
  change slightly (a little more withdrawn, a little more tax, slightly lower
  end balances).
- **The meltdown optimizer no longer settles for a worse answer for couples.**
  When both spouses had RRSPs and pension income splitting was on, the search
  could stop at a combination that looked best while changing either person's
  melt amount on its own, even though changing BOTH together was better. On a
  test couple it was leaving about $3,500 of net estate on the table. It now
  also tries adjusting both melt amounts in step, so it finds those combinations.
- **Pension income splitting now splits the full amount when that's best.** The
  search narrowed in on the optimal transfer but could never quite reach the
  50% legal maximum — which is the right answer whenever one spouse's income
  clearly exceeds the other's. It stopped a few dozen dollars short of the cap
  and gave up a few dollars of tax saving a year as a result.

## [0.10.0] - 2026-07-24

### Added
- **Workplace pension (DB) income.** Each person can now have a defined-benefit
  pension: annual amount (in today's dollars), start age, an indexed-to-inflation
  toggle (non-indexed pensions stay fixed in dollars and lose purchasing power
  over the projection), and an optional bridge benefit paid until a chosen age
  (default 65). Pension income flows through taxes, OAS clawback, withdrawal
  needs, and the optimizer, and appears as its own series in the cash-flow chart
  and a Net Pension column in the year-by-year table. Guided Setup's Full setup
  collects it too, as its own step for you and for your spouse.

### Changed
- **Pension income credit and pension splitting follow the real age rules.**
  DB pension income qualifies for the $2,000 pension income credit and for
  spousal income splitting at any age — so early retirees with a workplace
  pension get both before 65. RRIF income continues to qualify only from 65.
  Existing plans are unaffected: without a DB pension the tax math is unchanged.

### Fixed
- **OAS clawback is no longer taxed twice.** When the OAS recovery tax applied,
  the clawed-back amount was counted as income *and* the recovery was added on
  top. CRA deducts the repayment before calculating income tax, so it should be
  taxed once. This overstated tax by roughly $850/yr at $110,000 of income and
  about $4,200/yr at $200,000 — every year in the clawback range. Projections
  for anyone whose income triggers the clawback improve, and the optimizer's
  clawback-avoidance suggestions were being scored against inflated numbers.
- **Quebec projections no longer overstate tax by ~8%.** Quebec residents
  receive a 16.5% abatement of federal tax, which was missing entirely. Every
  Quebec plan's lifetime tax, net income, and estate figures change.
- **Federal tax uses the current 14% bottom rate.** The engine applied 14.5%,
  the blended rate from 2025's mid-year cut, to every projected year. The rate
  has been 14% since 2026, and the federal credits that track it (basic
  personal, pension, and age amounts) now use 14% as well.
- **Employment income is reduced by CPP/QPP and EI contributions.** Payroll
  deductions were ignored, overstating take-home pay while working by roughly
  $5,500/yr at higher incomes, which inflated projected savings at retirement.
  Quebec uses QPP and the lower Quebec EI rate. Their tax relief is modelled
  too: the enhanced portion (and all of CPP2) is deducted from income, while the
  base contribution and EI reduce tax as credits.
- **RRSP contributions now reduce taxable income.** Money the plan routed into
  an RRSP raised the balance but never generated the deduction it earns in real
  life — a $10,000 contribution at a 40% marginal rate was quietly forgoing
  about $4,000. The resulting tax saving is kept as savings, so it grows with
  the plan instead of vanishing.
- **Ontario Health Premium is charged the way it's actually calculated.** It
  phased up in steps, jumping to a band's full amount the moment income crossed
  the threshold — $300 at $20,100 of income, where the real premium is $6. It
  now phases in gradually within each band. The premium is also a separate levy
  that tax credits don't reduce, so it is now charged even when credits
  eliminate income tax; and the Ontario surtax now applies to provincial tax
  remaining *after* all credits, rather than after the basic personal amount
  alone.
- **The federal basic personal amount tapers at high income.** It was applied in
  full at every income level; it actually shrinks from $16,129 to $14,538
  between roughly $178,000 and $253,000 of income.
- **Manitoba's basic personal amount updated to the 2025 figure** ($15,969, up
  from the frozen 2024 $15,780), slightly lowering tax for Manitoba plans.
- **Provincial pension and age credits use each province's own amounts.** Both
  were estimated with a flat 5% rate applied to the *federal* claim amounts.
  Every province and territory now uses its own credit amounts and its own
  lowest tax rate — Ontario's pension amount is $1,762, not $2,000, and age
  amounts and their income thresholds vary widely by province.
- **Guided Setup no longer saves numbers it warned you about.** Both paths
  showed an amber warning for inconsistent entries — a retirement age before
  your current age, a life expectancy before either — but let you continue and
  save anyway, and neither path showed the warning on the step holding the Save
  button. Setup now stops at the step where the problem is, with the field in
  front of you, and says what to fix. Quick start had been silently rewriting
  the offending value at save time (a retirement age of 40 entered at age 48 was
  stored as 48); Full setup had been saving it as typed, which could produce a
  plan with no projection at all.
- **Guided Setup asks before discarding your answers.** Pressing Escape or Skip
  part-way through — up to twelve steps in Full setup — used to throw everything
  away instantly. It now confirms first, and still leaves immediately if you
  haven't entered anything yet.
- **Quick start no longer pre-fills a spouse with sample money.** Turning on
  "Include a spouse / partner" filled their RRSP, TFSA, and non-registered
  balances with the sample plan's amounts (about $500,000 in total), which were
  saved as yours if you didn't notice. Those fields now start empty.
- **Estate tax in the final year now accounts for pension and dividend credits and
  the OAS clawback.** When someone died with no surviving spouse, the tax on the
  deemed disposition of their RRSP/RRIF and unrealized gains was measured against
  a version of their final-year income that quietly dropped the pension income
  credit and the dividend tax credit and ignored the OAS clawback. Estate tax was
  overstated for anyone with workplace pension income or eligible Canadian
  dividends in their final year, and understated for anyone whose income triggers
  the OAS clawback. Estate tax and net estate figures change for those plans;
  plans without pension, dividend, or clawback income in the death year are
  unaffected, as are estates that roll over to a surviving spouse.

## [0.9.0] - 2026-07-22

### Added
- **Maximum sustainable spending mode.** The optimizer can now answer "what
  lifestyle can I afford?" as well as "how do I leave the largest estate?" Pick
  the "Spend the most in retirement" objective and it solves for the highest
  flat annual spending your savings can sustain — searching RRSP melt amounts,
  CPP/OAS start ages, and withdrawal order. Because a spend-to-the-limit number
  is dangerously optimistic, you choose how safe it has to be (a 75%, 85% or
  95% Monte Carlo success bar; 85% by default) and the suggestion is reliably
  held to that bar — the safety check adapts its search so the recommended
  spend actually clears the bar even when it sits far below the theoretical
  maximum, rather than stopping short and reporting a spend that doesn't.
  Results lead with the sustainable figure and how it compares to
  what you've planned — including an honest amber warning when your plan can't
  sustain what you'd hoped — and can be applied to the plan you're editing
  (which also updates your annual spending and withdrawal order) or saved as a
  new plan.
- **"Total spending (funded)" row** in the plan comparison table's Outcomes
  section — the lifetime spending each plan actually funds in the baseline
  scenario, so max-spend comparisons show the quantity being maximized.
- **Save confirmation from the optimizer.** Saving a suggestion as a new plan
  now confirms in a dialog showing the name it was saved under, and names are
  always unique ("Suggested plan 2", …) instead of duplicating.

### Changed
- **Plan manager moved to the top of the dashboard** input column with a
  compact collapsible header — which plan you're editing, and the Compare /
  Optimize entry points, no longer hide below the input sections.
- **Optimizer setup is clearer about what it does**: it shows which plan will
  be optimized, each objective card states what it adjusts and what it solves
  for, and the CPP/OAS toggle is now "Optimize CPP/OAS timing" (the search can
  suggest earlier starts too, not only delays). The optimizer is labeled BETA
  on the page and everywhere it's linked.
- **Comparison results polish**: the chart display controls (percentile bands,
  today's-dollars toggle) sit next to the chart they affect, and "Money runs
  out" is labeled as the baseline scenario, not Monte Carlo.

## [0.8.0] - 2026-07-21

### Added
- **RRSP meltdown suggestions.** A new optimizer searches for the annual RRSP
  withdrawal amount (per person) that maximizes your net estate after terminal
  tax, and by default also considers delaying CPP and OAS — deferral is what
  opens the low-tax window that makes melting worthwhile. Results lead with a
  before/after table (melt amount, melt start age, CPP/OAS start ages —
  changes highlighted) next to a side-by-side comparison of your
  current plan vs the suggestion (projections, success rates, tax and estate
  deltas). Apply the suggestion directly to the plan you're editing (only the
  melt amount and CPP/OAS start ages change — everything else stays as-is) or
  save it as a new plan. Suggestions never allow a plan that runs out of
  money, and the winner is validated against Monte Carlo success rates before
  being recommended. A "Not sure how much or when to melt?" link next to the
  RRSP melt fields jumps straight to the optimizer. If you haven't entered
  your own numbers yet, the optimizer says so and points you to Guided Setup
  instead of silently optimizing the sample data.
- **RRSP Withdrawal Strategy page.** A new standalone page at
  /rrsp-withdrawal-strategy/ explains the RRSP meltdown strategy — why
  maximum deferral often backfires (RRIF minimums, OAS clawback, terminal
  tax), when melting down helps and when it doesn't (including the GIS
  caution), plus an FAQ — with links straight into the optimizer. Added to
  the site navigation on all pages.
- **CPP Calculator FAQ.** The CPP Calculator page now ends with an FAQ
  covering how much CPP pays, start-age trade-offs, how the calculation
  works, the child-rearing provision, taxability, and how the estimate
  relates to your Service Canada statement.

## [0.7.0] - 2026-07-19

### Added
- **Compare plans side by side.** Pick 2–3 plans and see overlaid net-worth
  projections with Monte Carlo uncertainty bands, headline summary cards
  (success rate, net estate, when money runs out), and a metrics table grouped
  into Outcomes / Estate / Taxes / Lifetime income. Best values are
  highlighted, and comparing exactly two plans adds a difference column with
  better/worse coloring.
- **Delete confirmation.** Deleting a plan now asks for confirmation first
  instead of deleting immediately.

### Changed
- **Named plans replace saved scenarios.** You're always editing a named plan
  ("My Plan"), and edits save automatically to the active plan — no more
  Save/Update buttons. Rename a plan inline by clicking its title. "New Plan"
  walks through guided setup starting from default values (a fresh, blank
  plan); "Duplicate Plan" copies the active plan. Delete removes one. Share
  links now open as a new "Shared plan" instead of overwriting your current
  inputs. Existing saved scenarios are preserved and become plans automatically.
- **Share uses an in-app dialog.** The Share button shows the link in a proper
  dialog with a copy button and privacy note, replacing browser alert/prompt
  popups (which some browsers block).
- **Plainer wording throughout.** Notable renames: "Death Age" → "Life
  Expectancy", "Retire Age" → "Retirement Age", the summary tax cards now say
  "… Tax Rate", and "Show Real Dollars" → "Show Today's Dollars". Validation
  messages drop math symbols for plain language, chart legends and tooltips
  now use matching labels, and the guided-setup closing page walks through
  next steps (review on the dashboard, duplicate and compare).

## [0.6.1] - 2026-07-19

### Added
- **Crawler-ready How It Works.** The page is prerendered to static HTML at
  build time and carries FAQ structured data, and a sitemap now lists all three
  pages — search engines and AI crawlers see the full methodology content
  without running JavaScript.

### Changed
- **Clearer assumption controls.** Toggle tooltips follow a consistent
  "ON = / OFF =" format, long tooltips were shortened, non-registered return
  fields are labelled "Non-Reg", and Bonds sits next to Equity (Growth) in both
  the asset mix editor and the Returns box.
- **Years Contributed is disabled while a CPP Calculator estimate is applied**
  — the estimate replaces the simple years-based formula, and the field's
  tooltip says so.

## [0.6.0] - 2026-07-18

### Added
- **How It Works as its own page.** The methodology page now lives at
  `/how-it-works/` (legacy `/#how-it-works` and `/#cpp-calculator` links
  redirect before first paint) and was rewritten top to bottom: a short purpose
  statement with a feature-card grid, collapsible detail sections behind a
  modelling overview, an FAQ, and a warning that future tax/program changes
  will affect results.
- **Bonds/Cash split.** The single "Interest" concept is now two: the
  non-registered asset mix has separate **Bonds** and **Cash** slices, and the
  return assumptions have **Bonds Total Return** (default 3.5%) and **Cash
  Interest** (default 2%). Both are taxed as ordinary income; Monte Carlo leaves
  them deterministic. Existing saved plans, share links, and scenarios migrate
  automatically (legacy interest → Cash, Bonds at 0%) with identical results.

### Changed
- **Withdrawal strategies relabeled.** "Tax-Efficient" is now **RRSP Last
  (defer taxes)** and "RRSP First" is **RRSP First (early melt)**, with an
  explicit caveat that deferral can mean a higher tax bill for the estate and
  higher total lifetime tax. Display text only — stored scenario values are
  unchanged.
- **Assumptions box split into three.** The sidebar's Assumptions section is now
  **Settings** (province, inflation, pension splitting, RRSP-first, real
  dollars), **Returns** (per-account return rates, each field accented with its
  account's chart colour), and **Monte Carlo** (toggle + volatility).

### Fixed
- **Pension credit and income splitting are now RRIF-only.** Voluntary RRSP
  melt withdrawals are ordinary withdrawals under CRA rules and no longer
  qualify for the Pension Income Credit or count as eligible pension income
  for splitting. Previously both counted, which overstated the benefit of the
  RRSP-first melt strategy; projections change slightly as a result.

## [0.5.0] - 2026-07-17

### Added
- **First-time-user onboarding.** New visitors get an intro screen explaining the
  tool, then choose between **Quick start** (~2 min — a handful of questions,
  sensible defaults for the rest) and **Full setup** (~10 min — every option step
  by step, defaults pre-filled, spouse toggle up front). Both paths end with a
  closing screen explaining that data lives in the browser's local storage and how
  share links work. The wizard edits a draft and commits exactly once on Finish —
  Skip/Cancel changes nothing, untouched fields keep their saved values, and
  Quick start merges into the existing plan rather than resetting it. Re-runnable
  anytime from the **Edit My Plan** button in the header (pre-filled with current
  numbers). Share-link (`#start=`) visitors never see it; a share link opened
  mid-wizard closes the wizard without committing and imports the shared scenario.
- **Peek-first intro.** The onboarding intro now renders as a welcome card over
  the live, dimmed sample dashboard, so new visitors see what the tool produces
  before entering any numbers; the wizard steps themselves stay full-screen.
- **Edit My Plan** header button replaces the Scenarios-panel "Guided setup"
  entry point; the header now grows on small screens so nav and the button stay
  reachable on mobile.

### Changed
- Saved data is only written to the browser after you change something — a
  first-time visitor who only looks at the intro leaves no data behind at all.

### Fixed
- **Estate tax showed $0 when a younger spouse outlived the primary person.** The
  projection horizon had the couple's age difference flipped, so the simulation
  ended at the primary person's death and never reached the surviving spouse's
  final year — skipping the deemed disposition of their RRSP/RRIF and unrealized
  capital gains. The projection now runs to the survivor's death year and taxes
  their estate.

## [0.4.0] - 2026-07-13

### Added
- **Multiple non-registered accounts per person.** Each account has its own name,
  balance, ACB, asset mix, fund turnover, and rebalance-annually toggle — so a GIC
  ladder, a dividend portfolio, and a buy-and-hold growth ETF can coexist with
  accurate per-account tax treatment.
  - **Tax-efficient sale ordering**: when spending needs a non-registered sale, the
    engine drains the account with the highest cost-base ratio first — the least
    realized gain (and tax) per dollar raised.
  - **Surplus account**: leftover cash each year is swept into the one account you
    mark "Surplus" (radio button, one per person).
  - **At death**, a surviving spouse inherits the accounts as-is: each keeps its own
    ACB and mix, rolled over without triggering tax.
  - Existing scenarios and share links migrate automatically.
- **Standalone CPP Calculator page** at `/cpp-calculator/` — the same calculator as
  the in-app page, built as its own crawlable URL with proper meta tags. "Apply to
  plan" still feeds the main planner (same origin), and the share button copies the
  right link from either page.

### Changed
- **The asset mix is per-account, no longer a household setting** (reverses the
  v0.2.2 rule that the spouse always used your mix). The mix, turnover, and
  rebalance controls moved inside each account's "Asset mix & settings" panel, and
  each spouse's accounts are fully independent.

## [0.3.0] - 2026-07-09

### Added
- **Per-account growth rates**: RRSP Return and TFSA Return inputs under Assumptions
  (whole-account, tax-sheltered — no yield/gains split needed). The former "Capital
  Growth" input is now **Non-Reg Growth** and applies only to the Equity (Growth)
  slice of the non-registered mix. Unset rates fall back to the old single rate, so
  existing scenarios and share links are unchanged. Monte Carlo applies one correlated
  volatility shock across all three growth rates.
- **"Rebalance annually" toggle** in the Non-Reg Asset Mix card (default on = previous
  behavior). Off models no rebalancing: only the Equity slice compounds, dividend and
  interest income stay flat in dollars, and the equity share drifts upward. Sales and
  reinvested surpluses are pro-rata, so only growth moves the weights. Surfaced in
  three places: a live drift summary in the mix card ("60% → 81% equity by age 90"),
  per-year composition on hover over the table's Non-Reg columns, and a new
  "Annual Rebalancing vs. Drift" section in How It Works.

## [0.2.2] - 2026-07-09

### Fixed
- **Capital gains inclusion rate corrected to a flat 50%.** The engine applied the
  June 2024 proposal (2/3 inclusion above $250k of gains), which was deferred and then
  cancelled in March 2025 — never enacted. Death-year estate taxes on large unrealized
  gains were overstated as a result.

### Added
- **Equity turnover** input in the Non-Reg Asset Mix card (default 2%): each year the
  chosen share of unrealized gains is realized and taxed (fund turnover / distributions),
  with the ACB stepped up accordingly — the annual tax drag of non-index funds.
  0% models a buy-and-hold index ETF.
- **Foreign dividends** as a fourth asset-mix slice: fully taxable as ordinary income
  with no gross-up or dividend tax credit (the creditable ~15% withholding makes
  marginal-rate treatment the right approximation). The existing Dividends slice is
  now explicitly Canadian-eligible.
- **Tax Paid breakdown tooltip** in the year-by-year table: You/Spouse split
  (post-splitting), OAS clawback included in the total, pension-splitting savings,
  marginal tax attribution by source (capital gains / dividends / interest+foreign —
  dividends can be negative at low income thanks to the DTC), and effective rate.
- **Net CPP and Net OAS You/Spouse tooltips** — clarifies household-combined columns,
  e.g. a "jump" when the spouse's CPP starts at their own claiming age.
- **Foreign Yield** input under Assumptions (default 2%): sets the yield on the
  Foreign Dividends slice independently of the Canadian dividend yield. Older saved
  scenarios/links keep their previous behavior (foreign slice earned the dividend yield).

### Changed
- The Asset Mix (and turnover) is now explicitly a household setting: the spouse's
  non-registered account always uses the same mix, regardless of stored scenario data.

## [0.2.1] - 2026-07-09

### Fixed
- **"Total Spend" (`netIncome`) is now cash-basis actual spending.** Previously it was
  derived from taxable income, which (a) counted the 38% dividend gross-up as cash,
  (b) double-counted the taxable share of realized capital gains on top of the gross
  non-registered sale, and (c) excluded one-time inflows — in a year funded by
  non-registered sales it could overstate spending by 30%+. It also reported forced
  income (RRIF minimums, CPP above the target) as spending even though the excess was
  reinvested. It now equals the spending target when funded and target-minus-shortfall
  when accounts run dry.

### Added
- **Estate Tax column** in the Year-by-Year Breakdown table: shows the terminal tax
  (deemed disposition of RRSP/RRIF + unrealized gains) on the death-year row. The tax
  was previously deducted from balances without appearing anywhere in the table, so the
  death-year "Tax Paid" understated the real bill.
- **Surplus / Shortfall column** (replaces Shortfall): green `+` shows surplus income
  reinvested into TFSA/RRSP/Non-Reg, red `−` shows unfunded spending — so every row's
  cash fully reconciles: Total Spend + Tax + reinvested = cash in.

## [0.2.0] - 2026-07-05

### Added
- **Shortfall tracking**: the projection engine now records unfunded spending per year
  instead of silently dropping it when all accounts are drained. Surfaced in three
  places:
  - the red warning banner now shows the total unfunded spending over the plan,
  - a new **Shortfall** column in the Year-by-Year Breakdown table,
  - Monte Carlo success rate now counts a run as failed if it ever left spending
    unfunded (cumulative > $1,000).
- **Detailed CPP calculator** (new page): estimates your CPP benefit using the
  Service Canada method — per-year earnings as YMPE ratios with the general
  drop-out and child-rearing provisions — and can feed the result into the simulation
  as a per-person CPP override, replacing the simple years/40 approximation.
- Pages are now addressable by URL with back/forward navigation support.
- App-level error boundary with "Reload" and "Reset saved data" recovery actions.
- Scenario rename: typing a name and pressing **Update** renames the active scenario;
  "Save as copy" with an empty name falls back to "*name* (copy)".
- Site footer with a not-financial-advice disclaimer, the tax-rule year in use, and a
  link to the full legal disclaimer.

### Fixed
- **Capital-gains tax on non-registered withdrawals is now actually paid.** Previously,
  selling from a non-registered account treated every dollar sold as spendable and the
  resulting tax appeared in reported tax totals but was never debited from any account —
  wealth trajectories and estate values were optimistic by the cumulative gains tax (and
  the extra OAS clawback the gains triggered). Sales are now grossed-up so the withdrawal
  funds its own tax bill, and the wealth and tax charts reconcile.
- **Spousal withdrawal fallback**: when one spouse's RRSP (or non-registered account)
  couldn't cover their half of a deficit, the other spouse's account now tops up the
  remainder instead of the plan reporting a false shortfall.
- Asset-mix percentages are now clamped so a mix can no longer exceed 100% and inflate
  investment income.
- Corrupted or truncated share links and saved data no longer crash the app — payloads
  are validated and degrade gracefully instead.
- The share-URL hash is cleared after hydration, so reloading no longer overwrites
  later edits with the shared snapshot.
- Spouse UI state is now derived from the inputs, so loading a shared link or scenario
  with a spouse always shows the spouse panel, chart series, and table columns.
- Negative tax bars in the Annual Cash Flow chart were clipped by the zero-floored
  Y axis; the axis now extends below zero.

### Changed
- **Monte Carlo success rate is now stricter**: previously a run "succeeded" if final
  assets exceeded $1,000; it now fails if spending ever went unfunded. Borderline plans
  will report lower (more honest) success rates than in earlier versions.

## [0.1.0] - 2026-01-24

Initial public version, deployed to [craptool.ca](https://craptool.ca).

- Year-by-year household projection engine: RRIF minimums, voluntary RRSP meltdown,
  configurable withdrawal ordering (tax-efficient vs. RRSP-first), CPP/OAS with
  claiming-age adjustments, OAS clawback, estate/terminal tax with spousal rollovers.
- 2025 federal and all-province/territory tax brackets, dividend tax credit, pension
  income credit, age amount, Ontario Health Premium and surtax.
- Optimal pension income splitting between spouses.
- Monte Carlo simulation (BETA) with percentile bands and success rate.
- Dashboard with net worth, cash flow, and surplus charts plus a year-by-year table.
- Saved scenarios (localStorage) and shareable LZ-compressed URLs.
- One-time expenses/inflows, inflation-adjusted "real dollars" view.
