import { describe, it, expect } from 'vitest';
import { runSimulation, runMonteCarlo } from './projection';
import { calculateIncomeTax } from './tax';
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

describe('netIncome is cash-basis (Total Spend column)', () => {
    it('non-reg funded spending: no double count of taxable gains', () => {
        const res = runSimulation(inputs({
            person: person({
                nonRegistered: { type: 'NonRegistered', balance: 1_500_000, adjustedCostBase: 300_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } }
            })
        }));
        // Cash available = net sale proceeds = target; the 50% taxable-gains
        // inclusion is a tax construct, not cash
        expect(res[0].netIncome).toBeCloseTo(80_000, -1);
    });

    it('dividend gross-up is not counted as cash', () => {
        const res = runSimulation(inputs({
            person: person({
                nonRegistered: { type: 'NonRegistered', balance: 1_500_000, adjustedCostBase: 1_500_000, assetMix: { interest: 0, dividend: 0.5, capitalGain: 0.5 } }
            }),
            returnRates: { interest: 0, dividend: 0.04, capitalGrowth: 0 }
        }));
        // $30k actual dividend cash + $50k all-ACB sale = $80k target; the 38%
        // gross-up must not inflate this
        expect(res[0].netIncome).toBeCloseTo(80_000, -1);
    });

    it('one-time inflows count toward cash available', () => {
        const res = runSimulation(inputs({
            person: person({ tfsa: { type: 'TFSA', balance: 1_000_000 } }),
            oneTimeExpenses: [{ id: '1', name: 'Sale of cottage', amount: 20_000, age: 65, type: 'inflow' }]
        }));
        // $20k inflow + $60k TFSA withdrawal = $80k target
        expect(res[0].netIncome).toBeCloseTo(80_000, 0);
        expect(res[0].totalTFSAWithdrawal).toBeCloseTo(60_000, 0);
    });

    it('forced RRIF minimums beyond the target are reinvested, not shown as spending', () => {
        const res = runSimulation(inputs({
            person: person({ age: 72, lifeExpectancy: 78, rrsp: { type: 'RRSP', balance: 1_000_000 } }),
            postRetirementSpend: 20_000
        }));
        const y = res[0];
        // RRIF minimum (5.28% of $1M gross) far exceeds the $20k target
        expect(y.totalRRSPWithdrawal).toBeGreaterThan(50_000);
        expect(y.reinvestedTFSA + y.reinvestedRRSP + y.reinvestedNonReg).toBeGreaterThan(10_000);
        // Total Spend reports what was spent, not the forced income
        expect(y.netIncome).toBeCloseTo(20_000, 0);
    });

    it('unfunded years: Total Spend = target minus shortfall', () => {
        const res = runSimulation(inputs({
            person: person({ tfsa: { type: 'TFSA', balance: 100_000 } }),
            postRetirementSpend: 200_000
        }));
        // Year 0: $100k TFSA covers half; year 1: nothing left
        expect(res[0].netIncome).toBeCloseTo(200_000 - res[0].shortfall, 0);
        expect(res[1].netIncome).toBeCloseTo(0, 0);
    });

    it('CPP start year: cash available stays at target as CPP displaces withdrawals', () => {
        const res = runSimulation(inputs({
            person: person({ age: 65, lifeExpectancy: 75, cppStartAge: 70, cppContributedYears: 40, rrsp: { type: 'RRSP', balance: 1_500_000 } })
        }));
        const before = res.find(r => r.age === 69)!;
        const after = res.find(r => r.age === 70)!;
        expect(after.cppIncome).toBeGreaterThan(24_000); // 17,196 × 1.42 deferral
        // Total Spend unchanged across the CPP start boundary
        expect(after.netIncome).toBeCloseTo(before.netIncome, 0);
        // CPP reduces the RRSP draw needed
        expect(after.totalRRSPWithdrawal).toBeLessThan(before.totalRRSPWithdrawal - 20_000);
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

describe('non-registered tax modeling', () => {
    it('capital gains inclusion is a flat 50% (the 2/3 proposal was never enacted)', () => {
        // Single person dies with $1M of unrealized gains (ACB 0) and no other income.
        // Terminal tax must equal ordinary tax on exactly 50% of the gains — the old
        // tiered formula would have taxed 0.5×250k + (2/3)×750k = $625k instead.
        const res = runSimulation(inputs({
            person: person({
                lifeExpectancy: 66,
                nonRegistered: { type: 'NonRegistered', balance: 1_000_000, adjustedCostBase: 0, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } }
            }),
            postRetirementSpend: 0
        }));
        const last = res[res.length - 1];
        expect(last.terminalTaxOnCapGains!).toBeCloseTo(calculateIncomeTax(500_000, 'ON', 1, undefined, 66), 0);
    });

    it('equity turnover creates annual tax drag and reduces the terminal gains bill', () => {
        const scenario = (equityTurnoverRate: number) => inputs({
            person: person({
                lifeExpectancy: 70,
                nonRegistered: { type: 'NonRegistered', balance: 1_000_000, adjustedCostBase: 500_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 }, equityTurnoverRate }
            }),
            postRetirementSpend: 0
        });
        const hold = runSimulation(scenario(0));
        const churn = runSimulation(scenario(0.2));

        // Buy-and-hold pays nothing until death
        expect(hold[0].taxPaid).toBe(0);
        // 20% turnover realizes 100k of gains in year 0 → tax due, funded by withdrawal
        expect(churn[0].taxPaid).toBeGreaterThan(5_000);
        // Total Spend stays at target (within the withdrawal solver's ~$1 tolerance)
        // — the turnover tax isn't reported as spending
        expect(Math.abs(churn[0].netIncome)).toBeLessThan(2);
        // Realizing along the way shrinks the deemed gains at death
        const holdLast = hold[hold.length - 1];
        const churnLast = churn[churn.length - 1];
        expect(churnLast.terminalTaxOnCapGains!).toBeLessThan(holdLast.terminalTaxOnCapGains!);
    });

    it('foreign dividends are taxed as ordinary income: more tax than eligible Canadian', () => {
        // Employment income pushes the dividends to a real marginal rate — at low
        // income the personal/age credits absorb the tax in both cases
        const scenario = (mix: { interest: number; dividend: number; foreignDividend?: number; capitalGain: number }) => inputs({
            person: person({
                age: 55, retirementAge: 60, lifeExpectancy: 70, currentIncome: 100_000,
                nonRegistered: { type: 'NonRegistered', balance: 1_000_000, adjustedCostBase: 1_000_000, assetMix: mix }
            }),
            returnRates: { interest: 0, dividend: 0.04, capitalGrowth: 0 }
        });
        const cdn = runSimulation(scenario({ interest: 0, dividend: 0.5, capitalGain: 0.5 }));
        const foreign = runSimulation(scenario({ interest: 0, dividend: 0, foreignDividend: 0.5, capitalGain: 0.5 }));

        // Same $20k dividend cash; no gross-up/credit for the foreign case
        expect(foreign[0].taxPaid).toBeGreaterThan(cdn[0].taxPaid + 1_000);
        // Both still fund the same target spending
        expect(foreign[0].netIncome).toBeCloseTo(cdn[0].netIncome, -1);
    });
});

describe('foreign yield input', () => {
    it('foreign slice uses foreignYield; falls back to dividend yield when unset', () => {
        const scenario = (foreignYield?: number) => inputs({
            person: person({
                tfsa: { type: 'TFSA', balance: 2_000_000 },
                nonRegistered: { type: 'NonRegistered', balance: 1_000_000, adjustedCostBase: 1_000_000, assetMix: { interest: 0, dividend: 0, foreignDividend: 1, capitalGain: 0 } }
            }),
            returnRates: { interest: 0, dividend: 0.04, foreignYield, capitalGrowth: 0 }
        });
        // investmentIncome = foreign dividend cash
        expect(runSimulation(scenario(0.02))[0].investmentIncome).toBeCloseTo(20_000, 0);
        expect(runSimulation(scenario(undefined))[0].investmentIncome).toBeCloseTo(40_000, 0);
    });
});

describe('investment tax attribution by source', () => {
    it('a gains-funded year attributes essentially all tax to capital gains', () => {
        const res = runSimulation(inputs({
            person: person({
                nonRegistered: { type: 'NonRegistered', balance: 1_500_000, adjustedCostBase: 150_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } }
            })
        }));
        const y = res[0];
        expect(y.capGainsTaxPaid).toBeCloseTo(y.taxPaid, 0);
        expect(y.dividendTaxPaid).toBe(0);
        expect(y.interestTaxPaid).toBe(0);
    });

    it('interest and foreign dividends carry more marginal tax than eligible dividends', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 55, retirementAge: 60, lifeExpectancy: 70, currentIncome: 100_000,
                nonRegistered: { type: 'NonRegistered', balance: 1_000_000, adjustedCostBase: 1_000_000, assetMix: { interest: 0.25, dividend: 0.25, foreignDividend: 0.25, capitalGain: 0.25 } }
            }),
            returnRates: { interest: 0.04, dividend: 0.04, capitalGrowth: 0 }
        }));
        const y = res[0];
        // $10k interest + $10k foreign div (ordinary) vs $10k eligible Cdn dividends
        expect(y.interestTaxPaid).toBeGreaterThan(y.dividendTaxPaid);
        expect(y.interestTaxPaid).toBeGreaterThan(3_000); // ~$20k ordinary at ~30%+
    });
});

describe('household non-reg mix and tax breakdown', () => {
    it("spouse's non-reg uses the primary person's asset mix and turnover", () => {
        const base = {
            person: person({
                nonRegistered: { type: 'NonRegistered' as const, balance: 500_000, adjustedCostBase: 250_000, assetMix: { interest: 0.2, dividend: 0.3, capitalGain: 0.5 }, equityTurnoverRate: 0.1 }
            }),
            returnRates: { interest: 0.03, dividend: 0.04, capitalGrowth: 0.05 }
        };
        const spouseWith = (mix: { interest: number; dividend: number; foreignDividend?: number; capitalGain: number }) =>
            person({ nonRegistered: { type: 'NonRegistered', balance: 400_000, adjustedCostBase: 100_000, assetMix: mix } });

        // A wildly different stored spouse mix must produce identical results,
        // because the engine overrides it with the household mix
        const a = runSimulation(inputs({ ...base, spouse: spouseWith({ interest: 1, dividend: 0, capitalGain: 0 }) }));
        const b = runSimulation(inputs({ ...base, spouse: spouseWith({ interest: 0.2, dividend: 0.3, capitalGain: 0.5 }) }));
        expect(a).toEqual(b);
    });

    it('per-person taxes sum to the household total; OAS clawback is surfaced', () => {
        const res = runSimulation(inputs({
            person: person({ oasStartAge: 65, rrsp: { type: 'RRSP', balance: 3_000_000 } }),
            spouse: person({ rrsp: { type: 'RRSP', balance: 1_000_000 } }),
            postRetirementSpend: 250_000
        }));
        const y = res[0];
        expect(y.personTaxPaid + y.spouseTaxPaid).toBeCloseTo(y.taxPaid, 0);
        // ~$150k+ of RRSP income each puts the person deep into clawback territory
        expect(y.oasClawbackPaid).toBeGreaterThan(1_000);
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
