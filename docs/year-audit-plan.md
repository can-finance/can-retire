# Year Audit View — Implementation Plan

Status: **v1 shipped 2026-07-25** (data layer `src/utils/yearAudit.ts`, drawer
`src/components/dashboard/YearAuditDrawer.tsx`, click wiring in the table and
cash-flow chart). Phase 2 (tax-math detail) not started.
Scope decided: deterministic projection only — **Monte Carlo runs are explicitly out of scope**.

## Goal

Let a user click any year — a row in the Year-by-Year Breakdown table or a bar in the
"Annual Cash Flow (Net)" chart — and see an exact, auditable breakdown of how the engine
got from the prior year's state to this year's: spending, income sources, taxes,
investment growth, withdrawals, and surplus reinvestment, reconciled so the numbers
visibly add up.

## Why

- Trust: converts "this year looks wrong" into "oh, that's the RRIF minimum + OAS clawback."
- Self-verification: the audit view is a visible invariant check on the engine — if the
  waterfall doesn't sum, we've found a bug before a user does.
- Support/content leverage: answers "why did my taxes jump at 72?" without a support email.

## Non-goals

- **No Monte Carlo auditing.** The audit applies to the deterministic projection only.
  If Monte Carlo display is on, the audit still opens against the deterministic
  `simulationResults` and says so in a footnote.
- **No decision trace** ("why RRSP before non-reg this year"). The engine doesn't record
  the *why* of withdrawal ordering; v1/v2 show the arithmetic only. Engine-emitted audit
  notes are a possible later phase, not planned here.
- **No new URL route.** The SPA is deliberately dashboard-only (see the routing comment at
  the top of `src/App.tsx`). The audit is an in-page overlay fed from the in-memory
  results array. Optional `#audit=<year>` deep-linking can be layered on later.
- No redesign of the existing table/charts beyond adding click affordances.

## UX

**Surface: a slide-over drawer** (right side on desktop, full-screen sheet on mobile),
rendered from `Dashboard.tsx`, holding a `selectedYearIndex: number | null` state.

- Open triggers:
  - Click / Enter / Space on a row in `YearlyBreakdownTable` (`src/components/tables/YearlyBreakdownTable.tsx`).
  - Click on a bar in `SpendingChart` ("Annual Cash Flow (Net)", `src/components/charts/SpendingChart.tsx`)
    via Recharts' `onClick` on the `BarChart`/`Bar` (payload carries the row; map back to index by `year`).
- In-drawer navigation: ◀ prev-year / next-year ▶ buttons and arrow-key support, so a user
  can walk the timeline without closing.
- Close: X button, Esc, click-outside. Restore focus to the triggering element on close.
- Respects the existing **real vs. nominal dollars toggle** (`isInflationAdjusted` +
  `row.inflationFactor`), with the mode named in the drawer header.
- Discoverability: rows get `cursor-pointer` + hover highlight; the table's subheader text
  ("Hover over column headers…") gains "Click a year for a full breakdown."

Accessibility: rows become keyboard-focusable (`tabIndex={0}`, `role="button"` semantics on
the row or a per-row invisible button); the drawer is a focus-trapped `role="dialog"` with
a labelled heading. Note `YearlyBreakdownTable` is `React.memo`-wrapped — the new
`onSelectYear` callback must be stable (useCallback in Dashboard) to keep memoization.

## Data: what already exists vs. what must be derived

`SimulationResult` (`src/engine/types.ts:100`) already carries per year: gross & net income
by source with per-person splits, tax by type (`capGainsTaxPaid`, `dividendTaxPaid`,
`interestTaxPaid`, `oasClawbackPaid`, terminal taxes), net withdrawals per account type,
gross withdrawal totals, surplus reinvestment per account type, end-of-year balances + ACB,
`pensionSplitAmount` / `taxSavingsFromSplit`, `shortfall`, `inflationFactor`, and the
death-year/estate fields. **v1 requires no engine changes.**

Derived in the UI layer (a pure helper, see below):

- **Prior-year state**: `results[i - 1].accounts` / `.spouseAccounts`. For the **first
  projection year**, prior state comes from `SimulationInputs` starting balances — the
  helper takes `(inputs, results, index)` so year 0 isn't a special case in the component.
- **Investment growth per account (residual)**:
  `growth = endBalance − startBalance + grossWithdrawals − contributions(reinvested)`.
  Shown as its own "Investment growth" line. Caveat: gross withdrawals are only split
  per account *type* household-wide (`totalRRSPWithdrawal` etc.), so in spouse scenarios
  the per-person growth split may be approximate; v1 shows household-level account-type
  waterfalls (You/Spouse balances shown, growth reconciled at the household account-type
  level). If residuals fail to reconcile in edge years, that is a finding — fix or emit
  growth explicitly from the engine rather than fudging the display.

## Drawer content (v1)

Ordered as a story, each section a mini-table that visibly sums:

1. **Header** — year, age(s), dollar mode (real/nominal), badges: death year, shortfall year,
   one-time event year (match `inputs.oneTimeEvents` by age).
2. **Income sources** — per source (employment, CPP, OAS, DB pension incl. bridge,
   investment income): gross → tax share → net, You/Spouse split where available.
   Pension-splitting line when `pensionSplitAmount > 0` (amount shifted, tax saved).
3. **Taxes** — total household tax, per-person shares, then the marginal attribution lines
   already computed (cap gains / dividends / interest, OAS clawback), effective rate.
   (Reuses the logic in `taxBreakdown()` in `YearlyBreakdownTable.tsx` — extract it to a
   shared helper rather than duplicating.)
4. **Cash reconciliation** — the core identity, displayed as a waterfall:
   `net income sources + net withdrawals − surplus reinvested = actual spend (target − shortfall)`.
5. **Account waterfalls** — per account type (RRSP / TFSA / Non-Reg):
   `start balance + growth (derived) + reinvested − gross withdrawals = end balance`.
   Non-reg additionally shows ACB movement and realized gains (`totalRealizedCapGains`).
6. **Death-year variant** (when `isDeathYear`) — extra section: who died, RRSP rollover to
   spouse (`rrspRolledToSpouse`), terminal deemed disposition (`terminalRealizedGains`,
   `terminalTaxOnRRSP`, `terminalTaxOnCapGains`, `totalTerminalTax`), gross → net estate.

Every section footer shows its check-sum status; a non-reconciling section renders the
residual explicitly (e.g. "unexplained: $3") instead of hiding it.

## Architecture

```
src/utils/yearAudit.ts          — pure: buildYearAudit(inputs, results, index) → YearAudit
src/utils/yearAudit.test.ts     — identity/reconciliation tests (see Testing)
src/components/dashboard/YearAuditDrawer.tsx — presentation only, consumes YearAudit
```

- `YearAudit` is a typed structure of sections/lines with numeric values; the drawer only
  formats and lays out. All arithmetic lives in the pure helper so it's unit-testable
  without DOM.
- Inflation adjustment applied at render time (same pattern as the charts: divide by
  `inflationFactor` when `inflationAdjusted`), never inside the audit math — reconciliation
  identities are checked in nominal dollars.
- Dashboard wires: `selectedYearIndex` state, stable `onSelectYear`, drawer mount.

## Phase 2 — "Show the tax math" (separate follow-up, after v1 ships)

Expandable per-person detail re-running the **pure exported functions** in
`src/engine/tax.ts` (`calculateIncomeTax`, `calculateTotalTax`, `calculateOASClawback`,
`calculateOptimalSplit`, `federalBasicPersonalAmount`, age/pension amounts) for the
selected year, on demand — displaying bracket-by-bracket federal/provincial tax, BPA,
age amount phase-out, pension credit, dividend gross-up/credit, and the clawback curve.

Precondition to verify at implementation time: whether each person's **taxable income
composition** for the year (ordinary / eligible dividends / taxable gains, post-split) can
be reconstructed from `SimulationResult` alone. If not, add a small optional per-person
`taxableIncomeBreakdown` to the engine output (engine change → opus-tier work, with
snapshot-test review) rather than approximating in the UI.

## Edge cases checklist

- First projection year (prior state = inputs, not `results[-1]`).
- Death years: single vs. survivor branch; rollover vs. terminal disposition; the year a
  spouse's accounts disappear from `spouseAccounts`.
- Shortfall years (accounts drained; spend ≠ target).
- One-time events (spike in spending target).
- Surplus years (reinvestment lines active, zero withdrawals).
- Negative `dividendTaxPaid` (credit sheltering other income) — render as a credit, not a bug.
- Real-dollars mode consistency across every line.
- Last projection year.

## Testing

- **Identity tests** (`yearAudit.test.ts`): run the engine on the existing snapshot/test
  scenarios (single, spouse, death-year, shortfall, high-surplus, one-time events) and
  assert for *every* year that each section's reconciliation residual is < $1 (or that the
  audit flags it). This doubles as an engine invariant suite.
- Component tests: drawer opens from row click and chart click, keyboard open/close/navigate,
  focus restore, death-year variant renders, real-dollar toggle reflected.
- Existing tests must stay green; `YearlyBreakdownTable` snapshot/test updates for the new
  click affordance.
- Gate: typecheck + full test run in the Docker dev container before commit.

## Delegation plan (per CLAUDE.md)

| Task | Tier |
| --- | --- |
| `buildYearAudit` helper + identity tests | opus (reconciliation math, edge cases) |
| Drawer component + click wiring + a11y | sonnet |
| Copy/tooltips/polish | batched into the sonnet UI agent |
| Phase 2 tax-math view (and any engine output addition) | opus |

Orchestrator verifies each stage: diff review, typecheck, tests.

## Changelog

User-facing → yes. Add under **Added**: "Click any year in the table or cash-flow chart to
open a full audit of that year's calculation — income, taxes, growth, withdrawals, and
reinvestment, reconciled line by line." No behavior/projection changes.

## Open questions (resolve before or during v1)

1. Should `WealthChart` bars/areas also be click targets? (Cheap to add; deferred unless requested.)
2. Drawer vs. full-width expandable row under the table on mobile — decide from feel once the drawer exists.
3. Whether to show household-only account waterfalls in v1 spouse scenarios (planned) or
   invest in per-person gross-withdrawal splits from the engine first.
