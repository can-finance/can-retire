import { describe, it, expect } from 'vitest';
import { runSimulation, runMonteCarlo } from './projection';
import type { Person, SimulationInputs } from './types';
import { INITIAL_INPUTS } from '../utils/inputSanitizer';

// Retired 65-year-old with empty accounts and no CPP/OAS — a blank slate to build cases on
const person = (over: Partial<Person> = {}): Person => ({
    age: 65, retirementAge: 60, lifeExpectancy: 70,
    currentIncome: 0, cppStartAge: 69, cppContributedYears: 0, oasStartAge: 69,
    rrsp: { type: 'RRSP', balance: 0 },
    tfsa: { type: 'TFSA', balance: 0 },
    nonRegistered: { type: 'NonRegistered', balance: 0, adjustedCostBase: 0, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } },
    ...over
});

const inputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => ({
    person: person(), province: 'ON', inflationRate: 0,
    preRetirementSpend: 0, postRetirementSpend: 80_000,
    oneTimeExpenses: [], useIncomeSplitting: false, withdrawalStrategy: 'tax-efficient',
    returnRates: { interest: 0, dividend: 0, capitalGrowth: 0 },
    ...over
});

describe('wealth reconciliation invariants', () => {
    it('zero-return drawdown: assets fall by exactly the gross withdrawals', () => {
        const res = runSimulation(inputs({
            person: person({
                rrsp: { type: 'RRSP', balance: 300_000 },
                tfsa: { type: 'TFSA', balance: 200_000 },
                nonRegistered: { type: 'NonRegistered', balance: 400_000, adjustedCostBase: 100_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } }
            })
        }));
        // Exclude the death year (terminal tax debits balances after growth)
        for (let i = 1; i < res.length - 1; i++) {
            const gross = res[i].totalRRSPWithdrawal + res[i].totalTFSAWithdrawal + res[i].totalNonRegWithdrawal;
            const reinvested = res[i].reinvestedTFSA + res[i].reinvestedRRSP + res[i].reinvestedNonReg;
            expect(res[i].totalAssets).toBeCloseTo(res[i - 1].totalAssets - gross + reinvested, 0);
        }
    });

    it('with growth: (prev − withdrawals) × (1+g) = current', () => {
        const res = runSimulation(inputs({
            person: person({ rrsp: { type: 'RRSP', balance: 1_000_000 } }),
            postRetirementSpend: 40_000,
            returnRates: { interest: 0, dividend: 0, capitalGrowth: 0.05 }
        }));
        for (let i = 1; i < res.length - 1; i++) {
            const gross = res[i].totalRRSPWithdrawal + res[i].totalTFSAWithdrawal + res[i].totalNonRegWithdrawal;
            const reinvested = res[i].reinvestedTFSA + res[i].reinvestedRRSP + res[i].reinvestedNonReg;
            expect(res[i].totalAssets).toBeCloseTo((res[i - 1].totalAssets - gross + reinvested) * 1.05, 0);
        }
    });

    it('tax-free TFSA spending needs no gross-up: withdrawal equals spending, zero tax', () => {
        const res = runSimulation(inputs({
            person: person({ tfsa: { type: 'TFSA', balance: 1_000_000 }, lifeExpectancy: 68 }),
            postRetirementSpend: 50_000
        }));
        expect(res[0].netTFSAWithdrawal).toBeCloseTo(50_000, 0);
        expect(res[0].taxPaid).toBe(0);
        expect(res[0].shortfall).toBe(0);
    });
});

describe('non-registered gross-up (gains tax funded by the sale)', () => {
    it('sale nets the target after its own tax; account debited by gross', () => {
        const res = runSimulation(inputs({
            person: person({
                nonRegistered: { type: 'NonRegistered', balance: 1_000_000, adjustedCostBase: 100_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } }
            })
        }));
        const y = res[0];
        // Solver converges to within ~$1 of the target
        expect(y.netNonRegWithdrawal).toBeCloseTo(80_000, -1);
        expect(y.totalNonRegWithdrawal).toBeGreaterThan(y.netNonRegWithdrawal + 1_000);
        // The gap between gross and net is exactly the year's tax bill
        expect(y.totalNonRegWithdrawal - y.netNonRegWithdrawal).toBeCloseTo(y.taxPaid, 0);
        expect(1_000_000 - y.totalAssets).toBeCloseTo(y.totalNonRegWithdrawal, 0);
    });

    it('all-ACB sale (no gains) has zero tax drag', () => {
        const res = runSimulation(inputs({
            person: person({
                nonRegistered: { type: 'NonRegistered', balance: 500_000, adjustedCostBase: 500_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } }
            })
        }));
        expect(res[0].totalNonRegWithdrawal).toBeCloseTo(res[0].netNonRegWithdrawal, 0);
        expect(res[0].taxPaid).toBe(0);
    });
});

describe('spousal fallback', () => {
    it('spouse tops up when the other RRSP runs dry (rrsp-first)', () => {
        const res = runSimulation(inputs({
            withdrawalStrategy: 'rrsp-first',
            person: person({ rrsp: { type: 'RRSP', balance: 10_000 } }),
            spouse: person({ rrsp: { type: 'RRSP', balance: 2_000_000 } })
        }));
        const y = res[0];
        expect(y.shortfall).toBeLessThan(1);
        expect(y.accounts.rrsp).toBeLessThan(1); // person's RRSP fully drained
        // Spouse withdrew more than their 50% share to cover the gap
        expect(2_000_000 - y.spouseAccounts!.rrsp).toBeGreaterThan(45_000);
    });

    it('second non-reg pass covers a capped-out spouse account', () => {
        const res = runSimulation(inputs({
            person: person({ nonRegistered: { type: 'NonRegistered', balance: 20_000, adjustedCostBase: 20_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } } }),
            spouse: person({ nonRegistered: { type: 'NonRegistered', balance: 900_000, adjustedCostBase: 900_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } } })
        }));
        expect(res[0].shortfall).toBeLessThan(2);
        expect(res[0].netNonRegWithdrawal).toBeCloseTo(80_000, -1);
    });
});

describe('shortfall reporting', () => {
    it('unfundable spending is reported, not silently dropped', () => {
        const res = runSimulation(inputs({
            person: person({ tfsa: { type: 'TFSA', balance: 100_000 } }),
            postRetirementSpend: 200_000
        }));
        // Year 0 covered partially by TFSA; later years fully unfunded
        expect(res[0].shortfall).toBeCloseTo(100_000, 0);
        expect(res[1].shortfall).toBeCloseTo(200_000, 0);
        // Target spending is still reported as the target
        expect(res[1].spending).toBeCloseTo(200_000, 0);
    });
});

describe('RRIF minimums', () => {
    it('no forced withdrawal at 71, factor-age-71 minimum (5.28%) in the year turning 72', () => {
        const at71 = runSimulation(inputs({
            person: person({ age: 71, lifeExpectancy: 75, rrsp: { type: 'RRSP', balance: 100_000 } }),
            postRetirementSpend: 0
        }));
        expect(at71[0].totalRRSPWithdrawal).toBe(0);

        const at72 = runSimulation(inputs({
            person: person({ age: 72, lifeExpectancy: 75, rrsp: { type: 'RRSP', balance: 100_000 } }),
            postRetirementSpend: 0
        }));
        expect(at72[0].totalRRSPWithdrawal).toBeCloseTo(5_280, 0);
    });
});

describe('estate / terminal tax', () => {
    it('single person: deemed disposition taxes the RRSP at death', () => {
        const res = runSimulation(inputs({
            person: person({ lifeExpectancy: 66, rrsp: { type: 'RRSP', balance: 500_000 } }),
            postRetirementSpend: 10_000
        }));
        const last = res[res.length - 1];
        expect(last.personDeathThisYear).toBe(true);
        expect(last.totalTerminalTax!).toBeGreaterThan(100_000); // ~half of a $450k+ RRSP at top rates
        expect(last.netEstateValue).toBeCloseTo(last.grossEstateValue! - last.totalTerminalTax!, 0);
    });

    it('surviving spouse: RRSP rolls over tax-free', () => {
        const res = runSimulation(inputs({
            person: person({ lifeExpectancy: 66, rrsp: { type: 'RRSP', balance: 500_000 } }),
            spouse: person({ lifeExpectancy: 80, tfsa: { type: 'TFSA', balance: 1_000_000 } }),
            postRetirementSpend: 10_000
        }));
        const deathYear = res.find(r => r.personDeathThisYear)!;
        expect(deathYear.rrspRolledToSpouse!).toBeGreaterThan(400_000);
        expect(deathYear.totalTerminalTax).toBe(0);
        // Spouse now holds the rolled-over RRSP
        expect(deathYear.spouseAccounts!.rrsp).toBeCloseTo(deathYear.rrspRolledToSpouse!, 0);
    });
});

describe('runMonteCarlo', () => {
    it('returns an empty result for invalid inputs instead of crashing', () => {
        const result = runMonteCarlo(inputs({ person: person({ age: 90, lifeExpectancy: 70 }) }), 10);
        expect(result.percentiles).toEqual([]);
        expect(result.successRate).toBe(0);
        expect(result.medianEndOfPlanAssets).toBe(0);
    });

    it('zero volatility is deterministic: all percentiles collapse to the median', () => {
        const result = runMonteCarlo(inputs({
            person: person({ tfsa: { type: 'TFSA', balance: 5_000_000 } }),
            returnRates: { interest: 0, dividend: 0, capitalGrowth: 0.05, volatility: 0 }
        }), 20);
        expect(result.successRate).toBe(100);
        for (const p of result.percentiles) {
            expect(p.p5).toBeCloseTo(p.p50, 5);
            expect(p.p95).toBeCloseTo(p.p50, 5);
        }
    });

    it('a plan that always runs dry scores 0% success', () => {
        const result = runMonteCarlo(inputs({
            person: person({ tfsa: { type: 'TFSA', balance: 50_000 } }),
            postRetirementSpend: 100_000,
            returnRates: { interest: 0, dividend: 0, capitalGrowth: 0.05, volatility: 0.1 }
        }), 20);
        expect(result.successRate).toBe(0);
    });
});

describe('full-run pin (default inputs)', () => {
    it('matches the stored snapshot — intentional engine changes must update it', () => {
        const res = runSimulation(INITIAL_INPUTS);
        const pinned = res.map(r => ({
            age: r.age,
            assets: Math.round(r.totalAssets),
            tax: Math.round(r.taxPaid),
            shortfall: Math.round(r.shortfall)
        }));
        expect(pinned).toMatchSnapshot();
    });
});
