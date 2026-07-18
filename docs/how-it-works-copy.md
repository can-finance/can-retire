# How It Works — page copy (approved 2026-07-18)

Original approved copy for the How It Works page redesign, kept as a historical
snapshot — do not update. The live text is in `src/components/pages/HowItWorks.tsx`;
the current working copy is tracked in `how-it-works-copy-current.md`.

## Opening section

Saving for retirement is one problem. Spending it is another — and in Canada, the
spending side is a tax problem. When you take CPP, which account you drain first, how
you split income with your spouse — these choices can lead to tens or hundreds of
thousands in tax savings.

This tool exists to show you those differences and how you can increase your retirement
income and/or estate value.

### Feature cards (2×2 grid)

- **Government benefit timing** — See what starting CPP or OAS earlier or later does to
  your outcome. A built-in CPP calculator estimates your entitlement from your earnings
  history.
- **Withdrawal order** — Compare draining RRSP/RRIF, TFSA, and non-registered accounts
  in different sequences — including an early "RRSP melt" to avoid large forced
  withdrawals (and tax bills) later.
- **Real Canadian taxes** — Federal and provincial brackets for all 13 provinces and
  territories, OAS clawback, capital gains with cost-base tracking, dividend credits,
  and automatic pension income splitting for couples.
- **Uncertainty** — A Monte Carlo mode stress-tests your plan against volatile markets
  instead of assuming a smooth average return every year.

### Closing lines

Everything runs entirely in your browser — no account, no server, none of your
financial data ever leaves your device.

The output isn't a prediction; it's a comparison engine. Change one decision, hold
everything else constant, and see whether it helps, hurts, or doesn't matter.

## Condensed disclaimer (amber callout)

**These are rough estimates — don't over-optimize.** Treat results as comparisons
between scenarios, not forecasts. A 1–2% gap between assumed and actual returns,
compounded over 20–30 years, will dwarf most tax optimizations. Use the tool to learn
the direction and magnitude of your choices, then revisit your assumptions as your
situation evolves.

## Page structure plan

1. New opening (above) replaces the old header + "Exploring decumulation scenarios"
   sections; feature bullets become a 2×2 card grid.
2. Amber disclaimer shrinks from three paragraphs to the single paragraph above.
3. "Further details" sections become collapsible (`<details>`/`<summary>`, styled with
   Tailwind): Calculation logic, Withdrawal strategies, Taxes & benefits, Income
   splitting, Investment growth.
4. Investment Growth content trimmed roughly in half; shorter bullets throughout.
5. Design polish: consistent card treatment, small section icons, tighter typography;
   keep the 4-item tax grid. Preserve `id="privacy"` and `id="full-disclaimer"` anchors
   and the legal disclaimer text.
