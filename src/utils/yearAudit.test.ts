import { describe, it, expect } from 'vitest';
import { runSimulation } from '../engine/projection';
import { calculatePayrollContributions } from '../engine/tax';
import type { Person, NonRegisteredAccount, SimulationInputs, SimulationResult } from '../engine/types';
import { INITIAL_INPUTS, createDefaultPerson } from './inputSanitizer';
import { buildYearAudit, NOTE_AMOUNT_TOKEN } from './yearAudit';
import type { AuditSectionKey, YearAudit } from './yearAudit';

// Same fixture style as projection.test.ts: a blank-slate retired 65-year-old with
// no CPP/OAS and empty accounts, built up per scenario.
const nonReg = (over: Partial<NonRegisteredAccount> = {}): NonRegisteredAccount => ({
    type: 'NonRegistered', id: 'nr', name: 'Non-Registered',
    balance: 0, adjustedCostBase: 0,
    assetMix: { bonds: 0, cash: 0, dividend: 0, capitalGain: 1 },
    ...over
});

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

// --- Scenarios ---------------------------------------------------------------

const SINGLE = inputs({
    person: person({
        rrsp: { type: 'RRSP', balance: 300_000 },
        tfsa: { type: 'TFSA', balance: 200_000 },
        nonRegisteredAccounts: [nonReg({ balance: 400_000, adjustedCostBase: 100_000, receivesSurplus: true })]
    })
});

const COUPLE = inputs({
    inflationRate: 0.02,
    useIncomeSplitting: true,
    person: person({
        age: 60, retirementAge: 65, lifeExpectancy: 88, currentIncome: 90_000,
        cppStartAge: 65, cppContributedYears: 38, oasStartAge: 65,
        rrsp: { type: 'RRSP', balance: 600_000 },
        tfsa: { type: 'TFSA', balance: 150_000 },
        nonRegisteredAccounts: [nonReg({
            balance: 300_000, adjustedCostBase: 150_000, receivesSurplus: true, equityTurnoverRate: 0.05,
            assetMix: { bonds: 0.2, cash: 0.1, dividend: 0.2, capitalGain: 0.5 }
        })]
    }),
    spouse: person({
        age: 58, retirementAge: 63, lifeExpectancy: 92, currentIncome: 60_000,
        cppStartAge: 65, cppContributedYears: 30, oasStartAge: 65,
        rrsp: { type: 'RRSP', balance: 350_000 },
        tfsa: { type: 'TFSA', balance: 90_000 },
        nonRegisteredAccounts: [nonReg({
            balance: 120_000, adjustedCostBase: 80_000, receivesSurplus: true,
            assetMix: { bonds: 0.2, cash: 0.1, dividend: 0.2, capitalGain: 0.5 }
        })]
    }),
    preRetirementSpend: 70_000, postRetirementSpend: 65_000,
    returnRates: { bondReturn: 0.035, cashInterest: 0.02, dividend: 0.03, capitalGrowth: 0.05 }
});

// Spouse dies at 78 (rollover to the survivor), primary lives to 90 (terminal tax)
const WIDOWED = inputs({
    person: person({
        age: 70, lifeExpectancy: 90,
        rrsp: { type: 'RRSP', balance: 400_000 },
        nonRegisteredAccounts: [nonReg({ balance: 200_000, adjustedCostBase: 100_000, receivesSurplus: true })]
    }),
    spouse: person({
        age: 70, lifeExpectancy: 78,
        rrsp: { type: 'RRSP', balance: 300_000 },
        tfsa: { type: 'TFSA', balance: 80_000 },
        nonRegisteredAccounts: [nonReg({ balance: 150_000, adjustedCostBase: 50_000, receivesSurplus: true })]
    }),
    postRetirementSpend: 60_000,
    returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0, capitalGrowth: 0.04 }
});

const SHORTFALL = inputs({
    person: person({ rrsp: { type: 'RRSP', balance: 50_000 }, tfsa: { type: 'TFSA', balance: 10_000 } }),
    postRetirementSpend: 70_000
});

const ONE_TIME = inputs({
    person: person({
        rrsp: { type: 'RRSP', balance: 800_000 },
        tfsa: { type: 'TFSA', balance: 100_000 },
        nonRegisteredAccounts: [nonReg({ balance: 200_000, adjustedCostBase: 120_000, receivesSurplus: true })]
    }),
    oneTimeExpenses: [
        { id: 'a', name: 'Roof', amount: 50_000, age: 66, type: 'expense' },
        { id: 'b', name: 'Inheritance', amount: 120_000, age: 67, type: 'inflow' }
    ]
});

// Working years with income well above spending: reinvestment lines active, no
// withdrawals to gross up
const SURPLUS = inputs({
    person: person({
        age: 50, retirementAge: 65, lifeExpectancy: 70, currentIncome: 150_000,
        rrsp: { type: 'RRSP', balance: 200_000 },
        tfsa: { type: 'TFSA', balance: 50_000 },
        nonRegisteredAccounts: [nonReg({ balance: 100_000, adjustedCostBase: 100_000, receivesSurplus: true })]
    }),
    inflationRate: 0.02,
    preRetirementSpend: 50_000, postRetirementSpend: 50_000,
    returnRates: { bondReturn: 0.03, cashInterest: 0.02, dividend: 0.03, capitalGrowth: 0.05 }
});

/**
 * Per-scenario cash-flow tolerance.
 *
 * Every section except `cashFlow` reconciles exactly (< $1). `cashFlow` carries an
 * ENGINE-INHERENT residual: Step 3 sizes each gross-up from a marginal-tax estimate
 * that is not the tax the year is finally assessed at, so the cash the household
 * ends up with misses the spending target slightly. Two causes, both in
 * projection.ts and neither fixable from this file:
 *
 *  1. `solveGrossWithdrawal` and `sellNonReg` call `calculateTotalTax` without the
 *     pension/dividend/payroll credit arguments `getFinalStats` uses, so the solver
 *     prices the draw at a marginal rate the year is never assessed at. (The solver
 *     used to compound this by passing the person's SIMULATION-START age, which made
 *     INITIAL_INPUTS drift by ~$1k a year from 65 on; it now uses the current-year
 *     age, which is what dropped that scenario's worst year to ~$275.)
 *  2. The binary searches stop at a $1 tolerance, up to four calls per year.
 *
 * The pension-splitting saving is NOT a third source. Step 5.5 re-prices the bill
 * after Step 3 sized withdrawals, but it then sweeps the saving into the
 * transferor's non-registered account, so it leaves through `reinvestedNonReg`
 * (the audit's "Surplus reinvested") like any other unspent cash. It can only
 * escape into the residual when neither spouse holds a non-registered account to
 * receive it, and the engine reports that remnant as `unallocatedSplitSaving` so
 * the audit still names it.
 *
 * Bounds are set just above each scenario's observed worst year: they are a
 * regression fence on engine drift, not a licence for it to grow.
 */
const CASH_FLOW_TOLERANCE: Array<[string, SimulationInputs, number]> = [
    // Worst year is age 64 ($274.16) — a DB pension plus dividends the solver's tax
    // estimate does not credit, not an age-amount error. Moving the default melt
    // start from 55 to 60 shifted this by pennies ($274.28 -> $274.16, same year):
    // the melt is not what the solver mis-prices.
    ['INITIAL_INPUTS', INITIAL_INPUTS, 275],
    // No credit-argument gap in these fixtures, so only the binary-search tolerance
    // survives. Measured worsts: 0.9704 / 1.7083 / 1.6253.
    ['single', SINGLE, 1],
    // Indexing employment income (it is a today's-dollars input) grew the couple's
    // balances through the working years, so the early-retirement non-registered
    // sales are larger: the worst year moved from age 69 ($0.8235) to age 66
    // ($1.7083, a $40k sale). `withdrawNonReg` makes two passes over two spouses'
    // accounts, so up to four $1-tolerance binary searches land in one year — still
    // purely search noise, with no RRSP draw and no credit gap in that year.
    ['couple', COUPLE, 1.8],
    ['widowed', WIDOWED, 1.7],
    // Every year is fully unfunded or TFSA-only — no gross-up, no drift.
    ['shortfall', SHORTFALL, 0.01],
    // Measured worsts: 0.6104 / 0.5448.
    ['one-time events', ONE_TIME, 0.7],
    ['surplus', SURPLUS, 0.6]
];

const SCENARIOS = CASH_FLOW_TOLERANCE;

// --- Helpers -----------------------------------------------------------------

const sectionOf = (audit: YearAudit, key: AuditSectionKey) => audit.sections.find(s => s.key === key);

const oneTimeInflow = (ins: SimulationInputs, age: number) =>
    (ins.oneTimeExpenses ?? []).filter(e => e.age === age && e.type === 'inflow')
        .reduce((sum, e) => sum + e.amount, 0);

// --- Tests -------------------------------------------------------------------

describe('buildYearAudit — reconciliation across every year of every scenario', () => {
    for (const [name, ins, cashTolerance] of SCENARIOS) {
        it(`${name}: cashFlow reconciles — the only section whose identity can genuinely miss`, () => {
            const results = runSimulation(ins);
            expect(results.length).toBeGreaterThan(0);

            for (let i = 0; i < results.length; i++) {
                const audit = buildYearAudit(ins, results, i);
                const where = `${name} year index ${i} (age ${results[i].age})`;
                const cashFlow = sectionOf(audit, 'cashFlow')!;

                expect(
                    Math.abs(cashFlow.check!.residual),
                    `${where} — section cashFlow residual ${cashFlow.check!.residual}`
                ).toBeLessThan(cashTolerance);

                // Every other section holds by construction and no longer carries a
                // check — see yearAudit.ts for why each identity is tautological.
                for (const key of ['incomeSources', 'taxes', 'accountsRRSP', 'accountsTFSA', 'accountsNonReg'] as const) {
                    const section = sectionOf(audit, key);
                    if (section) expect(section.check, `${where} — section ${key}`).toBeUndefined();
                }
            }
        });

        it(`${name}: account waterfalls sum to the closing balance exactly`, () => {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const audit = buildYearAudit(ins, results, i);
                for (const key of ['accountsRRSP', 'accountsTFSA', 'accountsNonReg'] as const) {
                    const section = sectionOf(audit, key)!;
                    // Growth is defined as the residual, so this is 0 by construction —
                    // the assertion guards the line-kind bookkeeping (an `info` line
                    // wrongly counted, a missing terminal-tax line) rather than the engine.
                    const sum = section.lines
                        .filter(l => l.kind === undefined || l.kind === 'normal')
                        .reduce((s, l) => s + l.amount, 0);
                    const closing = section.lines.find(l => l.kind === 'result')!.amount;
                    expect(Math.abs(sum - closing), `${name} i=${i} ${key}`).toBeLessThan(1e-6);
                }
            }
        });
    }
});

describe('cash-flow identity: what the residual is made of', () => {
    it('the gross-cash lines reproduce the engine\'s own netIncome to the cent', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const audit = buildYearAudit(ins, results, i);
                const cash = sectionOf(audit, 'cashFlow')!;
                const available = cash.lines.find(l => l.kind === 'result')!.amount;
                // The swept splitting saving is inside reinvestedNonReg on both sides,
                // so it cancels. Only a saving the engine could not sweep (no
                // non-registered account anywhere) shows as an extra audit line.
                const unswept = r.unallocatedSplitSaving ?? 0;
                expect(available + unswept, `${name} i=${i}`).toBeCloseTo(r.netIncome, 2);
            }
        }
    });

    it('the derived CPP/EI line matches recomputing payroll from the inputs', () => {
        const results = runSimulation(COUPLE);
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const audit = buildYearAudit(COUPLE, results, i);
            const line = sectionOf(audit, 'cashFlow')!.lines
                .find(l => l.label === 'Less: CPP/EI contributions');
            // `currentIncome` is a today's-dollars input the engine indexes into the
            // year it is earned, so the reconstruction has to index it too.
            const pEmp = r.age <= COUPLE.person.lifeExpectancy && r.age < COUPLE.person.retirementAge
                ? COUPLE.person.currentIncome * r.inflationFactor : 0;
            const sEmp = r.spouseAge! <= COUPLE.spouse!.lifeExpectancy && r.spouseAge! < COUPLE.spouse!.retirementAge
                ? COUPLE.spouse!.currentIncome * r.inflationFactor : 0;
            // The reconstruction is only valid because it reproduces the engine's own
            // employment rule; assert that first.
            expect(pEmp + sEmp, `employment i=${i}`).toBeCloseTo(r.employmentIncome, 6);
            const expected = calculatePayrollContributions(pEmp, COUPLE.province, r.inflationFactor).total
                + calculatePayrollContributions(sEmp, COUPLE.province, r.inflationFactor).total;
            expect(line ? -line.amount : 0, `payroll i=${i}`).toBeCloseTo(expected, 6);
        }
    });

    it('the pension-splitting saving is swept into an account, not left in the gap', () => {
        const results = runSimulation(COUPLE);
        let splitYears = 0;
        for (const r of results) {
            const saving = r.taxSavingsFromSplit ?? 0;
            if (saving <= 1) continue;
            splitYears++;
            // Step 5.5 lowers the tax bill after Step 3/4 already sized withdrawals,
            // so the saving is cash the household holds. It is swept into the
            // transferor's non-registered account, which is why it lands in
            // reinvestedNonReg instead of inflating netIncome past funded spending.
            expect(r.unallocatedSplitSaving ?? 0).toBe(0);
            expect(r.reinvestedNonReg).toBeGreaterThanOrEqual(saving - 0.01);
            // Only the solver's own gross-up drift is left (see CASH_FLOW_TOLERANCE).
            expect(Math.abs(r.netIncome - (r.spending - r.shortfall))).toBeLessThan(1);
        }
        expect(splitYears).toBeGreaterThan(0);
    });

    it('names the splitting saving only when there is no account to sweep it into', () => {
        // Normal case: it is inside "Surplus reinvested", so no line of its own.
        const couple = runSimulation(COUPLE);
        const ci = couple.findIndex(r => (r.taxSavingsFromSplit ?? 0) > 100);
        expect(ci, 'expected a split year in COUPLE').toBeGreaterThanOrEqual(0);
        expect(sectionOf(buildYearAudit(COUPLE, couple, ci), 'cashFlow')!.lines
            .some(l => l.label.includes('left unallocated'))).toBe(false);

        // Degenerate case: neither spouse holds a non-registered account, so the
        // refund has nowhere to go and the section must say so rather than pass real
        // cash off as solver drift.
        // Spending outruns income every year, so there is no ordinary surplus to
        // muddy the residual — the only unallocated cash is the splitting saving.
        const noNonReg = inputs({
            useIncomeSplitting: true, postRetirementSpend: 120_000,
            person: person({
                lifeExpectancy: 70, nonRegisteredAccounts: [],
                rrsp: { type: 'RRSP', balance: 600_000 },
                pension: { annualAmount: 90_000, startAge: 65, indexedToInflation: false }
            }),
            spouse: person({
                lifeExpectancy: 70, nonRegisteredAccounts: [],
                rrsp: { type: 'RRSP', balance: 100_000 }
            })
        });
        const results = runSimulation(noNonReg);
        const i = results.findIndex(r => (r.unallocatedSplitSaving ?? 0) > 100);
        expect(i, 'expected an unswept saving').toBeGreaterThanOrEqual(0);
        const section = sectionOf(buildYearAudit(noNonReg, results, i), 'cashFlow')!;
        const line = section.lines.find(l => l.label.includes('left unallocated'))!;
        expect(line.amount).toBeCloseTo(-results[i].unallocatedSplitSaving!, 6);
        // ...and naming it is what keeps the reconciliation honest: what is left is
        // the solver's own gross-up drift (this fixture pairs a DB pension with RRSP
        // draws, like INITIAL_INPUTS), orders of magnitude below the saving itself.
        expect(Math.abs(section.check!.residual)).toBeLessThan(100);
        expect(Math.abs(section.check!.residual)).toBeLessThan(results[i].unallocatedSplitSaving! / 10);
    });

    it('years with no grossed-up withdrawal reconcile exactly', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                // No RRSP draw and no non-reg sale means no solver estimate to be wrong.
                if (r.totalRRSPWithdrawal > 1 || r.totalNonRegWithdrawal > 1) continue;
                const check = sectionOf(buildYearAudit(ins, results, i), 'cashFlow')!.check!;
                expect(Math.abs(check.residual), `${name} i=${i}`).toBeLessThan(0.01);
            }
        }
    });

    it('one-time inflows are household cash in the gross income section', () => {
        const results = runSimulation(ONE_TIME);
        const i = results.findIndex(r => r.age === 67);
        expect(i).toBeGreaterThanOrEqual(0);
        const line = sectionOf(buildYearAudit(ONE_TIME, results, i), 'incomeSources')!.lines
            .find(l => l.label === 'One-time inflows');
        expect(line?.amount).toBeCloseTo(120_000, 6);
        expect(oneTimeInflow(ONE_TIME, 67)).toBe(120_000);
        // The matching expense year raises the target instead of the cash-in side.
        const expenseYear = results.findIndex(r => r.age === 66);
        const cash = sectionOf(buildYearAudit(ONE_TIME, results, expenseYear), 'cashFlow')!;
        const target = cash.lines.find(l => l.label.startsWith('Target spending'))!;
        expect(target.amount).toBeCloseTo(results[expenseYear].spending, 6);
        expect(target.amount).toBeGreaterThan(results[expenseYear - 1].spending + 49_000);
    });
});

describe('opening balances', () => {
    it('year 0 opens on the inputs, not on a prior row', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            const audit = buildYearAudit(ins, results, 0);
            const people = [ins.person, ...(ins.spouse ? [ins.spouse] : [])];
            const expected: Record<string, number> = {
                accountsRRSP: people.reduce((s, p) => s + p.rrsp.balance, 0),
                accountsTFSA: people.reduce((s, p) => s + p.tfsa.balance, 0),
                accountsNonReg: people.reduce((s, p) =>
                    s + p.nonRegisteredAccounts.reduce((t, a) => t + a.balance, 0), 0)
            };
            for (const key of Object.keys(expected) as AuditSectionKey[]) {
                const opening = sectionOf(audit, key)!.lines.find(l => l.label === 'Opening balance')!;
                expect(opening.amount, `${name} ${key}`).toBeCloseTo(expected[key], 6);
            }
        }
    });

    it('later years open on the prior row\'s household balances', () => {
        const results = runSimulation(COUPLE);
        for (let i = 1; i < results.length; i++) {
            const prev = results[i - 1];
            const audit = buildYearAudit(COUPLE, results, i);
            const opening = (key: AuditSectionKey) =>
                sectionOf(audit, key)!.lines.find(l => l.label === 'Opening balance')!.amount;
            expect(opening('accountsRRSP')).toBeCloseTo(prev.accounts.rrsp + (prev.spouseAccounts?.rrsp ?? 0), 6);
            expect(opening('accountsTFSA')).toBeCloseTo(prev.accounts.tfsa + (prev.spouseAccounts?.tfsa ?? 0), 6);
            expect(opening('accountsNonReg')).toBeCloseTo(
                prev.accounts.nonRegistered + (prev.spouseAccounts?.nonRegistered ?? 0), 6);
        }
    });

    it('non-registered ACB is reported opening and closing', () => {
        const results = runSimulation(SINGLE);
        const audit = buildYearAudit(SINGLE, results, 1);
        const lines = sectionOf(audit, 'accountsNonReg')!.lines;
        expect(lines.find(l => l.label === 'Adjusted cost base — opening')!.amount)
            .toBeCloseTo(results[0].accounts.nonRegisteredACB, 6);
        expect(lines.find(l => l.label === 'Adjusted cost base — closing')!.amount)
            .toBeCloseTo(results[1].accounts.nonRegisteredACB, 6);
    });
});

describe('badges', () => {
    it('first-year and final-year mark the ends of the projection', () => {
        const results = runSimulation(SINGLE);
        expect(buildYearAudit(SINGLE, results, 0).badges).toContain('first-year');
        expect(buildYearAudit(SINGLE, results, 1).badges).not.toContain('first-year');
        expect(buildYearAudit(SINGLE, results, results.length - 1).badges).toContain('final-year');
    });

    it('death-year appears exactly on the engine\'s death years', () => {
        const results = runSimulation(WIDOWED);
        const flagged = results.map((_, i) => buildYearAudit(WIDOWED, results, i).badges.includes('death-year'));
        expect(flagged).toEqual(results.map(r => r.isDeathYear === true));
        // Both a rollover death and a terminal death in this scenario
        expect(results.filter(r => r.isDeathYear).length).toBe(2);
    });

    it('shortfall appears only when spending goes unfunded', () => {
        const results = runSimulation(SHORTFALL);
        expect(results.some(r => r.shortfall > 1)).toBe(true);
        results.forEach((r, i) => {
            expect(buildYearAudit(SHORTFALL, results, i).badges.includes('shortfall')).toBe(r.shortfall > 1);
        });
    });

    it('one-time-event matches the primary person\'s age, expense or inflow', () => {
        const results = runSimulation(ONE_TIME);
        const flaggedAges = results
            .map((r, i) => ({ age: r.age, on: buildYearAudit(ONE_TIME, results, i).badges.includes('one-time-event') }))
            .filter(x => x.on).map(x => x.age);
        expect(flaggedAges).toEqual([66, 67]);
    });

    it('a scenario with no events, no shortfall and no early death carries only the end badges', () => {
        const results = runSimulation(SURPLUS);
        for (let i = 1; i < results.length - 1; i++) {
            expect(buildYearAudit(SURPLUS, results, i).badges).toEqual([]);
        }
    });
});

describe('estate section', () => {
    it('is present only in death years', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            results.forEach((r, i) => {
                const has = sectionOf(buildYearAudit(ins, results, i), 'estate') !== undefined;
                expect(has, `${name} i=${i}`).toBe(r.isDeathYear === true);
            });
        }
    });

    it('rollover year: RRSP moves to the survivor with no terminal tax', () => {
        const results = runSimulation(WIDOWED);
        const i = results.findIndex(r => r.spouseDeathThisYear);
        const r = results[i];
        expect(r.rrspRolledToSpouse).toBeGreaterThan(0);
        expect(r.totalTerminalTax).toBeCloseTo(0, 6);
        const estate = sectionOf(buildYearAudit(WIDOWED, results, i), 'estate')!;
        expect(estate.note).toContain('Spouse');
        expect(estate.lines.find(l => l.label.startsWith('RRSP/RRIF rolled over'))!.amount)
            .toBeCloseTo(r.rrspRolledToSpouse!, 6);
        // Household waterfalls must not show the rollover as a leak — the survivor
        // absorbs the balances, so the household growth stays plausible.
        const rrsp = sectionOf(buildYearAudit(WIDOWED, results, i), 'accountsRRSP')!;
        const growth = rrsp.lines.find(l => l.label.startsWith('Investment growth'))!;
        expect(growth.note).toBeUndefined();
    });

    it('terminal death year: terminal tax explains the account drop, not growth', () => {
        const results = runSimulation(WIDOWED);
        const i = results.length - 1;
        const r = results[i];
        expect(r.personDeathThisYear).toBe(true);
        expect(r.totalTerminalTax!).toBeGreaterThan(0);
        const audit = buildYearAudit(WIDOWED, results, i);

        const rrsp = sectionOf(audit, 'accountsRRSP')!;
        expect(rrsp.lines.find(l => l.label.startsWith('Terminal tax'))!.amount)
            .toBeCloseTo(-r.terminalTaxOnRRSP!, 6);
        const nonReg = sectionOf(audit, 'accountsNonReg')!;
        expect(nonReg.lines.find(l => l.label.startsWith('Terminal tax'))!.amount)
            .toBeCloseTo(-r.terminalTaxOnCapGains!, 6);

        // Without the terminal-tax lines the derived growth would be a ~40% loss;
        // with them it lands on the scenario's 4% capital growth.
        const growth = rrsp.lines.find(l => l.label.startsWith('Investment growth'))!.amount;
        const opening = rrsp.lines.find(l => l.label === 'Opening balance')!.amount;
        const base = opening - r.totalRRSPWithdrawal;
        expect(growth / base).toBeCloseTo(0.04, 3);
    });

    it('TFSA never carries terminal tax', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            results.forEach((_, i) => {
                const tfsa = sectionOf(buildYearAudit(ins, results, i), 'accountsTFSA')!;
                expect(tfsa.lines.some(l => l.label.startsWith('Terminal tax')), `${name} i=${i}`).toBe(false);
            });
        }
    });

    /**
     * The terminal-tax branches deduct the tax from the deceased's RRSP and non-reg
     * balances, so the balances the row reports (and `totalAssets` with them) are
     * already POST-tax. The estate fields must therefore report the net off those
     * balances and reconstruct the gross by adding the tax back — deducting it once,
     * not twice.
     */
    it('the estate fields deduct the terminal tax exactly once', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (const r of results) {
                if (!r.isDeathYear) continue;
                const tax = r.totalTerminalTax ?? 0;
                // Net is what the (already tax-reduced) balances hold...
                expect(r.netEstateValue!, `${name} age ${r.age} net`).toBeCloseTo(r.totalAssets, 6);
                // ...and gross is that plus the tax, so the identity closes exactly.
                expect(r.grossEstateValue!, `${name} age ${r.age} gross`).toBeCloseTo(r.totalAssets + tax, 6);
                expect(r.grossEstateValue! - tax, `${name} age ${r.age} identity`)
                    .toBeCloseTo(r.netEstateValue!, 6);
            }
        }
    });

    it('the audit reports the engine figures directly', () => {
        const results = runSimulation(SINGLE);
        const i = results.length - 1;
        const r = results[i];
        expect(r.totalTerminalTax!).toBeGreaterThan(0);

        const estate = sectionOf(buildYearAudit(SINGLE, results, i), 'estate')!;
        const assets = estate.lines.find(l => l.label === 'Assets before terminal tax')!;
        expect(assets.amount).toBeCloseTo(r.grossEstateValue!, 6);
        // Reference, not info: it is the section's headline figure, so it must
        // render legibly rather than muted — but still stay out of the arithmetic
        // (see the 'reference' kind coverage below).
        expect(assets.kind).toBe('reference');
        expect(estate.lines.find(l => l.kind === 'result')!.amount).toBeCloseTo(r.netEstateValue!, 6);
        expect(estate.check).toBeUndefined();
        // gross − tax = net is tautological by construction of the engine's
        // fields; the identity itself is covered across scenarios by "the estate
        // fields deduct the terminal tax exactly once" below.
        expect(r.grossEstateValue! - r.totalTerminalTax!).toBeCloseTo(r.netEstateValue!, 6);
    });

    it('the net estate never goes negative while the balances cannot', () => {
        // 800k RRSP drawn down to a mid-size balance, dying at 70 with no survivor:
        // the terminal tax exceeds the post-tax balances, which used to push the
        // reported net estate below zero when the tax was subtracted a second time.
        const results = runSimulation(ONE_TIME);
        const r = results[results.length - 1];
        expect(r.totalTerminalTax!).toBeGreaterThan(r.netEstateValue!);
        expect(r.totalAssets).toBeGreaterThanOrEqual(0);
        expect(r.netEstateValue!).toBeGreaterThanOrEqual(0);
    });

    it('the deemed-gains line appears exactly once, in the Non-registered section, not duplicated in Estate', () => {
        const results = runSimulation(WIDOWED);
        const i = results.length - 1;
        const r = results[i];
        expect(r.terminalRealizedGains).toBeGreaterThan(0);

        const audit = buildYearAudit(WIDOWED, results, i);
        const allMatches = audit.sections.flatMap(s =>
            s.lines.filter(l => l.label === 'Capital gains deemed realized at death'));
        expect(allMatches).toHaveLength(1);
        // The note explaining the figure must survive the move.
        expect(allMatches[0].note).toBe('Full gain; half is taxable');

        const nonReg = sectionOf(audit, 'accountsNonReg')!;
        expect(nonReg.lines.some(l => l.label === 'Capital gains deemed realized at death')).toBe(true);
        const estate = sectionOf(audit, 'estate')!;
        expect(estate.lines.some(l => l.label === 'Capital gains deemed realized at death')).toBe(false);
    });

    it('"Total terminal tax" only appears when both RRSP and capital-gains terminal tax are nonzero', () => {
        // WIDOWED's terminal death year has both components — the subtotal earns
        // its keep there.
        const both = runSimulation(WIDOWED);
        const bothIdx = both.length - 1;
        expect(both[bothIdx].terminalTaxOnRRSP!).toBeGreaterThan(0);
        expect(both[bothIdx].terminalTaxOnCapGains!).toBeGreaterThan(0);
        const bothEstate = sectionOf(buildYearAudit(WIDOWED, both, bothIdx), 'estate')!;
        expect(bothEstate.lines.some(l => l.label === 'Total terminal tax')).toBe(true);

        // A death with RRSP but no unrealized non-reg gain (ACB equals balance) has
        // only one nonzero component — the subtotal must not print the same figure
        // as the single line above it under a second name. Spending is kept small
        // relative to the RRSP balance so there is still RRSP left to tax at death.
        const oneComponent = inputs({
            postRetirementSpend: 20_000,
            person: person({
                rrsp: { type: 'RRSP', balance: 500_000 },
                nonRegisteredAccounts: [nonReg({ balance: 10_000, adjustedCostBase: 10_000 })]
            })
        });
        const results = runSimulation(oneComponent);
        const i = results.length - 1;
        const r = results[i];
        expect(r.totalTerminalTax!).toBeGreaterThan(0);
        expect(r.terminalTaxOnRRSP!).toBeGreaterThan(0);
        expect(r.terminalTaxOnCapGains ?? 0).toBeCloseTo(0, 6);

        const estate = sectionOf(buildYearAudit(oneComponent, results, i), 'estate')!;
        expect(estate.lines.some(l => l.label === 'Terminal tax on RRSP/RRIF')).toBe(true);
        expect(estate.lines.some(l => l.label === 'Terminal tax on capital gains')).toBe(false);
        expect(estate.lines.some(l => l.label === 'Total terminal tax')).toBe(false);
    });

    it('the rollover note names TFSA and non-registered transfers without fabricating an amount', () => {
        const results = runSimulation(WIDOWED);
        const i = results.findIndex(r => r.spouseDeathThisYear);
        const estate = sectionOf(buildYearAudit(WIDOWED, results, i), 'estate')!;
        const line = estate.lines.find(l => l.label.startsWith('RRSP/RRIF rolled over'))!;
        expect(line.note).toMatch(/TFSA/);
        expect(line.note).toMatch(/non-registered/i);
        // Only the RRSP figure is asserted — no invented TFSA/non-reg dollar amount.
        expect(line.amount).toBeCloseTo(results[i].rrspRolledToSpouse!, 6);
    });
});

describe("the 'reference' line kind", () => {
    it('is excluded from section arithmetic exactly like info, but is not the muted info', () => {
        const results = runSimulation(SINGLE);
        const i = results.length - 1;
        const estate = sectionOf(buildYearAudit(SINGLE, results, i), 'estate')!;
        const assets = estate.lines.find(l => l.label === 'Assets before terminal tax')!;
        expect(assets.kind).toBe('reference');
        expect(assets.kind).not.toBe('info');
    });

    it("'Target spending' is a reference line in every scenario/year it appears", () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const cash = sectionOf(buildYearAudit(ins, results, i), 'cashFlow')!;
                const target = cash.lines.find(l => l.label.startsWith('Target spending'));
                if (target) expect(target.kind, `${name} i=${i}`).toBe('reference');
            }
        }
    });

    it('reference lines never contribute to a section\'s addend-only sum', () => {
        // Mirrors sumLines(): every existing addend filter already excludes any
        // kind other than undefined/normal, so this just pins that 'reference'
        // continues to be excluded rather than silently becoming an addend.
        const results = runSimulation(SINGLE);
        const i = results.length - 1;
        const estate = sectionOf(buildYearAudit(SINGLE, results, i), 'estate')!;
        const addendLabels = estate.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .map(l => l.label);
        expect(addendLabels).not.toContain('Assets before terminal tax');

        const cash = sectionOf(buildYearAudit(SINGLE, results, 0), 'cashFlow')!;
        const cashAddendLabels = cash.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .map(l => l.label);
        expect(cashAddendLabels.some(l => l.startsWith('Target spending'))).toBe(false);
    });
});

describe('gross income section (section 1)', () => {
    it('every line is the engine\'s gross figure, and they sum to "Total cash in (pre-tax)"', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const section = sectionOf(buildYearAudit(ins, results, i), 'incomeSources')!;
                // Sub-cent lines are suppressed as noise, so compare at that
                // resolution rather than asserting an exact float match.
                const expectLine = (label: string, engineValue: number) => {
                    const amount = section.lines.find(l => l.label === label)?.amount ?? 0;
                    expect(Math.abs(amount - engineValue), `${name} i=${i} ${label}`).toBeLessThan(0.01);
                };

                // Gross, not net: each line must equal the engine field outright.
                expectLine('Employment income', r.employmentIncome);
                expectLine('CPP (gross)', r.cppIncome);
                expectLine('OAS (gross)', r.oasIncome);
                expectLine('Workplace (DB) pension (gross)', r.pensionIncome);
                expectLine('Investment income received', r.investmentIncome);
                expectLine('RRSP/RRIF withdrawals (gross)', r.totalRRSPWithdrawal);
                expectLine('TFSA withdrawals', r.totalTFSAWithdrawal);
                expectLine('Non-registered sale proceeds (gross)', r.totalNonRegWithdrawal);
                expectLine('One-time inflows', oneTimeInflow(ins, r.age));

                // The result is the sum of the addend lines by construction, which is
                // why the section carries no check of its own.
                const addends = section.lines
                    .filter(l => l.kind === undefined || l.kind === 'normal')
                    .reduce((sum, l) => sum + l.amount, 0);
                const total = section.lines.find(l => l.kind === 'result')!;
                expect(total.label).toBe('Total cash in (pre-tax)');
                expect(total.amount, `${name} i=${i} total`).toBeCloseTo(addends, 6);
                expect(section.check, `${name} i=${i} check`).toBeUndefined();
            }
        }
    });

    it('addend/result lines carry no per-person split — only the informational net-benefit lines may', () => {
        // Section 1's gross cash-in addends are still a pure household total; the
        // per-person split that exists is the net-of-tax `info` line beneath CPP/OAS/
        // pension (see the "per-person net benefit lines" describe block below),
        // which must never be read as a breakdown of the gross addend itself.
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                for (const line of sectionOf(buildYearAudit(ins, results, i), 'incomeSources')!.lines) {
                    if (line.kind === 'info') continue;
                    expect(line.person, `${name} i=${i} ${line.label}`).toBeUndefined();
                    expect(line.spouse, `${name} i=${i} ${line.label}`).toBeUndefined();
                }
            }
        }
    });

    it('the pension split is tax context, not a cash line', () => {
        const results = runSimulation(COUPLE);
        const i = results.findIndex(r => (r.pensionSplitAmount ?? 0) > 1);
        expect(i, 'expected a pension-split year in COUPLE').toBeGreaterThanOrEqual(0);
        const audit = buildYearAudit(COUPLE, results, i);
        const LABEL = 'Pension income split to spouse';

        expect(sectionOf(audit, 'incomeSources')!.lines.some(l => l.label === LABEL)).toBe(false);
        const line = sectionOf(audit, 'taxes')!.lines.find(l => l.label === LABEL)!;
        expect(line.kind).toBe('info');
        expect(line.amount).toBeCloseTo(results[i].pensionSplitAmount!, 6);
    });
});

describe('net income section (section 3)', () => {
    it('net income is total cash in less income tax and CPP/EI, in every year', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const audit = buildYearAudit(ins, results, i);
                const income = sectionOf(audit, 'incomeSources')!;
                const cash = sectionOf(audit, 'cashFlow')!;
                const amountOf = (label: string) => cash.lines.find(l => l.label === label)?.amount ?? 0;

                // The carry-over must be section 1's own result, not a re-derivation
                // (sub-cent totals are suppressed, hence the cent-level compare).
                const cashIn = income.lines.find(l => l.kind === 'result')!.amount;
                const carried = amountOf('Total cash in (pre-tax)');
                expect(Math.abs(carried - cashIn), `${name} i=${i} carry-over`).toBeLessThan(0.01);

                const tax = -amountOf('Less: income tax');
                const payroll = -amountOf('Less: CPP/EI contributions');
                expect(Math.abs(tax - r.taxPaid), `${name} i=${i} tax`).toBeLessThan(0.01);

                // The subtotal only renders when it has something to subtract — a year
                // with neither an income-tax nor a CPP/EI line would otherwise print
                // "Net income" as a bare repeat of "Total cash in (pre-tax)" above it.
                const net = cash.lines.find(l => l.kind === 'subtotal');
                const hadDeduction = cash.lines.some(l =>
                    l.label === 'Less: income tax' || l.label === 'Less: CPP/EI contributions');
                if (hadDeduction) {
                    expect(net, `${name} i=${i} net present`).toBeDefined();
                    expect(net!.label).toBe('Net income');
                    expect(net!.amount, `${name} i=${i} net`).toBeCloseTo(carried - tax - payroll, 6);
                } else {
                    expect(net, `${name} i=${i} net absent`).toBeUndefined();
                }
            }
        }
    });

    it('a TFSA-only retirement year has no income tax or payroll and omits the "Net income" subtotal', () => {
        // No RRSP, no employment, and CPP/OAS start ages set past the person's
        // life expectancy so they never trigger — the only cash in is tax-free
        // TFSA withdrawals, so taxPaid and payroll are both exactly zero.
        const TFSA_ONLY = inputs({
            person: person({
                age: 65, retirementAge: 60, lifeExpectancy: 75,
                cppStartAge: 80, oasStartAge: 80,
                rrsp: { type: 'RRSP', balance: 0 },
                tfsa: { type: 'TFSA', balance: 500_000 },
                nonRegisteredAccounts: []
            }),
            postRetirementSpend: 40_000
        });
        const results = runSimulation(TFSA_ONLY);
        expect(results.length).toBeGreaterThan(0);
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            expect(r.taxPaid, `i=${i}`).toBeCloseTo(0, 2);
            const cash = sectionOf(buildYearAudit(TFSA_ONLY, results, i), 'cashFlow')!;
            expect(cash.lines.some(l => l.label === 'Less: income tax'), `i=${i}`).toBe(false);
            expect(cash.lines.some(l => l.label === 'Less: CPP/EI contributions'), `i=${i}`).toBe(false);
            expect(cash.lines.some(l => l.kind === 'subtotal'), `i=${i}`).toBe(false);
        }
    });

    it('a year that actually carries an income-tax deduction still shows "Net income"', () => {
        const results = runSimulation(INITIAL_INPUTS);
        const i = results.findIndex(r => r.taxPaid > 1);
        expect(i, 'expected a taxed year in INITIAL_INPUTS').toBeGreaterThanOrEqual(0);
        const cash = sectionOf(buildYearAudit(INITIAL_INPUTS, results, i), 'cashFlow')!;
        expect(cash.lines.some(l => l.kind === 'subtotal' && l.label === 'Net income')).toBe(true);
    });

    it('payroll is deducted here and nowhere else', () => {
        // It left Taxes deliberately (reading a CPP/EI line as income tax was the
        // original confusion) and must not creep back in.
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const audit = buildYearAudit(ins, results, i);
                for (const key of ['incomeSources', 'taxes'] as const) {
                    expect(
                        sectionOf(audit, key)!.lines.some(l => l.label.includes('CPP/EI')),
                        `${name} i=${i} ${key}`
                    ).toBe(false);
                }
            }
        }
    });

    it('a working year actually carries the CPP/EI deduction', () => {
        const results = runSimulation(SURPLUS);
        const i = results.findIndex(r => r.employmentIncome > 1);
        expect(i).toBeGreaterThanOrEqual(0);
        const cash = sectionOf(buildYearAudit(SURPLUS, results, i), 'cashFlow')!;
        const payrollLine = cash.lines.find(l => l.label === 'Less: CPP/EI contributions')!;
        expect(payrollLine.amount).toBeLessThan(0);
        expect(-payrollLine.amount).toBeCloseTo(
            calculatePayrollContributions(
                SURPLUS.person.currentIncome * results[i].inflationFactor,
                SURPLUS.province, results[i].inflationFactor
            ).total, 6);
    });
});

describe('income and tax sections', () => {
    /**
     * The headline identity of the Taxes section: the lines above the result are a
     * TRUE partition of `taxPaid`, not an overlapping attribution.
     *
     * Exact by construction rather than approximate. Each line is the pro-rata slice
     * (slice / taxable income) x tax that the engine already uses for the per-source
     * nets, and the slices exhaust taxable income: the six income sources, the
     * taxable half of gains realized while living, less the enhanced-CPP/QPP and
     * RRSP-contribution deductions that shrink the base — then the pension-splitting
     * saving, which re-prices the whole bill after those slices are struck. The gains
     * slice and the two deduction slices have no net-cash figure to be read off, so
     * the engine reports them (taxShareOnCapGains / taxReliefFrom*).
     *
     * The only slack is cosmetic: the section suppresses any slice under a cent, and
     * there are at most ten of them, so the residual cannot reach $0.10.
     */
    it('the taxes lines partition the household bill in every year of every scenario', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const section = sectionOf(buildYearAudit(ins, results, i), 'taxes')!;
                // Mirrors sumLines(): info / result / subtotal lines are not addends.
                const partition = section.lines
                    .filter(l => l.kind === undefined || l.kind === 'normal')
                    .reduce((sum, l) => sum + l.amount, 0);
                expect(section.check, `${name} i=${i} check`).toBeUndefined();
                expect(Math.abs(partition - results[i].taxPaid), `${name} i=${i}`).toBeLessThan(0.1);
            }
        }
    });

    it('the You + Spouse shares still equal the household bill, including split years', () => {
        // No longer the section's check (the partition is), so it is asserted here.
        const results = runSimulation(COUPLE);
        expect(results.some(r => (r.pensionSplitAmount ?? 0) > 1)).toBe(true);
        results.forEach((r, i) => {
            expect(r.personTaxPaid + r.spouseTaxPaid, `i=${i}`).toBeCloseTo(r.taxPaid, 6);
            const result = sectionOf(buildYearAudit(COUPLE, results, i), 'taxes')!.lines
                .find(l => l.kind === 'result')!;
            expect(result.person! + result.spouse!, `i=${i} result line`).toBeCloseTo(r.taxPaid, 6);
        });
    });

    it('the pension-splitting saving is an addend, not a footnote', () => {
        // It re-prices the bill AFTER the per-source slices are struck, so without it
        // the slices would overshoot taxPaid by exactly the saving.
        const results = runSimulation(COUPLE);
        const i = results.findIndex(r => (r.taxSavingsFromSplit ?? 0) > 100);
        expect(i, 'expected a year with a material splitting saving').toBeGreaterThanOrEqual(0);
        const line = sectionOf(buildYearAudit(COUPLE, results, i), 'taxes')!.lines
            .find(l => l.label === 'Less: pension income splitting')!;
        expect(line.kind).toBeUndefined();
        expect(line.amount).toBeCloseTo(-(results[i].taxSavingsFromSplit ?? 0), 6);
    });

    it('terminal tax at death stays out of the partition', () => {
        // Terminal tax is assessed on the deemed disposition and reported in Estate;
        // taxPaid — and so the partition — covers the living year only.
        const results = runSimulation(SINGLE);
        const i = results.length - 1;
        expect(results[i].totalTerminalTax!).toBeGreaterThan(1);
        const section = sectionOf(buildYearAudit(SINGLE, results, i), 'taxes')!;
        const partition = section.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .reduce((sum, l) => sum + l.amount, 0);
        expect(Math.abs(partition - results[i].taxPaid)).toBeLessThan(0.1);
        expect(section.lines.some(l => l.label.toLowerCase().includes('terminal'))).toBe(false);
    });

    it('TFSA withdrawals carry no slice of the bill', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (const r of results) {
                expect(r.netTFSAWithdrawal, `${name} age ${r.age}`).toBeCloseTo(r.totalTFSAWithdrawal, 6);
            }
        }
    });

    it('the Taxes section carries no explanatory note — the layout says it instead', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                expect(sectionOf(buildYearAudit(ins, results, i), 'taxes')!.note, `${name} i=${i}`)
                    .toBeUndefined();
            }
        }
    });

    it('the marginal "of which" attributions are absent — the marginal view lives in the table tooltip', () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const lines = sectionOf(buildYearAudit(ins, results, i), 'taxes')!.lines;
                expect(lines.some(l => l.label.includes('(marginal)')), `${name} i=${i}`).toBe(false);
            }
        }
    });

    it('the partition still balances when the dividend credit turns the marginal dividend tax negative', () => {
        // A $35k DB pension plus $12k of eligible dividends keeps taxable income in
        // the lowest combined bracket (~20%), below the ~25% gross-up-plus-credit
        // break-even — the nastiest credit interaction the partition has to absorb.
        const ins = inputs({
            person: person({
                pension: { annualAmount: 35_000, startAge: 60, indexedToInflation: false },
                nonRegisteredAccounts: [nonReg({
                    balance: 400_000, adjustedCostBase: 400_000, receivesSurplus: true,
                    assetMix: { bonds: 0, cash: 0, dividend: 1, capitalGain: 0 }
                })]
            }),
            postRetirementSpend: 40_000,
            returnRates: { bondReturn: 0, cashInterest: 0, dividend: 0.03, capitalGrowth: 0 }
        });
        const results = runSimulation(ins);
        const i = results.findIndex(r => r.dividendTaxPaid < -1);
        expect(i, 'expected a year where the dividend credit goes negative').toBeGreaterThanOrEqual(0);
        const section = sectionOf(buildYearAudit(ins, results, i), 'taxes')!;
        const partition = section.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .reduce((sum, l) => sum + l.amount, 0);
        expect(Math.abs(partition - results[i].taxPaid)).toBeLessThan(0.1);
    });

    it("the effective-rate note names its denominator via NOTE_AMOUNT_TOKEN, and that denominator is grossIncome", () => {
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            const i = results.findIndex(r => r.taxPaid > 1 && r.grossIncome > 0);
            if (i < 0) continue; // not every scenario has a taxed year
            const result = sectionOf(buildYearAudit(ins, results, i), 'taxes')!.lines
                .find(l => l.kind === 'result')!;
            expect(result.note, `${name} i=${i}`).toContain(NOTE_AMOUNT_TOKEN);
            expect(result.note, `${name} i=${i}`).toMatch(/Total cash in \(pre-tax\)/);
            expect(result.noteAmount, `${name} i=${i}`).toBeCloseTo(results[i].grossIncome, 6);
        }
    });

    it('the OAS clawback is explained once — on the info line, not on the partition line too', () => {
        // ~$150k+ of RRSP income puts the person deep into clawback territory (same
        // shape as projection.test.ts's own clawback fixture).
        const ins = inputs({
            person: person({ oasStartAge: 65, rrsp: { type: 'RRSP', balance: 3_000_000 } }),
            postRetirementSpend: 250_000
        });
        const results = runSimulation(ins);
        const i = results.findIndex(r => r.oasClawbackPaid > 1);
        expect(i, 'expected a clawback year').toBeGreaterThanOrEqual(0);
        const section = sectionOf(buildYearAudit(ins, results, i), 'taxes')!;

        const oasLine = section.lines.find(l => l.label === 'Tax on OAS');
        expect(oasLine?.note, `i=${i}`).toBeUndefined();

        const clawbackInfo = section.lines.find(l => l.label === 'Includes OAS recovery tax (clawback)')!;
        expect(clawbackInfo.note, `i=${i}`).toBeDefined();
        expect(clawbackInfo.amount).toBeCloseTo(results[i].oasClawbackPaid, 6);
    });
});

describe('one-time expense info lines (cashFlow)', () => {
    it('the Roof expense appears directly under Target spending, as an info line sized to the event', () => {
        const results = runSimulation(ONE_TIME);
        const i = results.findIndex(r => r.age === 66);
        const cash = sectionOf(buildYearAudit(ONE_TIME, results, i), 'cashFlow')!;
        const targetIdx = cash.lines.findIndex(l => l.label.startsWith('Target spending'));
        expect(targetIdx).toBeGreaterThanOrEqual(0);
        const line = cash.lines[targetIdx + 1];
        expect(line.label).toBe('Includes one-time: Roof');
        expect(line.kind).toBe('info');
        expect(line.amount).toBeCloseTo(50_000, 6);
    });

    it('falls back to a generic label when the event name is blank', () => {
        const blankNamed = inputs({
            person: person({ rrsp: { type: 'RRSP', balance: 800_000 } }),
            oneTimeExpenses: [{ id: 'x', name: '', amount: 10_000, age: 66, type: 'expense' }]
        });
        const results = runSimulation(blankNamed);
        const i = results.findIndex(r => r.age === 66);
        const cash = sectionOf(buildYearAudit(blankNamed, results, i), 'cashFlow')!;
        const line = cash.lines.find(l => l.label === 'Includes one-time: One-time expense');
        expect(line).toBeDefined();
        expect(line!.kind).toBe('info');
    });

    it('multiple one-time expenses in the same year each get their own info line', () => {
        const multi = inputs({
            person: person({ rrsp: { type: 'RRSP', balance: 800_000 } }),
            oneTimeExpenses: [
                { id: 'a', name: 'Roof', amount: 30_000, age: 66, type: 'expense' },
                { id: 'b', name: 'Car', amount: 15_000, age: 66, type: 'expense' }
            ]
        });
        const results = runSimulation(multi);
        const i = results.findIndex(r => r.age === 66);
        const cash = sectionOf(buildYearAudit(multi, results, i), 'cashFlow')!;
        const roof = cash.lines.find(l => l.label === 'Includes one-time: Roof')!;
        const car = cash.lines.find(l => l.label === 'Includes one-time: Car')!;
        expect(roof.amount).toBeCloseTo(30_000, 6);
        expect(car.amount).toBeCloseTo(15_000, 6);
        expect(roof.kind).toBe('info');
        expect(car.kind).toBe('info');
    });

    it('does not change the cashFlow reconciliation residual — the amount is already inside r.spending', () => {
        // The one-time-events reconciliation suite (CASH_FLOW_TOLERANCE) already
        // covers every year of ONE_TIME with these info lines present; this test
        // proves directly why they cannot move the residual: sumLines() (which
        // both "Cash available to spend" and the check are built from) ignores
        // `info`-kind lines by construction, so appending them changes nothing.
        const results = runSimulation(ONE_TIME);
        const i = results.findIndex(r => r.age === 66);
        const cash = sectionOf(buildYearAudit(ONE_TIME, results, i), 'cashFlow')!;
        expect(cash.lines.some(l => l.label === 'Includes one-time: Roof')).toBe(true);
        const addendsOnly = cash.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .reduce((s, l) => s + l.amount, 0);
        const available = cash.lines.find(l => l.kind === 'result')!.amount;
        expect(addendsOnly).toBeCloseTo(available, 6);
        // Same tolerance already asserted in CASH_FLOW_TOLERANCE for 'one-time events'.
        expect(Math.abs(cash.check!.residual)).toBeLessThan(0.7);
    });
});

describe('one-time inflow naming (incomeSources)', () => {
    it('the summed addend line is untouched, and a named info line sits alongside it', () => {
        const results = runSimulation(ONE_TIME);
        const i = results.findIndex(r => r.age === 67);
        const income = sectionOf(buildYearAudit(ONE_TIME, results, i), 'incomeSources')!;

        const addend = income.lines.find(l => l.label === 'One-time inflows')!;
        expect(addend.amount).toBeCloseTo(120_000, 6);
        expect(addend.kind).toBeUndefined();

        const named = income.lines.find(l => l.label === 'Includes one-time: Inheritance')!;
        expect(named).toBeDefined();
        expect(named.kind).toBe('info');
        expect(named.amount).toBeCloseTo(120_000, 6);

        // Naming is informational only — the section total is unaffected.
        const addendsOnly = income.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .reduce((s, l) => s + l.amount, 0);
        const total = income.lines.find(l => l.kind === 'result')!;
        expect(total.amount).toBeCloseTo(addendsOnly, 6);
    });
});

describe('per-person net benefit lines in income & withdrawals', () => {
    it('never appear for a single-person plan', () => {
        const results = runSimulation(SINGLE);
        for (let i = 0; i < results.length; i++) {
            const income = sectionOf(buildYearAudit(SINGLE, results, i), 'incomeSources')!;
            expect(income.lines.some(l => l.label.startsWith('Net CPP received')), `i=${i}`).toBe(false);
            expect(income.lines.some(l => l.label.startsWith('Net OAS received')), `i=${i}`).toBe(false);
            expect(income.lines.some(l => l.label.startsWith('Net DB pension received')), `i=${i}`).toBe(false);
        }
    });

    it('appear for a couple, only alongside the gross line they explain, and match the engine\'s own net figures', () => {
        const results = runSimulation(COUPLE);
        const withCpp = results.findIndex(r => r.cppIncome > 1);
        expect(withCpp, 'expected a year with CPP in COUPLE').toBeGreaterThanOrEqual(0);
        const income = sectionOf(buildYearAudit(COUPLE, results, withCpp), 'incomeSources')!;

        const cppLine = income.lines.find(l => l.label === 'Net CPP received — You / Spouse')!;
        expect(cppLine).toBeDefined();
        expect(cppLine.kind).toBe('info');
        // Consistent with what it claims to be: person/spouse are the engine's own
        // net-of-tax figures, and the displayed total is exactly their sum.
        expect(cppLine.person).toBeCloseTo(results[withCpp].personNetCPP, 6);
        expect(cppLine.spouse).toBeCloseTo(results[withCpp].spouseNetCPP, 6);
        expect(cppLine.amount).toBeCloseTo(cppLine.person! + cppLine.spouse!, 6);

        // COUPLE has no DB pension configured, so neither the gross line nor its
        // net-split info line should appear even though a spouse exists.
        expect(income.lines.some(l => l.label === 'Workplace (DB) pension (gross)')).toBe(false);
        expect(income.lines.some(l => l.label.startsWith('Net DB pension received'))).toBe(false);
    });

    it('are excluded from the section total, like every other info line', () => {
        const results = runSimulation(COUPLE);
        const withCpp = results.findIndex(r => r.cppIncome > 1);
        const income = sectionOf(buildYearAudit(COUPLE, results, withCpp), 'incomeSources')!;
        const addendsOnly = income.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .reduce((s, l) => s + l.amount, 0);
        const total = income.lines.find(l => l.kind === 'result')!;
        expect(total.amount).toBeCloseTo(addendsOnly, 6);
    });
});

describe('RRSP/RRIF withdrawal breakdown (incomeSources)', () => {
    // Same fixture as projection.test.ts's forced-overdraw coverage: from age 74
    // a $2M RRSP forces a RRIF minimum far above the $20k spending target, with
    // no melt running (melt stops at 72) and no top-up needed — a lone mandatory
    // component that pushes a large surplus into reinvestment.
    const FORCED = inputs({
        person: person({ age: 74, lifeExpectancy: 78, rrsp: { type: 'RRSP', balance: 2_000_000 } }),
        postRetirementSpend: 20_000
    });

    // The default plan (createDefaultPerson) with a spouse added via
    // createDefaultPerson(true), per the task's suggested fixture: the spouse is
    // 3 years younger, so at the primary's age 72 the spouse (69) is still
    // running their own configured meltdown while the primary's RRIF minimum has
    // just kicked in — two nonzero components, no top-up, in the same year.
    const SPOUSE_PLAN: SimulationInputs = {
        person: createDefaultPerson(),
        spouse: createDefaultPerson(true),
        province: 'ON', inflationRate: 0.025,
        preRetirementSpend: 60_000, postRetirementSpend: 55_000,
        oneTimeExpenses: [], withdrawalStrategy: 'rrsp-first', useIncomeSplitting: true,
        returnRates: {
            bondReturn: 0.035, cashInterest: 0.02, dividend: 0.03, foreignYield: 0.02,
            capitalGrowth: 0.05, rrspGrowth: 0.05, tfsaGrowth: 0.05, volatility: 0.10
        }
    };

    // The plain single default plan (no spouse) genuinely runs short once RRIF
    // minimums start at 72: the minimum alone does not cover the spending
    // target, so Step 3 tops up on top of it. The household needed every dollar
    // here, which is exactly the case the nudge must NOT fire in.
    const SINGLE_PLAN: SimulationInputs = {
        person: createDefaultPerson(),
        spouse: undefined,
        province: 'ON', inflationRate: 0.025,
        preRetirementSpend: 60_000, postRetirementSpend: 55_000,
        oneTimeExpenses: [], withdrawalStrategy: 'rrsp-first', useIncomeSplitting: true,
        returnRates: {
            bondReturn: 0.035, cashInterest: 0.02, dividend: 0.03, foreignYield: 0.02,
            capitalGrowth: 0.05, rrspGrowth: 0.05, tfsaGrowth: 0.05, volatility: 0.10
        }
    };

    it('a lone forced minimum still renders a sub-line, carrying the forced-overdraw nudge', () => {
        const results = runSimulation(FORCED);
        const r = results[0];
        expect(r.age).toBe(74);
        expect(r.rrifMinimumWithdrawal).toBeGreaterThan(0);
        expect(r.voluntaryMeltWithdrawal).toBe(0);
        expect(r.topUpWithdrawal).toBe(0);
        // A large surplus is reinvested — the minimum drew more than was spent.
        expect(r.reinvestedTFSA + r.reinvestedRRSP + r.reinvestedNonReg).toBeGreaterThan(1000);

        const income = sectionOf(buildYearAudit(FORCED, results, 0), 'incomeSources')!;
        const line = income.lines.find(l => l.label === 'Mandatory RRIF minimum')!;
        expect(line).toBeDefined();
        expect(line.kind).toBe('info');
        expect(line.amount).toBeCloseTo(r.rrifMinimumWithdrawal, 6);
        expect(line.note).toMatch(/RRSP meltdown optimizer/);

        // Melt and top-up are exactly zero, so neither sub-line appears.
        expect(income.lines.some(l => l.label === 'Voluntary meltdown')).toBe(false);
        expect(income.lines.some(l => l.label === 'Extra draw to fund spending')).toBe(false);

        // The sub-line is informational only — the section total is unaffected.
        const addendsOnly = income.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .reduce((s, l) => s + l.amount, 0);
        const total = income.lines.find(l => l.kind === 'result')!;
        expect(total.amount).toBeCloseTo(addendsOnly, 6);
    });

    it('a lone voluntary melt with no forced minimum is suppressed as noise (no sub-line at all)', () => {
        const MELT_ONLY = inputs({
            person: person({
                age: 60, retirementAge: 60, lifeExpectancy: 71,
                cppStartAge: 70, oasStartAge: 70,
                rrspMeltStartAge: 60, rrspMeltAmount: 40_000,
                rrsp: { type: 'RRSP', balance: 500_000 },
                nonRegisteredAccounts: [nonReg({ receivesSurplus: true })]
            }),
            postRetirementSpend: 30_000
        });
        const results = runSimulation(MELT_ONLY);
        const r = results[0];
        expect(r.voluntaryMeltWithdrawal).toBeCloseTo(40_000, 6);
        expect(r.rrifMinimumWithdrawal).toBe(0);
        expect(r.topUpWithdrawal).toBe(0);

        const income = sectionOf(buildYearAudit(MELT_ONLY, results, 0), 'incomeSources')!;
        expect(income.lines.some(l => l.label === 'Voluntary meltdown')).toBe(false);
        expect(income.lines.some(l => l.label === 'Mandatory RRIF minimum')).toBe(false);
        expect(income.lines.some(l => l.label === 'Extra draw to fund spending')).toBe(false);
        // The gross line alone still carries the full amount.
        const gross = income.lines.find(l => l.label === 'RRSP/RRIF withdrawals (gross)')!;
        expect(gross.amount).toBeCloseTo(40_000, 6);
    });

    it('a mandatory minimum alongside a still-running spousal melt shows both sub-lines, and they sum to the gross line', () => {
        const results = runSimulation(SPOUSE_PLAN);
        const i = results.findIndex(r => r.age === 72);
        expect(i, 'expected age 72 in SPOUSE_PLAN').toBeGreaterThanOrEqual(0);
        const r = results[i];
        expect(r.rrifMinimumWithdrawal).toBeGreaterThan(0);
        expect(r.voluntaryMeltWithdrawal).toBeGreaterThan(0);
        expect(r.topUpWithdrawal).toBe(0);
        expect(r.rrifMinimumWithdrawal + r.voluntaryMeltWithdrawal + r.topUpWithdrawal)
            .toBeCloseTo(r.totalRRSPWithdrawal, 6);

        const income = sectionOf(buildYearAudit(SPOUSE_PLAN, results, i), 'incomeSources')!;
        const min = income.lines.find(l => l.label === 'Mandatory RRIF minimum')!;
        const melt = income.lines.find(l => l.label === 'Voluntary meltdown')!;
        expect(min).toBeDefined();
        expect(melt).toBeDefined();
        expect(min.kind).toBe('info');
        expect(melt.kind).toBe('info');
        expect(min.amount).toBeCloseTo(r.rrifMinimumWithdrawal, 6);
        expect(melt.amount).toBeCloseTo(r.voluntaryMeltWithdrawal, 6);
        expect(income.lines.some(l => l.label === 'Extra draw to fund spending')).toBe(false);

        const gross = income.lines.find(l => l.label === 'RRSP/RRIF withdrawals (gross)')!;
        expect(min.amount + melt.amount).toBeCloseTo(gross.amount, 6);
        expect(gross.amount).toBeCloseTo(r.totalRRSPWithdrawal, 6);

        const addendsOnly = income.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .reduce((s, l) => s + l.amount, 0);
        const total = income.lines.find(l => l.kind === 'result')!;
        expect(total.amount).toBeCloseTo(addendsOnly, 6);
    });

    it('a top-up year shows the extra-draw sub-line and does NOT fire the nudge, since the household needed the cash', () => {
        const results = runSimulation(SINGLE_PLAN);
        const i = results.findIndex(r => r.age === 72);
        expect(i, 'expected age 72 in SINGLE_PLAN').toBeGreaterThanOrEqual(0);
        const r = results[i];
        expect(r.rrifMinimumWithdrawal).toBeGreaterThan(0);
        expect(r.topUpWithdrawal).toBeGreaterThan(0);
        expect(r.rrifMinimumWithdrawal + r.voluntaryMeltWithdrawal + r.topUpWithdrawal)
            .toBeCloseTo(r.totalRRSPWithdrawal, 6);

        const income = sectionOf(buildYearAudit(SINGLE_PLAN, results, i), 'incomeSources')!;
        const min = income.lines.find(l => l.label === 'Mandatory RRIF minimum')!;
        const topUp = income.lines.find(l => l.label === 'Extra draw to fund spending')!;
        expect(min).toBeDefined();
        expect(topUp).toBeDefined();
        expect(topUp.kind).toBe('info');
        expect(topUp.amount).toBeCloseTo(r.topUpWithdrawal, 6);
        // The household was short, not sitting on an unwanted surplus — the nudge
        // sentence must be absent from the mandatory line's note.
        expect(min.note).not.toMatch(/RRSP meltdown optimizer/);

        const addendsOnly = income.lines
            .filter(l => l.kind === undefined || l.kind === 'normal')
            .reduce((s, l) => s + l.amount, 0);
        const total = income.lines.find(l => l.kind === 'result')!;
        expect(total.amount).toBeCloseTo(addendsOnly, 6);
    });
});

describe('structure', () => {
    it('INITIAL_INPUTS builds an audit for every year with all core sections', () => {
        const results = runSimulation(INITIAL_INPUTS);
        expect(results.length).toBeGreaterThan(1);
        for (let i = 0; i < results.length; i++) {
            const audit = buildYearAudit(INITIAL_INPUTS, results, i);
            expect(audit.year).toBe(results[i].year);
            expect(audit.age).toBe(results[i].age);
            expect(audit.hasSpouse).toBe(false);
            expect(audit.spouseAge).toBeUndefined();
            for (const key of ['incomeSources', 'taxes', 'cashFlow', 'accountsRRSP', 'accountsTFSA', 'accountsNonReg'] as const) {
                expect(sectionOf(audit, key), `${key} missing at i=${i}`).toBeDefined();
            }
            // Every line must be a finite number the drawer can format.
            for (const section of audit.sections) {
                for (const line of section.lines) {
                    expect(Number.isFinite(line.amount), `${section.key}/${line.label}`).toBe(true);
                }
            }
        }
    });

    it('reports spouse ages and per-person splits when a spouse is present', () => {
        const results = runSimulation(COUPLE);
        const audit = buildYearAudit(COUPLE, results, 8);
        expect(audit.hasSpouse).toBe(true);
        expect(audit.spouseAge).toBe(results[8].spouseAge);
        const tax = sectionOf(audit, 'taxes')!.lines.find(l => l.kind === 'result')!;
        expect(tax.person).toBeCloseTo(results[8].personTaxPaid, 6);
        expect(tax.spouse).toBeCloseTo(results[8].spouseTaxPaid, 6);
    });

    it('omits per-person fields for a single-person plan', () => {
        const results = runSimulation(SINGLE);
        const audit = buildYearAudit(SINGLE, results, 0);
        for (const section of audit.sections) {
            for (const line of section.lines) {
                expect(line.person, `${section.key}/${line.label}`).toBeUndefined();
                expect(line.spouse).toBeUndefined();
            }
        }
    });

    it('throws on an out-of-range index rather than returning a broken audit', () => {
        const results: SimulationResult[] = runSimulation(SINGLE);
        expect(() => buildYearAudit(SINGLE, results, results.length)).toThrow(RangeError);
        expect(() => buildYearAudit(SINGLE, [], 0)).toThrow(RangeError);
    });
});
