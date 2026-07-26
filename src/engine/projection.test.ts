import { describe, it, expect } from 'vitest';
import { runSimulation, runMonteCarlo, lognormalReturn } from './projection';
import { calculateIncomeTax, calculateOASClawback, calculateTotalTax } from './tax';
import type { Person, NonRegisteredAccount, SimulationInputs, SimulationResult } from './types';
import { INITIAL_INPUTS } from '../utils/inputSanitizer';

// All-equity zero-balance non-reg account to build cases on
const nonReg = (over: Partial<NonRegisteredAccount> = {}): NonRegisteredAccount => ({
    type: 'NonRegistered', id: 'nr', name: 'Non-Registered',
    balance: 0, adjustedCostBase: 0,
    assetMix: { bonds: 0, cash: 0, dividend: 0, capitalGain: 1 },
    ...over
});

// Retired 65-year-old with empty accounts and no CPP/OAS — a blank slate to build cases on
const person = (over: Partial<Person> = {}): Person => ({
    age: 65, retirementAge: 60, lifeExpectancy: 70,
    currentIncome: 0, cppStartAge: 69, cppContributedYears: 0, oasStartAge: 69,
    rrsp: { type: 'RRSP', balance: 0 },
    tfsa: { type: 'TFSA', balance: 0 },
    nonRegisteredAccounts: [nonReg()],
    ...over
});

const inputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => ({
    person: person(), province: 'ON', inflationRate: 0,
    preRetirementSpend: 0, postRetirementSpend: 80_000,
    oneTimeExpenses: [], useIncomeSplitting: false, withdrawalStrategy: 'tax-efficient',
    returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0, capitalGrowth: 0 },
    ...over
});

describe('wealth reconciliation invariants', () => {
    it('zero-return drawdown: assets fall by exactly the gross withdrawals', () => {
        const res = runSimulation(inputs({
            person: person({
                rrsp: { type: 'RRSP', balance: 300_000 },
                tfsa: { type: 'TFSA', balance: 200_000 },
                nonRegisteredAccounts: [nonReg({ balance: 400_000, adjustedCostBase: 100_000 })]
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
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0, capitalGrowth: 0.05 }
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
                nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 100_000 })]
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
                nonRegisteredAccounts: [nonReg({ balance: 500_000, adjustedCostBase: 500_000 })]
            })
        }));
        expect(res[0].totalNonRegWithdrawal).toBeCloseTo(res[0].netNonRegWithdrawal, 0);
        expect(res[0].taxPaid).toBe(0);
        // The zero-gain fast path nets the target exactly — not just within the
        // binary search's $1 tolerance
        expect(res[0].netNonRegWithdrawal).toBeCloseTo(80_000, 5);
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
            person: person({ nonRegisteredAccounts: [nonReg({ balance: 20_000, adjustedCostBase: 20_000 })] }),
            spouse: person({ nonRegisteredAccounts: [nonReg({ balance: 900_000, adjustedCostBase: 900_000 })] })
        }));
        expect(res[0].shortfall).toBeLessThan(2);
        expect(res[0].netNonRegWithdrawal).toBeCloseTo(80_000, -1);
    });
});

describe('netIncome is cash-basis (Total Spend column)', () => {
    it('non-reg funded spending: no double count of taxable gains', () => {
        const res = runSimulation(inputs({
            person: person({
                nonRegisteredAccounts: [nonReg({ balance: 1_500_000, adjustedCostBase: 300_000 })]
            })
        }));
        // Cash available = net sale proceeds = target; the 50% taxable-gains
        // inclusion is a tax construct, not cash
        expect(res[0].netIncome).toBeCloseTo(80_000, -1);
    });

    it('dividend gross-up is not counted as cash', () => {
        const res = runSimulation(inputs({
            person: person({
                nonRegisteredAccounts: [nonReg({ balance: 1_500_000, adjustedCostBase: 1_500_000, assetMix: { bonds: 0, cash: 0, dividend: 0.5, capitalGain: 0.5 } })]
            }),
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0.04, capitalGrowth: 0 }
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
        // Total Spend unchanged across the CPP start boundary. Both years land on
        // target within the withdrawal solver's own ~$1 convergence tolerance, so
        // compare them at that resolution rather than to the cent.
        expect(Math.abs(after.netIncome - before.netIncome)).toBeLessThan(2);
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

describe('RRSP withdrawal breakdown partitions the total', () => {
    // The drawer shows a user how much of a large withdrawal was legally forced.
    // If these three ever stop summing to the total, some component has been
    // mis-mapped and the breakdown is lying about what was mandatory.
    const partitionFixtures: Array<[string, SimulationInputs]> = [
        ['default plan (INITIAL_INPUTS)', INITIAL_INPUTS],
        ['default plan with spouse', {
            ...INITIAL_INPUTS,
            spouse: { ...INITIAL_INPUTS.person, age: 45, currentIncome: 50_000 }
        }],
        // Melt runs right up to 71, RRIF starts at 72 — the transition year has
        // a RRIF minimum and no melt, its predecessor the reverse.
        ['melt/RRIF transition (age 68 → 76)', inputs({
            person: person({
                age: 68, retirementAge: 60, lifeExpectancy: 76,
                rrspMeltStartAge: 60, rrspMeltAmount: 25_000,
                rrsp: { type: 'RRSP', balance: 900_000 },
                tfsa: { type: 'TFSA', balance: 100_000 }
            }),
            postRetirementSpend: 70_000
        })],
        // Couple whose melt, RRIF and top-up draws all overlap, with a death year
        // (spouse dies at 74, RRSP rolls to the survivor) and income splitting on.
        ['couple with a death year', inputs({
            inflationRate: 0.02,
            useIncomeSplitting: true,
            person: person({
                age: 70, lifeExpectancy: 85, cppStartAge: 65, cppContributedYears: 38,
                oasStartAge: 65, rrspMeltStartAge: 70, rrspMeltAmount: 30_000,
                rrsp: { type: 'RRSP', balance: 800_000 },
                nonRegisteredAccounts: [nonReg({ balance: 200_000, adjustedCostBase: 120_000, receivesSurplus: true })]
            }),
            spouse: person({
                age: 71, lifeExpectancy: 74, cppStartAge: 65, cppContributedYears: 30,
                oasStartAge: 65, rrspMeltStartAge: 71, rrspMeltAmount: 20_000,
                rrsp: { type: 'RRSP', balance: 400_000 },
                nonRegisteredAccounts: [nonReg({ balance: 80_000, adjustedCostBase: 60_000, receivesSurplus: true })]
            }),
            postRetirementSpend: 95_000,
            returnRates: { bondReturn: 0.03, cashInterest: 0.02, dividend: 0.03, capitalGrowth: 0.05 }
        })],
        // Every account drains: top-ups are capped by the balance, so the
        // components must still add up in a year the plan fails.
        ['shortfall years', inputs({
            person: person({
                age: 66, lifeExpectancy: 72, rrspMeltStartAge: 66, rrspMeltAmount: 40_000,
                rrsp: { type: 'RRSP', balance: 120_000 }, tfsa: { type: 'TFSA', balance: 20_000 }
            }),
            postRetirementSpend: 100_000
        })],
        // rrsp-first ordering exercises the doWithdraw fallback round
        ['rrsp-first couple', inputs({
            withdrawalStrategy: 'rrsp-first',
            person: person({ age: 73, lifeExpectancy: 82, rrsp: { type: 'RRSP', balance: 500_000 } }),
            spouse: person({ age: 73, lifeExpectancy: 80, rrsp: { type: 'RRSP', balance: 40_000 } }),
            postRetirementSpend: 90_000
        })]
    ];

    for (const [name, ins] of partitionFixtures) {
        it(`${name}: rrif + voluntary melt + top-up === totalRRSPWithdrawal, every year`, () => {
            const res = runSimulation(ins);
            expect(res.length).toBeGreaterThan(0);
            for (let i = 0; i < res.length; i++) {
                const r = res[i];
                const sum = r.rrifMinimumWithdrawal + r.voluntaryMeltWithdrawal + r.topUpWithdrawal;
                expect(sum, `${name} i=${i} (age ${r.age})`).toBeCloseTo(r.totalRRSPWithdrawal, 6);
                expect(r.rrifMinimumWithdrawal, `${name} i=${i} rrif`).toBeGreaterThanOrEqual(0);
                expect(r.voluntaryMeltWithdrawal, `${name} i=${i} melt`).toBeGreaterThanOrEqual(0);
                expect(r.topUpWithdrawal, `${name} i=${i} topUp`).toBeGreaterThanOrEqual(0);
            }
        });
    }

    it('the age-71→72 boundary moves the draw from voluntary to mandatory', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 69, retirementAge: 60, lifeExpectancy: 75,
                rrspMeltStartAge: 60, rrspMeltAmount: 25_000,
                rrsp: { type: 'RRSP', balance: 600_000 },
                tfsa: { type: 'TFSA', balance: 400_000 }
            }),
            postRetirementSpend: 30_000
        }));
        const at71 = res.find(r => r.age === 71)!;
        const at72 = res.find(r => r.age === 72)!;
        // 71: the melt is still running, nothing is forced
        expect(at71.rrifMinimumWithdrawal).toBe(0);
        expect(at71.voluntaryMeltWithdrawal).toBeCloseTo(25_000, 6);
        // 72: the melt has stopped and the RRIF minimum takes over
        expect(at72.voluntaryMeltWithdrawal).toBe(0);
        expect(at72.rrifMinimumWithdrawal).toBeGreaterThan(0);
        expect(at72.rrifMinimumWithdrawal).toBeCloseTo(at72.totalRRSPWithdrawal - at72.topUpWithdrawal, 6);
    });

    it('a top-up appears only when base income leaves a spending deficit', () => {
        // Forced RRIF minimum far exceeds the target, so nothing extra is drawn.
        const covered = runSimulation(inputs({
            person: person({ age: 74, lifeExpectancy: 78, rrsp: { type: 'RRSP', balance: 2_000_000 } }),
            postRetirementSpend: 20_000
        }));
        expect(covered[0].rrifMinimumWithdrawal).toBeGreaterThan(20_000);
        expect(covered[0].topUpWithdrawal).toBe(0);

        // Same age, small balance: the minimum can't fund the target, so Step 3 tops up.
        const short = runSimulation(inputs({
            person: person({ age: 74, lifeExpectancy: 78, rrsp: { type: 'RRSP', balance: 400_000 } }),
            postRetirementSpend: 60_000
        }));
        expect(short[0].topUpWithdrawal).toBeGreaterThan(0);
        expect(short[0].voluntaryMeltWithdrawal).toBe(0); // melt never runs past 71
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
                nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 0 })]
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
                nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 500_000, equityTurnoverRate })]
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
        const scenario = (mix: { bonds: number; cash: number; dividend: number; foreignDividend?: number; capitalGain: number }) => inputs({
            person: person({
                age: 55, retirementAge: 60, lifeExpectancy: 70, currentIncome: 100_000,
                nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 1_000_000, assetMix: mix })]
            }),
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0.04, capitalGrowth: 0 }
        });
        const cdn = runSimulation(scenario({ bonds: 0, cash: 0, dividend: 0.5, capitalGain: 0.5 }));
        const foreign = runSimulation(scenario({ bonds: 0, cash: 0, dividend: 0, foreignDividend: 0.5, capitalGain: 0.5 }));

        // Same $20k dividend cash; no gross-up/credit for the foreign case
        expect(foreign[0].taxPaid).toBeGreaterThan(cdn[0].taxPaid + 1_000);
        // Both still fund the same target spending
        expect(foreign[0].netIncome).toBeCloseTo(cdn[0].netIncome, -1);
    });
});

describe('per-account growth rates', () => {
    it('RRSP and TFSA grow at their own rates; non-reg equity at capitalGrowth', () => {
        const res = runSimulation(inputs({
            person: person({
                rrsp: { type: 'RRSP', balance: 100_000 },
                tfsa: { type: 'TFSA', balance: 100_000 },
                nonRegisteredAccounts: [nonReg({ balance: 100_000, adjustedCostBase: 100_000 })]
            }),
            postRetirementSpend: 0, // no withdrawals — pure growth
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0, capitalGrowth: 0.05, rrspGrowth: 0.07, tfsaGrowth: 0.03 }
        }));
        const y = res[0];
        expect(y.accounts.rrsp).toBeCloseTo(107_000, 0);
        expect(y.accounts.tfsa).toBeCloseTo(103_000, 0);
        expect(y.accounts.nonRegistered).toBeCloseTo(105_000, 0);
    });

    it('unset per-account rates fall back to capitalGrowth', () => {
        const res = runSimulation(inputs({
            person: person({ rrsp: { type: 'RRSP', balance: 100_000 }, tfsa: { type: 'TFSA', balance: 1_000_000 } }),
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0, capitalGrowth: 0.05 }
        }));
        expect(res[0].accounts.rrsp).toBeCloseTo(105_000, 0);
    });
});

describe('RRSP contributions are deductible', () => {
    // Surplus routed into an RRSP used to raise the balance without any tax relief,
    // so the engine gave the balance credit but never the refund.
    const contributor = () => inputs({
        province: 'AB', // no Ontario Health Premium to muddy the arithmetic
        person: person({
            age: 50, retirementAge: 60, lifeExpectancy: 62,
            currentIncome: 120_000,
        }),
        preRetirementSpend: 50_000,
        postRetirementSpend: 50_000,
    });

    it('the contribution comes off taxable income', () => {
        const y = runSimulation(contributor())[0];
        expect(y.reinvestedRRSP).toBeGreaterThan(0); // precondition: surplus reached the RRSP

        // No investment income in this fixture, so gross income is just salary. The
        // reported taxable income sits below it by the RRSP contribution AND the
        // deductible half of CPP (enhanced 1% of pensionable earnings, plus all of
        // CPP2) — both are deductions, not credits.
        expect(y.investmentIncome).toBe(0);
        const cppDeductible = (71_300 - 3_500) * 0.01 + (81_300 - 71_300) * 0.04;
        expect(y.grossIncome).toBeCloseTo(y.employmentIncome - y.reinvestedRRSP - cppDeductible, 0);
    });

    it('the refund is kept as assets rather than inflating spending', () => {
        const y = runSimulation(contributor())[0];
        // Step 4 sized the surplus on the undeducted tax bill, so the deduction frees
        // up cash after the fact. It must land in an account — Total Spend stays on target.
        expect(y.netIncome).toBeCloseTo(50_000, -1);
        expect(y.shortfall).toBe(0);
        // Starting from zero balances, every dollar reinvested shows up as assets.
        const reinvested = y.reinvestedTFSA + y.reinvestedRRSP + y.reinvestedNonReg;
        expect(y.totalAssets).toBeCloseTo(reinvested, 0);
        expect(y.reinvestedNonReg).toBeGreaterThan(0); // the refund itself
    });

    it('a retiree making no contribution is unaffected', () => {
        const y = runSimulation(inputs({
            province: 'AB',
            person: person({ age: 65, retirementAge: 60, lifeExpectancy: 70, rrsp: { type: 'RRSP', balance: 500_000 } }),
            postRetirementSpend: 40_000,
        }))[0];
        expect(y.reinvestedRRSP).toBe(0);
        expect(y.grossIncome).toBeCloseTo(y.totalRRSPWithdrawal, 0);
    });
});

describe('non-reg rebalancing vs drift', () => {
    const driftInputs = (rebalance: boolean) => inputs({
        person: person({
            lifeExpectancy: 80, oasStartAge: 99, // no OAS — its surplus would get reinvested and muddy the drift check
            nonRegisteredAccounts: [nonReg({
                balance: 1_000_000, adjustedCostBase: 1_000_000,
                assetMix: { bonds: 0, cash: 0, dividend: 0.5, capitalGain: 0.5 },
                rebalanceAnnually: rebalance
            })]
        }),
        // Alberta, not Ontario: the Ontario Health Premium is a flat levy that
        // non-refundable credits do NOT offset, so an Ontario filer here would owe
        // $300 even though the DTC wipes out their income tax — enough of a deficit
        // to force small sales and muddy the drift measurement.
        province: 'AB',
        // Spend exactly the dividend cash (tax-free at this income thanks to the DTC):
        // no deficit → no sales; no surplus → no reinvestment. Isolates growth/drift.
        postRetirementSpend: 20_000,
        returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0.04, capitalGrowth: 0.06 }
    });

    it('rebalanced (default): dividend income grows with the account', () => {
        const res = runSimulation(driftInputs(true));
        expect(res[0].investmentIncome).toBeCloseTo(20_000, 0);
        expect(res[5].investmentIncome).toBeGreaterThan(21_000);
        // Weights stay at the inputs
        expect(res[10].nonRegMix!.capitalGain).toBeCloseTo(0.5, 5);
    });

    it('drift: dividend income stays flat in dollars; equity share climbs', () => {
        const res = runSimulation(driftInputs(false));
        expect(res[0].investmentIncome).toBeCloseTo(20_000, 0);
        // Dividend sleeve never grows → flat income
        expect(res[5].investmentIncome).toBeCloseTo(20_000, 0);
        expect(res[14].investmentIncome).toBeCloseTo(20_000, 0);
        // Equity weight drifts up: 0.5 → 0.5(1.06)^n / (0.5(1.06)^n + 0.5)
        const y10 = res[10].nonRegMix!;
        const expected = (0.5 * Math.pow(1.06, 11)) / (0.5 * Math.pow(1.06, 11) + 0.5);
        expect(y10.capitalGain).toBeCloseTo(expected, 4);
        expect(y10.capitalGain).toBeGreaterThan(0.6);
    });
});

describe('per-person non-reg mixes', () => {
    const allCash = { bonds: 0, cash: 1, dividend: 0, capitalGain: 0 };

    it('nonRegMix and spouseNonRegMix reflect each person\'s own accounts', () => {
        const res = runSimulation(inputs({
            person: person({ nonRegisteredAccounts: [nonReg({ balance: 500_000, adjustedCostBase: 500_000, assetMix: allCash })] }),
            spouse: person({ nonRegisteredAccounts: [nonReg({ balance: 500_000, adjustedCostBase: 500_000 })] }), // all equity
            postRetirementSpend: 0
        }));
        expect(res[0].nonRegMix!.cash).toBeCloseTo(1, 5);
        expect(res[0].nonRegMix!.capitalGain).toBeCloseTo(0, 5);
        expect(res[0].spouseNonRegMix!.capitalGain).toBeCloseTo(1, 5);
    });

    it('rollover: deceased\'s mix goes undefined; survivor\'s blend includes inherited accounts', () => {
        const res = runSimulation(inputs({
            person: person({ lifeExpectancy: 66, nonRegisteredAccounts: [nonReg({ balance: 300_000, adjustedCostBase: 300_000, assetMix: allCash })] }),
            spouse: person({ lifeExpectancy: 80, nonRegisteredAccounts: [nonReg({ balance: 100_000, adjustedCostBase: 100_000 })] }),
            postRetirementSpend: 0
        }));
        const deathYear = res.find(r => r.personDeathThisYear)!;
        // Accounts rolled to the spouse — no zeros-mix for the deceased
        expect(deathYear.nonRegMix).toBeUndefined();
        // Survivor now blends $100k equity + $300k inherited cash
        expect(deathYear.spouseNonRegMix!.capitalGain).toBeCloseTo(0.25, 5);
        expect(deathYear.spouseNonRegMix!.cash).toBeCloseTo(0.75, 5);
    });

    it('nonRegDriftMix blends only accounts with rebalancing off', () => {
        const res = runSimulation(inputs({
            person: person({
                lifeExpectancy: 80, oasStartAge: 99,
                nonRegisteredAccounts: [
                    nonReg({ id: 'gic', balance: 500_000, adjustedCostBase: 500_000, assetMix: allCash, rebalanceAnnually: true }),
                    nonReg({ id: 'etf', balance: 50_000, adjustedCostBase: 50_000, rebalanceAnnually: false })
                ]
            }),
            postRetirementSpend: 0,
            returnRates: { bondReturn: 0, cashInterest: 0.03, dividend: 0, capitalGrowth: 0.06 }
        }));
        // Drift readout sees only the all-equity account — the big rebalanced
        // GIC can't register as drift no matter how balances shift between them
        expect(res[0].nonRegDriftMix!.capitalGain).toBeCloseTo(1, 5);
        expect(res[res.length - 1].nonRegDriftMix!.capitalGain).toBeCloseTo(1, 5);
        // The all-accounts blend still reflects both
        expect(res[0].nonRegMix!.capitalGain).toBeLessThan(0.2);
    });

    it('drift mix is undefined when every account rebalances', () => {
        const res = runSimulation(inputs({ postRetirementSpend: 0 }));
        expect(res[0].nonRegDriftMix).toBeUndefined();
        expect(res[0].spouseNonRegDriftMix).toBeUndefined();
    });
});

describe('foreign yield input', () => {
    it('foreign slice uses foreignYield; falls back to dividend yield when unset', () => {
        const scenario = (foreignYield?: number) => inputs({
            person: person({
                tfsa: { type: 'TFSA', balance: 2_000_000 },
                nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 1_000_000, assetMix: { bonds: 0, cash: 0, dividend: 0, foreignDividend: 1, capitalGain: 0 } })]
            }),
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0.04, foreignYield, capitalGrowth: 0 }
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
                nonRegisteredAccounts: [nonReg({ balance: 1_500_000, adjustedCostBase: 150_000 })]
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
                nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 1_000_000, assetMix: { bonds: 0, cash: 0.25, dividend: 0.25, foreignDividend: 0.25, capitalGain: 0.25 } })]
            }),
            returnRates: { bondReturn: 0, cashInterest: 0.04, dividend: 0.04, capitalGrowth: 0 }
        }));
        const y = res[0];
        // $10k interest + $10k foreign div (ordinary) vs $10k eligible Cdn dividends
        expect(y.interestTaxPaid).toBeGreaterThan(y.dividendTaxPaid);
        expect(y.interestTaxPaid).toBeGreaterThan(3_000); // ~$20k ordinary at ~30%+
    });

    it('bonds and cash slices earn their own rates; both are ordinary income', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 55, retirementAge: 60, lifeExpectancy: 70, currentIncome: 100_000,
                nonRegisteredAccounts: [nonReg({ balance: 500_000, adjustedCostBase: 500_000, assetMix: { bonds: 0.5, cash: 0.5, dividend: 0, capitalGain: 0 } })]
            }),
            returnRates: { bondReturn: 0.04, cashInterest: 0.02, dividend: 0, capitalGrowth: 0 }
        }));
        const y = res[0];
        // 500k × (50% × 4% + 50% × 2%)
        expect(y.investmentIncome).toBeCloseTo(15_000, 0);
        expect(y.interestTaxPaid).toBeGreaterThan(0);
        expect(y.dividendTaxPaid).toBe(0);
    });
});

describe('per-account non-reg mixes and tax breakdown', () => {
    it("spouse's non-reg uses its own asset mix (household override removed)", () => {
        const base = {
            person: person({
                nonRegisteredAccounts: [nonReg({ balance: 500_000, adjustedCostBase: 250_000, assetMix: { bonds: 0, cash: 0.2, dividend: 0.3, capitalGain: 0.5 }, equityTurnoverRate: 0.1 })]
            }),
            returnRates: { bondReturn: 0, cashInterest: 0.03, dividend: 0.04, capitalGrowth: 0.05 }
        };
        const spouseWith = (mix: { bonds: number; cash: number; dividend: number; foreignDividend?: number; capitalGain: number }) =>
            person({ nonRegisteredAccounts: [nonReg({ balance: 400_000, adjustedCostBase: 100_000, assetMix: mix })] });

        // All-cash spouse: 400k × 3% = 12k interest; mixed spouse: 2.4k interest
        // + 4.8k dividends. Different mixes must now produce different results.
        const allCash = runSimulation(inputs({ ...base, spouse: spouseWith({ bonds: 0, cash: 1, dividend: 0, capitalGain: 0 }) }));
        const mixed = runSimulation(inputs({ ...base, spouse: spouseWith({ bonds: 0, cash: 0.2, dividend: 0.3, capitalGain: 0.5 }) }));
        expect(allCash[0].investmentIncome - mixed[0].investmentIncome).toBeCloseTo(12_000 - (2_400 + 4_800), 0);
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

describe('multiple non-registered accounts', () => {
    it('income sums across accounts with different mixes', () => {
        const res = runSimulation(inputs({
            person: person({
                tfsa: { type: 'TFSA', balance: 2_000_000 }, // funds spending so nothing is sold
                nonRegisteredAccounts: [
                    nonReg({ id: 'gic', balance: 500_000, adjustedCostBase: 500_000, assetMix: { bonds: 0, cash: 1, dividend: 0, capitalGain: 0 } }),
                    nonReg({ id: 'div', balance: 500_000, adjustedCostBase: 500_000, assetMix: { bonds: 0, cash: 0, dividend: 1, capitalGain: 0 } })
                ]
            }),
            returnRates: { bondReturn: 0, cashInterest: 0.02, dividend: 0.04, capitalGrowth: 0 }
        }));
        // 500k × 2% interest + 500k × 4% dividends
        expect(res[0].investmentIncome).toBeCloseTo(10_000 + 20_000, 0);
    });

    it('sells from the highest-ACB account first (least gain per dollar)', () => {
        const res = runSimulation(inputs({
            person: person({
                nonRegisteredAccounts: [
                    nonReg({ id: 'gains', balance: 1_000_000, adjustedCostBase: 100_000 }),
                    nonReg({ id: 'cash', balance: 300_000, adjustedCostBase: 300_000 })
                ]
            })
        }));
        // The $80k target fits inside the all-ACB account → no gains realized, no tax
        expect(res[0].taxPaid).toBe(0);
        expect(res[0].totalNonRegWithdrawal).toBeCloseTo(80_000, -1);
        expect(res[0].totalRealizedCapGains).toBe(0);
    });

    it('one account split in two (same mix and ACB ratio) matches the single account', () => {
        const single = runSimulation(inputs({
            person: person({ nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 400_000 })] })
        }));
        const split = runSimulation(inputs({
            person: person({
                nonRegisteredAccounts: [
                    nonReg({ id: 'a', balance: 500_000, adjustedCostBase: 200_000 }),
                    nonReg({ id: 'b', balance: 500_000, adjustedCostBase: 200_000 })
                ]
            })
        }));
        // The two-account run puts the binary search through one extra pass per
        // year, so its ~$1/year convergence error accumulates slightly differently.
        // Compare relatively: anything under a thousandth of a percent is solver
        // noise, not a behavioural difference between one account and two.
        const near = (a: number, b: number) =>
            expect(Math.abs(a - b)).toBeLessThan(Math.max(10, Math.abs(b) * 1e-5));
        for (let i = 0; i < single.length; i++) {
            near(split[i].totalAssets, single[i].totalAssets);
            near(split[i].taxPaid, single[i].taxPaid);
            near(split[i].accounts.nonRegisteredACB, single[i].accounts.nonRegisteredACB);
        }
    });

    it('surplus is swept into the flagged account only', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 72, lifeExpectancy: 75,
                rrsp: { type: 'RRSP', balance: 2_000_000 }, // forced RRIF minimums create surplus
                nonRegisteredAccounts: [
                    nonReg({ id: 'a', balance: 100_000, adjustedCostBase: 100_000 }),
                    nonReg({ id: 'b', balance: 100_000, adjustedCostBase: 100_000, receivesSurplus: true })
                ]
            }),
            postRetirementSpend: 10_000
        }));
        const y = res[0];
        expect(y.reinvestedNonReg).toBeGreaterThan(10_000);
        // Account 'a' only grew (0% here) — all surplus landed in 'b', so the
        // combined ACB rose by exactly the reinvested amount
        expect(y.accounts.nonRegisteredACB).toBeCloseTo(200_000 + y.reinvestedNonReg, 0);
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

    it('younger spouse outliving the primary: projection runs to the spouse death year and taxes their estate', () => {
        const res = runSimulation(inputs({
            // Primary dies first (85); younger spouse outlives them (dies at 90)
            person: person({ age: 65, lifeExpectancy: 85, tfsa: { type: 'TFSA', balance: 500_000 } }),
            spouse: person({ age: 60, lifeExpectancy: 90, rrsp: { type: 'RRSP', balance: 800_000 } }),
            postRetirementSpend: 20_000
        }));
        const last = res[res.length - 1];
        // The simulation must run all the way to the spouse's death year, not stop
        // early in the primary person's age scale (the age-difference-sign bug)
        expect(last.spouseDeathThisYear).toBe(true);
        expect(last.spouseAge).toBe(90);
        // The spouse's estate is taxed via deemed disposition (RRSP), so terminal tax > 0
        expect(last.totalTerminalTax!).toBeGreaterThan(0);
        expect(last.netEstateValue).toBeCloseTo(last.grossEstateValue! - last.totalTerminalTax!, 0);
    });
});

// The death-year deemed disposition is priced as an INCREMENTAL tax: the year's tax
// with the deemed income minus the year's tax without it. Both terms have to use the
// same tax arguments (pension credit, dividend tax credit, OAS clawback) or the
// subtraction stops isolating the deemed disposition and starts folding in credit and
// clawback errors. These tests rebuild the correct figure from the reported row and
// compare, rather than pinning magic numbers.
describe('death-year terminal tax (no surviving spouse)', () => {
    // Everything the engine used at the death site is recoverable from the row:
    // grossIncome is the year's finalTaxable, taxPaid is finalTax (single person, no
    // splitting), and the pre-tax RRSP balance is the reported balance plus the share
    // of terminal tax charged to it.
    const deemedTaxableOf = (row: SimulationResult): number => {
        const rrspPreTax = row.accounts.rrsp + row.terminalTaxOnRRSP!;
        const taxableGains = row.terminalRealizedGains * 0.5;
        return row.grossIncome + rrspPreTax + taxableGains;
    };

    // The correct calculation: identical credits and OAS-clawback treatment to the
    // baseline year, applied to the deemed-inclusive income. `qualifiedPension` is the
    // row's DB pension income — every scenario below dies before 72, so there is no
    // RRIF income to add.
    const symmetricTerminalTax = (row: SimulationResult, age: number, divIncome = 0): number => {
        const taxWithDeemed = calculateTotalTax(
            deemedTaxableOf(row), row.oasIncome, 'ON', 1, age, row.pensionIncome, divIncome * 1.38
        ).total;
        return Math.max(0, taxWithDeemed - row.taxPaid);
    };

    // Same symmetric calculation but with the credits stripped out, isolating exactly
    // what the pension/dividend credits are worth against the deemed disposition.
    const creditStrippedTerminalTax = (row: SimulationResult, age: number): number =>
        Math.max(0, calculateTotalTax(deemedTaxableOf(row), row.oasIncome, 'ON', 1, age, 0, 0).total - row.taxPaid);

    it('(a) DB pension income: the pension credit survives the subtraction', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 65, retirementAge: 60, lifeExpectancy: 70,
                cppStartAge: 99, oasStartAge: 99, // isolate the pension credit
                rrsp: { type: 'RRSP', balance: 400_000 },
                pension: { annualAmount: 40_000, startAge: 65, indexedToInflation: true }
            }),
            postRetirementSpend: 40_000
        }));
        const last = res[res.length - 1];
        expect(last.personDeathThisYear).toBe(true);
        expect(last.pensionIncome).toBeCloseTo(40_000, 0);
        expect(last.totalTerminalTax!).toBeGreaterThan(0);

        expect(last.totalTerminalTax!).toBeCloseTo(symmetricTerminalTax(last, 70), 2);
        // The credit-stripped version double-charges the pension credit ($2,000 at
        // ~20% federal+provincial), so the corrected figure must be strictly lower.
        const naive = creditStrippedTerminalTax(last, 70);
        expect(last.totalTerminalTax!).toBeLessThan(naive);
        // Federal 14% of the $2,000 federal pension amount, plus Ontario's own
        // $1,762 amount at Ontario's own 5.05%, grossed up by both surtax tiers
        // (x1.56) since the surtax applies after non-refundable credits.
        expect(naive - last.totalTerminalTax!)
            .toBeCloseTo(2_000 * 0.14 + 1_762 * 0.0505 * 1.56, 0);
    });

    it('(b) eligible Canadian dividends: the dividend tax credit survives the subtraction', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 65, retirementAge: 60, lifeExpectancy: 66,
                cppStartAge: 99, oasStartAge: 99,
                rrsp: { type: 'RRSP', balance: 500_000 },
                // All-dividend, ACB = balance: no capital growth and no embedded gain,
                // so the deemed disposition is purely the RRSP.
                nonRegisteredAccounts: [nonReg({
                    balance: 1_500_000, adjustedCostBase: 1_500_000,
                    assetMix: { bonds: 0, cash: 0, dividend: 1, capitalGain: 0 }
                })]
            }),
            postRetirementSpend: 60_000,
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0.04, capitalGrowth: 0 }
        }));
        const last = res[res.length - 1];
        expect(last.personDeathThisYear).toBe(true);
        const divIncome = last.investmentIncome; // dividends only in this scenario
        // Not exactly $60k: the Ontario Health Premium is payable even though the
        // DTC zeroes out income tax, so a small sale trims the sleeve slightly.
        expect(divIncome).toBeCloseTo(60_000, -2);

        expect(last.totalTerminalTax!).toBeCloseTo(symmetricTerminalTax(last, 66, divIncome), 2);
        // ON DTC on the grossed-up amount: 15.02% federal, plus 10% provincial
        // grossed up by both Ontario surtax tiers (x1.56).
        const naive = creditStrippedTerminalTax(last, 66);
        expect(last.totalTerminalTax!).toBeLessThan(naive);
        expect(naive - last.totalTerminalTax!).toBeCloseTo(divIncome * 1.38 * (0.1502 + 0.10 * 1.56), 0);
    });

    it('(c) OAS clawback: the deemed income carries its own clawback', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 65, retirementAge: 60, lifeExpectancy: 70,
                cppStartAge: 99, oasStartAge: 65,
                rrsp: { type: 'RRSP', balance: 3_000_000 }
            }),
            postRetirementSpend: 100_000
        }));
        const last = res[res.length - 1];
        expect(last.personDeathThisYear).toBe(true);
        // The clawback is genuinely in play at baseline, not just at death
        expect(last.oasClawbackPaid).toBeGreaterThan(0);

        expect(last.totalTerminalTax!).toBeCloseTo(symmetricTerminalTax(last, 70), 2);
        // The OAS repayment is deducted before tax is computed, so the corrected bill
        // sits below the old formula that taxed the clawed-back OAS in full AND added
        // the recovery on top.
        const deemed = deemedTaxableOf(last);
        const doubleTaxed = Math.max(0,
            calculateIncomeTax(deemed, 'ON', 1, undefined, 70, last.pensionIncome, 0)
            + calculateOASClawback(deemed, last.oasIncome, 1)
            - last.taxPaid);
        expect(last.totalTerminalTax!).toBeLessThan(doubleTaxed);
    });

    it('(d) control — no pension, dividends or OAS: behavior is unchanged', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 65, retirementAge: 60, lifeExpectancy: 66,
                cppStartAge: 99, oasStartAge: 99,
                rrsp: { type: 'RRSP', balance: 500_000 }
            }),
            postRetirementSpend: 0
        }));
        const last = res[res.length - 1];
        expect(last.pensionIncome).toBe(0);
        expect(last.oasIncome).toBe(0);
        expect(last.investmentIncome).toBe(0);
        // With no credits and no OAS the two formulations coincide exactly
        expect(last.totalTerminalTax!).toBeCloseTo(symmetricTerminalTax(last, 66), 6);
        expect(last.totalTerminalTax!).toBeCloseTo(creditStrippedTerminalTax(last, 66), 6);
        expect(last.totalTerminalTax!).toBeCloseTo(calculateIncomeTax(500_000, 'ON', 1, undefined, 66), 0);
    });

    it('applies to a surviving-spouse-less second death too (both die the same year)', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 65, retirementAge: 60, lifeExpectancy: 66,
                cppStartAge: 99, oasStartAge: 99, rrsp: { type: 'RRSP', balance: 200_000 }
            }),
            spouse: person({
                age: 65, retirementAge: 60, lifeExpectancy: 66,
                cppStartAge: 99, oasStartAge: 99,
                rrsp: { type: 'RRSP', balance: 400_000 },
                pension: { annualAmount: 40_000, startAge: 65, indexedToInflation: true }
            }),
            postRetirementSpend: 40_000
        }));
        const last = res[res.length - 1];
        expect(last.personDeathThisYear).toBe(true);
        expect(last.spouseDeathThisYear).toBe(true);
        // Both estates are taxed by deemed disposition (no rollover), and the spouse's
        // pension credit is preserved — so the household bill is below the
        // credit-stripped equivalent by the pension credit's value.
        expect(last.totalTerminalTax!).toBeGreaterThan(0);
        expect(last.netEstateValue).toBeCloseTo(last.grossEstateValue! - last.totalTerminalTax!, 0);
    });
});

describe('realized capital gains reporting', () => {
    it('living non-reg sales surface totalRealizedCapGains; no gain year means no living cap-gains tax', () => {
        // Single person, retirement funded entirely from a non-reg account whose
        // balance ($1M) far exceeds its ACB ($100k) — every sale realizes gains.
        const res = runSimulation(inputs({
            person: person({
                lifeExpectancy: 72,
                nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 100_000 })]
            }),
            postRetirementSpend: 80_000
        }));
        // At least one year realizes living gains from the forced sales
        expect(res.some(r => r.totalRealizedCapGains > 0)).toBe(true);
        // capGainsTaxPaid is living-only: a year with no realized gains owes no living cap-gains tax
        for (const r of res) {
            if (r.totalRealizedCapGains === 0) {
                expect(r.capGainsTaxPaid).toBe(0);
            }
        }
    });

    it('single person: full unrealized gain is deemed realized at death (gross)', () => {
        // No spending, no growth, no turnover → balance and ACB are untouched until
        // death, so the deemed gain equals the initial balance minus ACB exactly.
        const res = runSimulation(inputs({
            person: person({
                lifeExpectancy: 66,
                nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 0 })]
            }),
            postRetirementSpend: 0
        }));
        const last = res[res.length - 1];
        expect(last.terminalRealizedGains).toBeCloseTo(1_000_000, 0);
        expect(last.totalTerminalTax!).toBeGreaterThan(0);
        // No living sales or turnover → living realized gains are zero throughout
        expect(res.every(r => r.totalRealizedCapGains === 0)).toBe(true);
    });

    it('spousal rollover: no deemed gains at the first death, gains surface at the second', () => {
        const res = runSimulation(inputs({
            person: person({
                lifeExpectancy: 66,
                nonRegisteredAccounts: [nonReg({ balance: 500_000, adjustedCostBase: 100_000 })]
            }),
            spouse: person({
                lifeExpectancy: 80,
                nonRegisteredAccounts: [nonReg({ balance: 500_000, adjustedCostBase: 100_000 })]
            }),
            postRetirementSpend: 0
        }));
        const firstDeath = res.find(r => r.personDeathThisYear)!;
        // First death rolls the non-reg over (ACB transfers), so nothing is deemed realized
        expect(firstDeath.terminalRealizedGains).toBe(0);
        // The survivor's death deems the combined non-reg disposed
        const last = res[res.length - 1];
        expect(last.spouseDeathThisYear).toBe(true);
        expect(last.terminalRealizedGains).toBeGreaterThan(0);
    });

    it('both new fields are non-negative numbers on every row', () => {
        const res = runSimulation(inputs({
            person: person({
                lifeExpectancy: 72,
                nonRegisteredAccounts: [nonReg({ balance: 1_000_000, adjustedCostBase: 100_000 })]
            }),
            postRetirementSpend: 80_000
        }));
        for (const r of res) {
            expect(typeof r.totalRealizedCapGains).toBe('number');
            expect(r.totalRealizedCapGains).toBeGreaterThanOrEqual(0);
            expect(typeof r.terminalRealizedGains).toBe('number');
            expect(r.terminalRealizedGains).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('DB pension income', () => {
    it('pays from its start age, nothing before', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 65, retirementAge: 65, lifeExpectancy: 75,
                pension: { annualAmount: 40_000, startAge: 67, indexedToInflation: true }
            }),
            postRetirementSpend: 0
        }));
        expect(res.find(r => r.age === 65)!.pensionIncome).toBe(0);
        expect(res.find(r => r.age === 66)!.pensionIncome).toBe(0);
        expect(res.find(r => r.age === 67)!.pensionIncome).toBeCloseTo(40_000, 0);
        expect(res.find(r => r.age === 68)!.pensionIncome).toBeCloseTo(40_000, 0);
    });

    it('indexed pension grows with inflation; non-indexed stays flat nominal', () => {
        const mk = (indexed: boolean) => runSimulation(inputs({
            person: person({
                age: 65, retirementAge: 65, lifeExpectancy: 75,
                pension: { annualAmount: 40_000, startAge: 65, indexedToInflation: indexed }
            }),
            inflationRate: 0.02,
            postRetirementSpend: 0
        }));
        const idx = mk(true);
        const flat = mk(false);
        // startAge == person.age → factorAtStart = 1, so both pay 40k in year 0
        expect(idx.find(r => r.age === 65)!.pensionIncome).toBeCloseTo(40_000, 0);
        expect(flat.find(r => r.age === 65)!.pensionIncome).toBeCloseTo(40_000, 0);
        // Five years on: indexed rises with the inflation factor, non-indexed is unchanged
        expect(idx.find(r => r.age === 70)!.pensionIncome).toBeCloseTo(40_000 * Math.pow(1.02, 5), 0);
        expect(flat.find(r => r.age === 70)!.pensionIncome).toBeCloseTo(40_000, 0);
    });

    it('bridge benefit stops at bridgeEndAge', () => {
        const res = runSimulation(inputs({
            person: person({
                age: 60, retirementAge: 60, lifeExpectancy: 75, cppStartAge: 99, oasStartAge: 99,
                pension: { annualAmount: 30_000, startAge: 60, indexedToInflation: true, bridgeAmount: 12_000, bridgeEndAge: 65 }
            }),
            postRetirementSpend: 0
        }));
        // Bridge pays 60–64; drops off at 65
        expect(res.find(r => r.age === 64)!.pensionIncome).toBeCloseTo(42_000, 0);
        expect(res.find(r => r.age === 65)!.pensionIncome).toBeCloseTo(30_000, 0);
    });

    it('pension income reduces the RRSP withdrawals needed to fund spending', () => {
        const run = (withPension: boolean) => runSimulation(inputs({
            person: person({
                age: 65, retirementAge: 65, lifeExpectancy: 75,
                rrsp: { type: 'RRSP', balance: 1_000_000 },
                ...(withPension ? { pension: { annualAmount: 40_000, startAge: 65, indexedToInflation: true } } : {})
            }),
            postRetirementSpend: 60_000
        }));
        const withP = run(true);
        const without = run(false);
        expect(withP[0].pensionIncome).toBeCloseTo(40_000, 0);
        expect(withP[0].totalRRSPWithdrawal).toBeLessThan(without[0].totalRRSPWithdrawal);
    });

    it('a person with no pension has zero pension income and produces no NaN', () => {
        const res = runSimulation(inputs({ person: person({ rrsp: { type: 'RRSP', balance: 500_000 } }) }));
        for (const r of res) {
            expect(r.pensionIncome).toBe(0);
            expect(r.netPensionIncome).toBe(0);
            expect(r.personNetPension).toBe(0);
            expect(Number.isNaN(r.netIncome)).toBe(false);
            expect(Number.isNaN(r.taxPaid)).toBe(false);
        }
    });
});

describe('lognormalReturn', () => {
    // Standard normal density, for numerically integrating E[1 + rate].
    const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

    // Trapezoid rule over z ∈ [-8, 8]; the tails beyond 8 sigma are negligible.
    const expectedGross = (meanRate: number, sigma: number): number => {
        const step = 0.001;
        let sum = 0;
        for (let z = -8; z <= 8; z += step) {
            const w = (z === -8) ? 0.5 : 1;
            sum += w * (1 + lognormalReturn(meanRate, sigma, z)) * phi(z);
        }
        return sum * step;
    };

    it('z = 0 gives the median, which sits below the mean (volatility drag)', () => {
        const r = 0.06, sigma = 0.15;
        const median = lognormalReturn(r, sigma, 0);
        expect(median).toBeCloseTo((1 + r) * Math.exp(-(sigma * sigma) / 2) - 1, 12);
        expect(median).toBeLessThan(r);
    });

    it('is bounded below by −100% even for extreme downside draws', () => {
        expect(lognormalReturn(0.05, 0.5, -10)).toBeGreaterThan(-1);
        expect(lognormalReturn(0.05, 0.5, -10)).toBeLessThan(0);
        expect(lognormalReturn(0.07, 0.2, -40)).toBeGreaterThan(-1);
    });

    // Zero volatility leaves the rate untouched apart from the float round-trip
    // through log/exp (~1e-16), so this compares to full double precision.
    it('sigma = 0 returns the mean rate for any z', () => {
        for (const z of [-3, -0.5, 0, 0.5, 3]) {
            expect(lognormalReturn(0.06, 0, z)).toBeCloseTo(0.06, 15);
        }
    });

    it('preserves the arithmetic mean of the entered rate', () => {
        for (const [r, sigma] of [[0.05, 0.1], [0.07, 0.15], [0.02, 0.25], [-0.03, 0.2]]) {
            expect(expectedGross(r, sigma)).toBeCloseTo(1 + r, 6);
        }
    });

    it('returns the rate unshocked instead of NaN when 1 + meanRate <= 0', () => {
        expect(lognormalReturn(-1, 0.1, 1)).toBe(-1);
        expect(lognormalReturn(-1.5, 0.1, -1)).toBe(-1.5);
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
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0, capitalGrowth: 0.05, volatility: 0 }
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
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0, capitalGrowth: 0.05, volatility: 0.1 }
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

// Step 5.5 re-prices the household bill AFTER Step 3 sized withdrawals against the
// pre-split bill, so the saving is cash that arrives late — like the RRSP-deduction
// refund, it has to land in an account or it evaporates from the projection.
describe('the pension-splitting saving is real cash and gets banked', () => {
    // Zero returns and no inflation: nothing but a surplus sweep can move an ACB,
    // and the surplus sweep splits evenly between the two spouses' accounts — so
    // the DIFFERENCE between the two ACB moves isolates the splitting saving.
    const splittingCouple = (
        personOver: Partial<Person> = {},
        spouseOver: Partial<Person> = {}
    ): SimulationInputs => inputs({
        useIncomeSplitting: true,
        postRetirementSpend: 40_000,
        person: person({
            age: 65, lifeExpectancy: 70,
            pension: { annualAmount: 90_000, startAge: 65, indexedToInflation: false },
            nonRegisteredAccounts: [nonReg({ balance: 10_000, adjustedCostBase: 10_000, receivesSurplus: true })],
            ...personOver
        }),
        spouse: person({
            age: 65, lifeExpectancy: 70,
            nonRegisteredAccounts: [nonReg({ id: 'nr-s', balance: 10_000, adjustedCostBase: 10_000, receivesSurplus: true })],
            ...spouseOver
        })
    });

    const firstSplitYear = (res: SimulationResult[]) =>
        res.findIndex((r, i) => i > 0 && (r.taxSavingsFromSplit ?? 0) > 100);

    it('lands in the transferor\'s non-registered account, at cost', () => {
        const res = runSimulation(splittingCouple());
        const i = firstSplitYear(res);
        expect(i, 'expected a year with a material splitting saving').toBeGreaterThan(0);
        const saving = res[i].taxSavingsFromSplit!;

        // Only the pension-holder (the transferor) should get the saving on top of
        // their half of the ordinary surplus sweep.
        const dACB = res[i].accounts.nonRegisteredACB - res[i - 1].accounts.nonRegisteredACB;
        const dSpouseACB = res[i].spouseAccounts!.spouseNonRegisteredACB
            - res[i - 1].spouseAccounts!.spouseNonRegisteredACB;
        expect(dACB - dSpouseACB).toBeCloseTo(saving, 2);

        // Contributed at cost, so balance and ACB move together, and it is reported
        // as surplus reinvestment rather than vanishing.
        const dBal = res[i].accounts.nonRegistered - res[i - 1].accounts.nonRegistered;
        expect(dBal).toBeCloseTo(dACB, 2);
        expect(res[i].reinvestedNonReg).toBeGreaterThanOrEqual(saving);
        expect(res[i].unallocatedSplitSaving ?? 0).toBe(0);
    });

    it('falls back to the other spouse when the transferor holds no non-registered account', () => {
        const res = runSimulation(splittingCouple({ nonRegisteredAccounts: [] }));
        const i = firstSplitYear(res);
        expect(i).toBeGreaterThan(0);
        expect(res[i].unallocatedSplitSaving ?? 0).toBe(0);
        expect(res[i].reinvestedNonReg).toBeGreaterThanOrEqual(res[i].taxSavingsFromSplit!);
    });

    it('is reported as unallocated when neither spouse holds a non-registered account', () => {
        // No account to invent one into — the engine must say so rather than let the
        // cash disappear silently (the year audit shows it as its own line).
        const res = runSimulation(splittingCouple({ nonRegisteredAccounts: [] }, { nonRegisteredAccounts: [] }));
        const i = firstSplitYear(res);
        expect(i).toBeGreaterThan(0);
        expect(res[i].unallocatedSplitSaving).toBeCloseTo(res[i].taxSavingsFromSplit!, 6);
    });
});
