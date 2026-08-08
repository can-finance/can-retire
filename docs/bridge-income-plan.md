# Bridge Income — Implementation Plan

Status: **not started** (specced 2026-08-08).
Scope: model recurring, time-limited income in the years between retiring and the
start of CPP/OAS/RRIF minimums.

## Goal

Let a person carry an income stream that runs for a fixed span of years — part-time
or consulting work, a severance paid over two years, rental income that ends at a
sale, a LIRA/LIF drawdown — and have the engine tax it correctly for what it is.

## Why

The gap between the last paycheque and the first CPP/OAS cheque is the highest-leverage
window in the whole plan: it is the low-income stretch the meltdown strategy exists to
exploit, and it is where the optimizer earns most of its recommendation. Today the
engine funds that window correctly but can only represent one kind of income inside it.

What already works, and is **not** the problem:
- The gap is funded automatically. Step 2's gap analysis compares net cash to target
  spend and Step 3 draws the deficit from accounts per the withdrawal strategy. There is
  no hole.
- DB pensions already carry a proper bridge benefit (`bridgeAmount` paid from `startAge`
  until `bridgeEndAge`, default 65) — see `pensionIncomeFor` in `projection.ts`.
- A spouse who keeps working is modelled, via their own `retirementAge`.

What is missing is everything else. The only other lever is a one-time inflow, and it
has a trap:

> `OneTimeEvent` with `type: 'inflow'` is added straight to `householdBaseNet`
> (`projection.ts`, Step 1) as **tax-free net cash**. It never enters taxable income.

So three years of $40k consulting modelled as three inflows quietly hands the household
$120k the CRA never sees — flattering the plan in exactly the window where accuracy
matters most, and biasing the optimizer toward strategies that lean on those years.

## Non-goals

- **No new account type.** Bridge income is a cash flow, not a balance. LIRA/LIF balances
  are out of scope; a LIF drawdown is representable as a pension-type stream.
- **No automatic derivation.** The tool will not infer a bridge stream from a retirement
  age; the user states it.
- **No change to how the gap is funded.** Drawdown ordering, the melt, and the surplus
  sweep all stay as they are. This only adds an income source ahead of them.
- **No CPP/EI contribution modelling on bridge employment income** in v1 — see Open
  questions.

## Design

### 1. A generic temporary income stream

Add an optional per-person array. One shape covers every case above:

```ts
export interface TemporaryIncome {
    id: string;
    name: string;              // "Consulting", "Severance", "Rental"
    annualAmount: number;      // today's dollars
    startAge: number;
    endAge: number;            // inclusive; paid while startAge <= age <= endAge
    indexed?: boolean;         // default true, matching salary and DB-pension treatment
    kind: 'employment' | 'pension' | 'other';
}
```

on `Person`:

```ts
temporaryIncome?: TemporaryIncome[];
```

`kind` is the load-bearing field, and the reason this cannot just be "another inflow
number". The three kinds are taxed materially differently, and the engine **already
tracks that distinction**:

| kind | Pension credit / splitting | Payroll contributions | Examples |
|---|---|---|---|
| `employment` | no | yes (CPP/EI) | consulting, part-time, severance |
| `pension` | yes — feeds `eligiblePensionIncome` | no | LIF/LIRA income, a non-DB bridge |
| `other` | no | no | rental, royalties, taxable trust income |

Getting `kind` wrong is not cosmetic: for a couple with lopsided incomes, whether a
stream is splittable can move the household tax bill by thousands a year, which is
precisely the kind of difference the comparison view exists to show.

### 2. Engine integration

All of this lands in `simulatePersonBaseYear` (`projection.ts`), alongside the existing
DB-pension handling, which is the closest analogue and already solves indexation:

- Sum the active streams for the person's age, applying `inflationFactor` when `indexed`.
- Add to gross taxable income for the year.
- Route by `kind`: `pension` adds to `eligiblePensionIncome` (making it visible to both
  the pension credit and the splitting optimizer); `employment` flows through
  `calculatePayrollContributions` if v1 decides to charge them.
- Everything downstream — gap analysis, drawdown, reinvestment — needs no change, because
  the stream simply raises `baseNetCash` the way a pension does.

**Subsume the DB bridge benefit.** `bridgeAmount`/`bridgeEndAge` become a special case of
a `kind: 'pension'` stream. Keep the existing fields and migrate them in the sanitizer so
saved plans keep working; do not break stored `retirement_sim_v2` blobs.

### 3. One-time inflows need a tax flag regardless

Independent of the above, and worth doing even if nothing else here ships:

```ts
// OneTimeEvent
taxable?: boolean;   // default false, preserving today's behaviour
```

An inheritance genuinely is tax-free; a severance lump sum emphatically is not. Right now
the model can only express the first, and nothing warns the user. Defaulting to `false`
keeps every existing plan's numbers identical.

### 4. UI

- A repeatable row editor on the person section, in the mould of `OneTimeSpendingInput`
  (`src/components/inputs/OneTimeSpendingInput.tsx`) — same add/remove affordances.
- Not in the Quick start path. It belongs in Full setup and on the dashboard: it is a
  detail knob, and the wizard is already ~10 minutes.
- The `kind` selector needs plain-language labels, not tax jargon — "Work / self-employment",
  "Pension or LIF income", "Other (rental, royalties)" — with a tooltip explaining that the
  choice changes how the income is taxed and whether it can be split with a spouse.
- Surface the stream in the Year Audit drawer's income section, named, so a user can see
  it land in the years it applies to.

## Interaction with the optimizer

Worth designing deliberately, because the two features touch the same window:

- The optimizer moves `cppStartAge`/`oasStartAge`, which **changes the length of the bridge
  period**. A stream ending at a fixed age combined with a recommendation to defer CPP to
  70 can open an unfunded stretch the user did not anticipate.
- Bridge income should be an input the optimizer holds **fixed** while it searches benefit
  ages — which it is by construction, since the search only varies melt amount and start
  ages. No optimizer change is required.
- But it does mean this feature and **Phase 3 ("when can I retire?")** want thinking about
  together: Phase 3 solves for retirement age, and a bridge stream keyed to fixed ages
  interacts with a moving retirement age in a way that needs a rule (does a stream defined
  as "3 years of consulting" follow the retirement age, or sit at absolute ages?).

## Testing

- Unit: a stream is paid for exactly `startAge..endAge` inclusive, indexed or not.
- Tax routing: a `pension` stream reaches `eligiblePensionIncome` and earns the credit;
  an `employment` stream does not, and an `other` stream does neither.
- Splitting: a couple with a lopsided `pension` stream splits it; the same stream marked
  `employment` does not.
- Regression: a plan with no `temporaryIncome` produces **byte-identical** output to today,
  and a DB pension with `bridgeAmount` produces byte-identical output after the migration.
  The pinned snapshot in `projection.test.ts` is the fence for both.
- Sanitizer: unknown `kind`, `endAge < startAge`, negative amounts, and legacy plans
  without the field all round-trip safely.

## Open questions

1. **Do employment-kind streams pay CPP/EI?** Correct says yes, and it would slightly raise
   the person's eventual CPP. But the engine's CPP estimate is driven by
   `cppContributedYears`, not by simulated contributions, so charging the contributions
   without crediting the years is asymmetric — it would only ever make the plan worse.
   Leaning toward: charge the payroll contributions (they are real cash out) and note the
   unmodelled CPP uplift, rather than silently ignoring both.
2. **Absolute ages or relative to retirement?** See the Phase 3 note above.
3. **Should a stream be assignable to the household rather than a person?** Rental income
   is often jointly held. Per-person is simpler and splittable-by-construction; joint
   ownership can be modelled as two half streams.
