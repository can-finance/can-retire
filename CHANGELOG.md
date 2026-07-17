# Changelog

All notable changes to the Canadian Retirement Asset Planning tool are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **First-time-user onboarding.** New visitors get an intro screen explaining the
  tool, then choose between **Quick start** (~2 min — a handful of questions,
  sensible defaults for the rest) and **Full setup** (~10 min — every option step
  by step, defaults pre-filled, spouse toggle up front). Both paths end with a
  closing screen explaining that data lives in the browser's local storage and how
  share links work. The wizard edits a draft and commits exactly once on Finish —
  Skip/Cancel changes nothing, untouched fields keep their saved values, and
  Quick start merges into the existing plan rather than resetting it. Re-runnable
  anytime from **Scenarios → Guided setup** (pre-filled with current numbers).
  Share-link (`#start=`) visitors never see it; a share link opened mid-wizard
  closes the wizard without committing and imports the shared scenario.

### Changed
- The Assumptions inputs were extracted into a reusable `AssumptionsFields`
  component (shared by the dashboard and the wizard); the Monte Carlo toggle now
  sits below the two strategy toggles.
- The amber validation banner is now one shared component used by the dashboard
  and both wizard paths, and the `retirement_sim_v2` storage key is defined in a
  single module instead of four copies.
- Filled in the missing `brand-200/300/400/800` Tailwind shades — completed
  progress dots, wizard card accents, and two pre-existing hover styles
  (dashboard "Add Spouse", CPP calculator) now render their intended colors.

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
  - The drift readout and the table's mix-on-hover tooltips are now **per person**
    (previously the spouse's cells showed the primary person's blend), and the drift
    line blends only the accounts with rebalancing off — money moving between
    accounts via tax-efficient selling or surplus sweeps no longer reads as "drift".
  - Existing scenarios and share links migrate automatically; malformed or
    hand-edited payloads (duplicate ids, empty account lists, mixed old/new formats)
    are sanitized rather than conjuring default balances.
- **Standalone CPP Calculator page** at `/cpp-calculator/` — the same calculator as
  the in-app page, built as its own crawlable URL with proper meta tags. "Apply to
  plan" still feeds the main planner (same origin), and the share button copies the
  right link from either page.

### Changed
- **The asset mix is per-account, no longer a household setting** (reverses the
  v0.2.2 rule that the spouse always used your mix). The mix, turnover, and
  rebalance controls moved inside each account's "Asset mix & settings" panel, and
  each spouse's accounts are fully independent.
- Renaming an account commits on blur/Enter like the numeric inputs, instead of
  re-running the full simulation on every keystroke.
- Zero-gain non-registered sales (ACB ≥ balance — the common case under
  tax-efficient ordering) now skip the tax gross-up search entirely: net equals
  gross exactly, trimming wasted work in Monte Carlo runs.

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

### Fixed
- How It Works incorrectly stated that capital growth raises the ACB (it does not —
  that is why unrealized gains accumulate).
- Removed a broken icon from the Privacy & Data Security heading.

### Changed
- How It Works: rebalancing section rewritten as bullet points; the Taxation &
  Government Benefits cards now use the standard body font size; disclaimer and
  footer text bumped one size for readability.

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
- Link from the CPP Start Age inputs to the CPP Calculator with an explanation of the
  simple estimate vs. the detailed one.

- **Foreign Yield** input under Assumptions (default 2%): sets the yield on the
  Foreign Dividends slice independently of the Canadian dividend yield. Older saved
  scenarios/links keep their previous behavior (foreign slice earned the dividend yield).

### Changed
- The Asset Mix (and turnover) is now explicitly a household setting: the spouse's
  non-registered account always uses the same mix, regardless of stored scenario data.
- Label clarity: "Equity Turnover" → **Fund Turnover** (it realizes the account's
  blended unrealized gains, not just the equity slice); "Equity Returns" →
  **Capital Growth** (price appreciation only — yields are separate inputs);
  "Dividend Yield" → **Cdn Dividend Yield**. Tooltips explain each.
- The cash-flow chart's investment income now includes foreign dividends.
- HelpTooltip renders line breaks (`whitespace-pre-line`).

## [0.2.1] - 2026-07-09

### Fixed
- **"Total Spend" (`netIncome`) is now cash-basis actual spending.** Previously it was
  derived from taxable income, which (a) counted the 38% dividend gross-up as cash,
  (b) double-counted the taxable share of realized capital gains on top of the gross
  non-registered sale, and (c) excluded one-time inflows — in a year funded by
  non-registered sales it could overstate spending by 30%+. It also reported forced
  income (RRIF minimums, CPP above the target) as spending even though the excess was
  reinvested. It now equals the spending target when funded and target-minus-shortfall
  when accounts run dry. Covered by six new regression tests (79 total).

### Added
- **Estate Tax column** in the Year-by-Year Breakdown table: shows the terminal tax
  (deemed disposition of RRSP/RRIF + unrealized gains) on the death-year row. The tax
  was previously deducted from balances without appearing anywhere in the table, so the
  death-year "Tax Paid" understated the real bill.
- **Surplus / Shortfall column** (replaces Shortfall): green `+` shows surplus income
  reinvested into TFSA/RRSP/Non-Reg, red `−` shows unfunded spending — so every row's
  cash fully reconciles: Total Spend + Tax + reinvested = cash in.
- Tooltips on the Scenarios panel and Share button clarifying that scenarios live in
  browser localStorage on your PC and share links carry all data in the URL itself —
  nothing is stored on any server.
- Dockerized dev environment (`Dockerfile.dev`, `docker-compose.yml`) with file-watch
  polling so Vite HMR works through Windows bind mounts.

### Changed
- The Year-by-Year table now renders at full height (no inner 800px scrollbox).

## [0.2.0] - 2026-07-05

### Added
- **Shortfall tracking**: the projection engine now records unfunded spending per year
  (`shortfall` on each simulation result) instead of silently dropping it when all
  accounts are drained. Surfaced in three places:
  - the red warning banner now shows the total unfunded spending over the plan,
  - a new **Shortfall** column in the Year-by-Year Breakdown table,
  - Monte Carlo success rate now counts a run as failed if it ever left spending
    unfunded (cumulative > $1,000).
- Input sanitizer (`src/utils/inputSanitizer.ts`): untrusted `SimulationInputs`
  payloads (share-URL hash, localStorage, saved scenarios) are validated field-by-field
  and merged with defaults instead of being applied raw.
- App-level error boundary with "Reload" and "Reset saved data" recovery actions.
- Scenario rename: typing a name and pressing **Update** renames the active scenario;
  "Save as copy" with an empty name falls back to "*name* (copy)".
- **Test suite** (Vitest, `npm test`): 48 tests covering golden tax values against hand
  calculations, CPP/OAS claiming-age math, wealth-reconciliation invariants, RRIF
  minimums, estate/rollover behavior, Monte Carlo guards, input sanitization, and
  regression pins for every fix in this release, plus a full-run snapshot of the default
  scenario. The deploy workflow now runs tests (and uses `npm ci`) before building, so a
  failing test blocks deployment.

### Fixed
- **Capital-gains tax on non-registered withdrawals is now actually paid.** Previously,
  selling from a non-registered account treated every dollar sold as spendable and the
  resulting tax appeared in reported tax totals but was never debited from any account —
  wealth trajectories and estate values were optimistic by the cumulative gains tax (and
  the extra OAS clawback the gains triggered). Sales are now grossed-up so the withdrawal
  funds its own tax bill, and the wealth and tax charts reconcile.
- **Spousal withdrawal fallback**: when one spouse's RRSP (or non-registered account)
  couldn't cover their half of a deficit, the other spouse's account now tops up the
  remainder instead of the plan reporting a false shortfall. Repeated withdrawals within
  a year now also stack correctly when computing marginal tax.
- Asset-mix percentages are now clamped: each share is limited to the headroom left by
  the other two (mixes could previously exceed 100% and inflate investment income), and
  `min`/`max` on numeric inputs are enforced on commit. The input sanitizer also scales
  down out-of-range mixes from stored or shared data.
- A truncated or corrupted share link could persist a broken state to localStorage and
  crash the app on every subsequent visit. Payloads are now sanitized before being applied.
- Numeric inputs now display 0 instead of a blank field (e.g. a deliberate $0 RRSP melt).
- A corrupted saved-scenarios list in localStorage now degrades to an empty list instead
  of crashing on startup.
- The share-URL hash is cleared after hydration, so reloading no longer overwrites
  later edits with the shared snapshot.
- Spouse UI state is now derived from the inputs, so loading a shared link or scenario
  with a spouse always shows the spouse panel, chart series, and table columns.
- Negative tax bars in the Annual Cash Flow chart were clipped by the zero-floored
  Y axis; the axis now extends below zero.
- `runMonteCarlo` crashed when the simulation returned no results for invalid age inputs.

### Added (UI)
- **Detailed CPP calculator** (new page, `/#cpp-calculator`): estimates your CPP benefit
  using the Service Canada method — per-year earnings as YMPE ratios with the general
  drop-out and child-rearing provisions — and can feed the result into the simulation
  as a per-person CPP override, replacing the simple years/40 approximation.
- Pages are now addressable by URL hash (`/#cpp-calculator`, `/#how-it-works`) with
  back/forward navigation support.
- Site footer with a not-financial-advice disclaimer, the tax-rule year in use, and a
  link to the full legal disclaimer.
- The How It Works disclaimer now shows the app version (injected from package.json at
  build time) with links to the GitHub source and changelog.

### Changed
- Header privacy badge reworded to "Runs Entirely in Your Browser • Your Data Never
  Leaves Your Device" — the previous "No Data Sent to Server" overclaimed given the
  anonymous page-view analytics beacon.
- Chart tooltips consolidated into one shared component (three near-identical inline
  copies removed); deleted unused Vite template files. Deploys now serialize via a
  workflow concurrency group so overlapping pushes can't race the gh-pages branch.
- **Monte Carlo success rate is now stricter**: previously a run "succeeded" if final
  assets exceeded $1,000; it now fails if spending ever went unfunded. Borderline plans
  will report lower (more honest) success rates than in earlier versions.
- Corrected misleading engine comments (Ontario surtax thresholds are indexed, not
  frozen; federal credits use the statutory 15% rate vs. the 2025 transitional 14.5%
  bracket rate).

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
