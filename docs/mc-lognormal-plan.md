# Monte Carlo lognormal draws — Implementation Plan

Status: in progress (2026-07-25)
Origin: TODO.md → "Monte Carlo realism" → lognormal draws (the cheap first half;
per-asset-class price volatility is a separate later phase).

## Problem

`runSimulation(inputs, stochastic=true)` currently models yearly return shocks as
additive normal noise (`projection.ts` ~line 388):

```
shock = volatility * Z          // Z ~ N(0,1), one draw per year
rate  = mean + shock            // applied to capitalGrowth, rrspGrowth, tfsaGrowth
```

Two defects:

1. **Missing volatility drag.** With additive symmetric shocks the *median* compound
   outcome equals the mean-return path, overstating typical results. Real compounding:
   a −20% year followed by +20% loses 4%. Median MC outcomes and success rates are
   systematically optimistic — and the optimizer's MC success bars (75/85/95%) validate
   against these inflated rates.
2. **Sub-−100% returns are possible.** `mean + vol*Z` is unbounded below; a deep draw can
   push a year's return past −100% and a balance negative.

## Fix (formula decided in TODO.md)

Draw gross returns lognormally, preserving the **arithmetic mean** of each rate:

```
sigma = volatility
mu(r) = ln(1 + r) − sigma²/2
rate  = exp(mu(r) + sigma·Z) − 1
```

- `E[1 + rate] = exp(mu + sigma²/2) = 1 + r` — the user's entered mean return stays the
  arithmetic mean; the *median* correctly drops below it (drag ≈ sigma²/2).
- `exp(·) > 0` always ⇒ returns are bounded below by −100%; balances can't go negative
  from a return draw.
- **One Z per year, shared** across `capitalGrowth`, `rrspGrowth`, `tfsaGrowth` (same
  correlation structure as today) — each rate gets its own `mu(r)` but the same draw.

Interpretation shift (accepted): `volatility` becomes the std dev of **log** returns
rather than simple returns. For the input range in question (≤ ~20%) the numeric
difference is small; UI copy calls it "how much returns swing" and the tooltip's
"(standard deviation)" parenthetical stays accurate enough to leave as-is.

## Implementation

All in `src/engine/projection.ts` + tests. No type/UI changes.

1. **Extract a pure, testable helper** (exported):

   ```ts
   // Lognormal yearly return: preserves the arithmetic mean `meanRate`,
   // bounds the outcome below by −100%. z is a standard-normal draw.
   export function lognormalReturn(meanRate: number, sigma: number, z: number): number
   ```

   Guard: if `1 + meanRate <= 0` (nonsensical input; sanitizers shouldn't allow it),
   return `meanRate` unshocked rather than taking `ln` of a non-positive number.

2. **Swap the call site** (~line 388): keep the single `boxMullerRandom()` draw per year,
   replace the three additive applications with `lognormalReturn(rate, volatility, z)`.
   The `stochastic && returnRates.volatility` gate is untouched — zero/undefined
   volatility still short-circuits, and the **deterministic path is byte-identical**.

3. **Leave everything downstream alone**: yield slices (interest/dividend) still pay fixed
   rates — shocking slice *balances* is the later per-asset-class phase, not this one.

## Tests

New unit tests for `lognormalReturn` (pure, no randomness — pass explicit z):

- `z = 0` ⇒ return = median = `(1+r)·exp(−sigma²/2) − 1` < r for sigma > 0 (drag visible).
- Bounded: extreme negative z (e.g. −10) with large sigma stays > −1.
- Mean preservation: average of `lognormalReturn` over a symmetric z grid — or the exact
  identity via `E[exp(sigma Z)] = exp(sigma²/2)` — recovers `meanRate` within tolerance.
- `sigma = 0` ⇒ exactly `meanRate` for any z.
- Guard: `meanRate = −1` returns −1 without NaN.

Existing tests:

- `runMonteCarlo` tests (`projection.test.ts:983`) should pass unchanged — zero-vol
  collapse, empty-input guard, always-dry 0% success are all formula-agnostic.
- Full-run deterministic snapshot pin (`projection.test.ts:1013`) must pass **without
  regeneration** — proves the deterministic path didn't move.

## Acceptance

- Typecheck + full test suite green in the Docker dev container.
- Deterministic snapshot unchanged.
- CHANGELOG (Changed): MC percentile bands and success rates shift slightly — median
  outcomes drop (correctly) because volatility drag is now modeled; deterministic
  projections unchanged. Optimizer MC-validated recommendations may shift accordingly.
- TODO.md: mark the lognormal bullet done, leaving per-asset-class volatility pending.

## Out of scope

- Per-asset-class price volatility / slice-balance shocks (later phase, per TODO.md).
- Seeded/deterministic RNG for reproducible MC runs.
- Any change to `volatility` input semantics, sanitization, or UI copy.
