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
    });
});
