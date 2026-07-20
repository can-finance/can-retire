# Changelog

All notable changes to the Canadian Retirement Asset Planning tool are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
