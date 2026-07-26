import { describe, it, expect } from 'vitest';
import { runSimulation } from '../engine/projection';
import { INITIAL_INPUTS } from './inputSanitizer';
import { computeSummaryMetrics } from './summaryMetrics';

describe('computeSummaryMetrics', () => {
    it('returns an all-zero guard object when there are no results', () => {
        const metrics = computeSummaryMetrics([], INITIAL_INPUTS, false);
        expect(metrics).toEqual({
            estate: 0,
            estateTax: 0,
            annualTaxRetirement: 0,
            effectiveTaxRateRetirement: 0,
            effectiveTaxRateEstate: 0,
            totalEffectiveTaxRate: 0,
            totalTaxPlusEstate: 0,
            totalRetirementIncome: 0,
            netRetirementIncome: 0,
            netEstateValue: 0,
            totalNetValue: 0,
            initialWithdrawalRate: 0,
            outOfMoneyAge: null,
            totalShortfall: 0,
            totalSpending: 0,
            lifetimeTaxPaid: 0,
            lifetimeOASClawback: 0,
            rrspBalanceAt71: null,
            lifetimeNetCPP: 0,
            lifetimeNetOAS: 0,
            lifetimeNetPension: 0,
            lifetimeNetInvestment: 0,
            lifetimeNetEmployment: 0,
            lifetimeRealizedGainsNet: 0,
            deemedGainsAtDeath: 0
        });
    });

    describe('nominal mode', () => {
        const results = runSimulation(INITIAL_INPUTS);
        const metrics = computeSummaryMetrics(results, INITIAL_INPUTS, false);

        it('netEstateValue is estate minus estateTax', () => {
            expect(metrics.netEstateValue).toBeCloseTo(metrics.estate - metrics.estateTax, 6);
        });

        it('outOfMoneyAge matches the first shortfall year (or null if none)', () => {
            const firstShortfallYear = results.find(r => r.shortfall > 1);
            expect(metrics.outOfMoneyAge).toBe(firstShortfallYear ? firstShortfallYear.age : null);
        });

        it('lifetimeTaxPaid covers at least the retirement-year tax plus estate tax', () => {
            // Retirement years are a subset of all years, so lifetime tax paid
            // (all years + estate tax) must be >= retirement tax + estate tax,
            // modulo floating point noise.
            expect(metrics.lifetimeTaxPaid).toBeGreaterThanOrEqual(
                metrics.annualTaxRetirement + metrics.estateTax - 1e-6
            );
        });

        it('lifetimeTaxPaid is positive', () => {
            expect(metrics.lifetimeTaxPaid).toBeGreaterThan(0);
        });

        it('lifetimeNetCPP and lifetimeNetOAS are positive (default inputs collect CPP/OAS)', () => {
            expect(metrics.lifetimeNetCPP).toBeGreaterThan(0);
            expect(metrics.lifetimeNetOAS).toBeGreaterThan(0);
        });

        it('lifetimeNetPension is 0 when the person has no pension', () => {
            expect(metrics.lifetimeNetPension).toBe(0);
        });

        it('lifetimeNetPension is positive when the person has a pension', () => {
            const inputs = {
                ...INITIAL_INPUTS,
                person: { ...INITIAL_INPUTS.person, pension: { annualAmount: 20_000, startAge: INITIAL_INPUTS.person.retirementAge, indexedToInflation: true } }
            };
            const res = runSimulation(inputs);
            const m = computeSummaryMetrics(res, inputs, false);
            expect(m.lifetimeNetPension).toBeGreaterThan(0);
        });

        it('lifetimeOASClawback sums the per-year OAS recovery tax', () => {
            const expected = results.reduce((acc, r) => acc + r.oasClawbackPaid, 0);
            expect(metrics.lifetimeOASClawback).toBeCloseTo(expected, 6);
        });

        it('lifetimeOASClawback is positive when income is high enough to trigger recovery tax', () => {
            const inputs = {
                ...INITIAL_INPUTS,
                person: {
                    ...INITIAL_INPUTS.person,
                    pension: { annualAmount: 150_000, startAge: 65, indexedToInflation: true }
                }
            };
            const m = computeSummaryMetrics(runSimulation(inputs), inputs, false);
            expect(m.lifetimeOASClawback).toBeGreaterThan(0);
        });

        it('rrspBalanceAt71 is the household RRSP balance in the age-71 row', () => {
            const row71 = results.find(r => r.age === 71);
            expect(row71).toBeDefined();
            expect(metrics.rrspBalanceAt71).toBeCloseTo(
                row71!.accounts.rrsp + (row71!.spouseAccounts?.rrsp ?? 0), 6
            );
        });

        it('rrspBalanceAt71 includes the spouse RRSP for a couple', () => {
            const inputs = { ...INITIAL_INPUTS, spouse: { ...INITIAL_INPUTS.person, age: 45 } };
            const res = runSimulation(inputs);
            const m = computeSummaryMetrics(res, inputs, false);
            const row71 = res.find(r => r.age === 71)!;
            expect(row71.spouseAccounts).toBeDefined();
            expect(m.rrspBalanceAt71).toBeCloseTo(row71.accounts.rrsp + row71.spouseAccounts!.rrsp, 6);
        });

        it('rrspBalanceAt71 is null when no result year has the person at 71', () => {
            // Person starts at 75 and dies at 80 — the plan never contains an age-71 row.
            const inputs = {
                ...INITIAL_INPUTS,
                person: { ...INITIAL_INPUTS.person, age: 75, retirementAge: 60, lifeExpectancy: 80 }
            };
            const m = computeSummaryMetrics(runSimulation(inputs), inputs, false);
            expect(m.rrspBalanceAt71).toBeNull();
        });

        it('realized-gains metrics are finite and non-negative', () => {
            expect(Number.isFinite(metrics.lifetimeRealizedGainsNet)).toBe(true);
            expect(metrics.lifetimeRealizedGainsNet).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(metrics.deemedGainsAtDeath)).toBe(true);
            expect(metrics.deemedGainsAtDeath).toBeGreaterThanOrEqual(0);
        });

        it('deemedGainsAtDeath is positive when non-reg gains survive to death', () => {
            // INITIAL_INPUTS drains its non-reg account during retirement, so force
            // a plan where the gains are still unrealized at death: no spending.
            const inputs = {
                ...INITIAL_INPUTS,
                preRetirementSpend: 0,
                postRetirementSpend: 0,
            };
            const res = runSimulation(inputs);
            const m = computeSummaryMetrics(res, inputs, false);
            expect(m.deemedGainsAtDeath).toBeGreaterThan(0);
        });
    });

    describe('real-dollar mode', () => {
        it('produces a strictly lower lifetimeTaxPaid than nominal mode', () => {
            // INITIAL_INPUTS.inflationRate is expected to be > 0; if it were 0,
            // adjusting for inflation would be a no-op and this test would need
            // to force a nonzero rate instead.
            const inputs = INITIAL_INPUTS.inflationRate > 0
                ? INITIAL_INPUTS
                : { ...INITIAL_INPUTS, inflationRate: 0.025 };

            const results = runSimulation(inputs);
            const nominal = computeSummaryMetrics(results, inputs, false);
            const real = computeSummaryMetrics(results, inputs, true);

            expect(real.lifetimeTaxPaid).toBeLessThan(nominal.lifetimeTaxPaid);
        });

        it('deflates rrspBalanceAt71 by the age-71 row inflation factor', () => {
            const inputs = INITIAL_INPUTS.inflationRate > 0
                ? INITIAL_INPUTS
                : { ...INITIAL_INPUTS, inflationRate: 0.025 };

            const results = runSimulation(inputs);
            const row71 = results.find(r => r.age === 71)!;
            const real = computeSummaryMetrics(results, inputs, true);
            const nominal = computeSummaryMetrics(results, inputs, false);

            expect(row71.inflationFactor).toBeGreaterThan(1);
            expect(real.rrspBalanceAt71).toBeCloseTo(nominal.rrspBalanceAt71! / row71.inflationFactor, 6);
        });
    });
});
