import { describe, it, expect } from 'vitest';
import { runSimulation } from '../engine/projection';
import { calculatePayrollContributions } from '../engine/tax';
import type { Person, NonRegisteredAccount, SimulationInputs, SimulationResult } from '../engine/types';
import { INITIAL_INPUTS } from './inputSanitizer';
import { buildYearAudit } from './yearAudit';
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
 * The pension-splitting saving is a third source, but it is exactly
 * `taxSavingsFromSplit` (asserted below) so the audit shows it as its own line
 * rather than burying it in the residual.
 *
 * Bounds are set just above each scenario's observed worst year: they are a
 * regression fence on engine drift, not a licence for it to grow.
 */
const CASH_FLOW_TOLERANCE: Array<[string, SimulationInputs, number]> = [
    // Worst year is age 64 (~$274) — a DB pension plus dividends the solver's tax
    // estimate does not credit, not an age-amount error.
    ['INITIAL_INPUTS', INITIAL_INPUTS, 300],
    // No credit-argument gap in these fixtures, so only the binary-search tolerance
    // survives.
    ['single', SINGLE, 1],
    ['couple', COUPLE, 1],
    ['widowed', WIDOWED, 2],
    // Every year is fully unfunded or TFSA-only — no gross-up, no drift.
    ['shortfall', SHORTFALL, 1],
    ['one-time events', ONE_TIME, 1],
    ['surplus', SURPLUS, 1]
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
        it(`${name}: every section reconciles`, () => {
            const results = runSimulation(ins);
            expect(results.length).toBeGreaterThan(0);

            for (let i = 0; i < results.length; i++) {
                const audit = buildYearAudit(ins, results, i);
                const where = `${name} year index ${i} (age ${results[i].age})`;

                for (const section of audit.sections) {
                    if (!section.check) continue;
                    const tolerance = section.key === 'cashFlow' ? cashTolerance : 1;
                    expect(
                        Math.abs(section.check.residual),
                        `${where} — section ${section.key} residual ${section.check.residual}`
                    ).toBeLessThan(tolerance);
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
                    expect(Math.abs(section.check!.residual), `${name} i=${i} ${key}`).toBeLessThan(1e-6);
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
                // netIncome already nets the splitting saving out of the tax bill, so
                // add the audit's explicit unallocated-saving line back to compare.
                const splitSaving = r.taxSavingsFromSplit ?? 0;
                expect(available + splitSaving, `${name} i=${i}`).toBeCloseTo(r.netIncome, 2);
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
            const pEmp = r.age <= COUPLE.person.lifeExpectancy && r.age < COUPLE.person.retirementAge
                ? COUPLE.person.currentIncome : 0;
            const sEmp = r.spouseAge! <= COUPLE.spouse!.lifeExpectancy && r.spouseAge! < COUPLE.spouse!.retirementAge
                ? COUPLE.spouse!.currentIncome : 0;
            // The reconstruction is only valid because it reproduces the engine's own
            // employment rule; assert that first.
            expect(pEmp + sEmp, `employment i=${i}`).toBeCloseTo(r.employmentIncome, 6);
            const expected = calculatePayrollContributions(pEmp, COUPLE.province, r.inflationFactor).total
                + calculatePayrollContributions(sEmp, COUPLE.province, r.inflationFactor).total;
            expect(line ? -line.amount : 0, `payroll i=${i}`).toBeCloseTo(expected, 6);
        }
    });

    it('the pension-splitting saving accounts for the whole surplus-year gap', () => {
        const results = runSimulation(COUPLE);
        let splitYears = 0;
        for (const r of results) {
            const saving = r.taxSavingsFromSplit ?? 0;
            if (saving <= 1) continue;
            splitYears++;
            // netIncome exceeds funded spending by exactly the splitting saving: Step
            // 5.5 lowers the tax bill after Step 3/4 already allocated the cash, and
            // nothing sweeps the difference into an account.
            expect(r.netIncome - (r.spending - r.shortfall)).toBeCloseTo(saving, 2);
        }
        expect(splitYears).toBeGreaterThan(0);
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

    it('the audit reports the engine figures directly and its check closes', () => {
        const results = runSimulation(SINGLE);
        const i = results.length - 1;
        const r = results[i];
        expect(r.totalTerminalTax!).toBeGreaterThan(0);

        const estate = sectionOf(buildYearAudit(SINGLE, results, i), 'estate')!;
        expect(estate.lines.find(l => l.label === 'Assets before terminal tax')!.amount)
            .toBeCloseTo(r.grossEstateValue!, 6);
        expect(estate.lines.find(l => l.kind === 'result')!.amount).toBeCloseTo(r.netEstateValue!, 6);
        expect(Math.abs(estate.check!.residual)).toBeLessThan(1e-6);
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
});

describe('gross income section (section 1)', () => {
    it('every line is the engine\'s gross figure, and they sum to "Total cash in"', () => {
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
                expectLine('Employment income (gross)', r.employmentIncome);
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
                expect(total.label).toBe('Total cash in');
                expect(total.amount, `${name} i=${i} total`).toBeCloseTo(addends, 6);
                expect(section.check, `${name} i=${i} check`).toBeUndefined();
            }
        }
    });

    it('shows no nets and no per-person split columns', () => {
        // Section 1 is a pure gross cash-in statement now: the pro-rata per-source
        // nets (and the You/Spouse columns that displayed them) are gone.
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                for (const line of sectionOf(buildYearAudit(ins, results, i), 'incomeSources')!.lines) {
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
                const carried = amountOf('Total cash in');
                expect(Math.abs(carried - cashIn), `${name} i=${i} carry-over`).toBeLessThan(0.01);

                const tax = -amountOf('Less: income tax');
                const payroll = -amountOf('Less: CPP/EI contributions');
                expect(Math.abs(tax - r.taxPaid), `${name} i=${i} tax`).toBeLessThan(0.01);

                const net = cash.lines.find(l => l.kind === 'subtotal')!;
                expect(net.label).toBe('Net income');
                expect(net.amount, `${name} i=${i} net`).toBeCloseTo(carried - tax - payroll, 6);
            }
        }
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
                SURPLUS.person.currentIncome, SURPLUS.province, results[i].inflationFactor
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
                expect(section.check!.expected, `${name} i=${i} expected`).toBeCloseTo(results[i].taxPaid, 6);
                expect(Math.abs(partition - section.check!.expected), `${name} i=${i}`).toBeLessThan(0.1);
                expect(Math.abs(section.check!.residual), `${name} i=${i} residual`).toBeLessThan(0.1);
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
        expect(section.check!.expected).toBeCloseTo(results[i].taxPaid, 6);
        expect(Math.abs(section.check!.residual)).toBeLessThan(0.1);
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

    it('the marginal "of which" lines sit with the investment slices, above the result', () => {
        // They qualify the investment/gains slices, so they read best next to them —
        // but they must still land before the result row that closes the partition.
        const MARGINAL = [
            (l: string) => l === 'Of which capital gains (marginal)',
            (l: string) => l.includes('Of which dividends (marginal)'),
            (l: string) => l === 'Of which interest & foreign dividends (marginal)'
        ];
        for (const [name, ins] of SCENARIOS) {
            const results = runSimulation(ins);
            for (let i = 0; i < results.length; i++) {
                const lines = sectionOf(buildYearAudit(ins, results, i), 'taxes')!.lines;
                const resultIdx = lines.findIndex(l => l.kind === 'result');
                // Both anchors are suppressed in a $0 year — nothing to order against.
                const gainsIdx = lines.findIndex(l => l.label === 'Tax on non-registered sale gains');
                const anchorIdx = gainsIdx >= 0
                    ? gainsIdx
                    : lines.findIndex(l => l.label === 'Tax on investment income');
                if (anchorIdx < 0) continue;
                for (const matches of MARGINAL) {
                    const idx = lines.findIndex(l => matches(l.label));
                    if (idx < 0) continue;
                    expect(idx, `${name} i=${i} ${lines[idx].label} after anchor`).toBeGreaterThan(anchorIdx);
                    expect(idx, `${name} i=${i} ${lines[idx].label} before result`).toBeLessThan(resultIdx);
                }
            }
        }
    });

    it('a negative dividend tax is labelled as a credit, not a bug', () => {
        // A $35k DB pension plus $12k of eligible dividends keeps taxable income in
        // the lowest combined bracket (~20%), below the ~25% gross-up-plus-credit
        // break-even — so the credit shelters income the dividends did not generate.
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
        const line = sectionOf(buildYearAudit(ins, results, i), 'taxes')!.lines
            .find(l => l.label.includes('dividends'))!;
        expect(line.amount).toBeLessThan(0);
        expect(line.note).toContain('Negative by design');
        expect(line.kind).toBe('info');
        // And it must not break the section's partition identity.
        expect(Math.abs(sectionOf(buildYearAudit(ins, results, i), 'taxes')!.check!.residual)).toBeLessThan(0.1);
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
