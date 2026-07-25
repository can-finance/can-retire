import type { Person, SimulationInputs, SimulationResult } from '../engine/types';
import { calculatePayrollContributions } from '../engine/tax';

// Pure, presentation-mechanical audit of a single projection year: the drawer
// renders lines and check-sums verbatim and never does arithmetic of its own.
//
// EVERY amount here is NOMINAL. The real-vs-nominal toggle divides by
// `row.inflationFactor` at render time; reconciliation identities are only
// meaningful in nominal dollars, so nothing in this file touches inflation.

export type AuditLineKind =
    | 'normal'    // participates in the section's arithmetic
    | 'subtotal'  // running total of the lines above it
    | 'result'    // the section's final figure (what the check tests)
    | 'info';     // context only — never part of the section's arithmetic

export interface AuditLine {
    label: string;
    // Signed value in the section's own arithmetic: deductions are negative, so a
    // section's lines add up literally.
    amount: number;
    // Income lines only: `amount` is the net, these are the pre-tax figure and the
    // tax apportioned to it. Employment's taxShare also carries CPP/EI withholding —
    // taxShareLabel overrides the UI's default "Tax" wording where that matters.
    gross?: number;
    taxShare?: number;
    taxShareLabel?: string;
    // Per-person split of `amount`, present only when the plan has a spouse and the
    // engine reports the split.
    person?: number;
    spouse?: number;
    note?: string;
    kind?: AuditLineKind;
}

export interface AuditCheck {
    label: string;
    expected: number;
    actual: number;
    residual: number; // actual - expected
    // Set when the engine makes an exact identity impossible; explains what the
    // residual is made of.
    note?: string;
}

export type AuditSectionKey =
    | 'incomeSources'
    | 'taxes'
    | 'cashFlow'
    | 'accountsRRSP'
    | 'accountsTFSA'
    | 'accountsNonReg'
    | 'estate';

export interface AuditSection {
    key: AuditSectionKey;
    title: string;
    lines: AuditLine[];
    check?: AuditCheck;
    note?: string;
}

export type AuditBadge =
    | 'first-year'
    | 'final-year'
    | 'death-year'
    | 'shortfall'
    | 'one-time-event';

export interface YearAudit {
    year: number;
    age: number;
    spouseAge?: number;
    hasSpouse: boolean;
    badges: AuditBadge[];
    sections: AuditSection[];
}

// Derived investment growth is a residual, so the account waterfalls sum by
// construction. Flag it instead when the implied return is absurd — that is the
// signal that the waterfall model has stopped matching the engine.
const GROWTH_SANITY_RATIO = 0.6;
const GROWTH_SANITY_MIN_BASE = 1000;

// Below this a line is noise, not information.
const EPS = 0.01;

interface Balances {
    rrsp: number;
    tfsa: number;
    nonReg: number;
    acb: number;
}

const personNonReg = (p: Person) => p.nonRegisteredAccounts.reduce((s, a) => s + a.balance, 0);
const personACB = (p: Person) => p.nonRegisteredAccounts.reduce((s, a) => s + a.adjustedCostBase, 0);

// Household end-of-year balances. A dead person's `accounts` are zeroed by the
// engine and `spouseAccounts` disappears entirely, so summing both sides keeps the
// household total continuous across a death/rollover year.
function householdBalances(r: SimulationResult): Balances {
    const s = r.spouseAccounts;
    return {
        rrsp: r.accounts.rrsp + (s?.rrsp ?? 0),
        tfsa: r.accounts.tfsa + (s?.tfsa ?? 0),
        nonReg: r.accounts.nonRegistered + (s?.nonRegistered ?? 0),
        acb: r.accounts.nonRegisteredACB + (s?.spouseNonRegisteredACB ?? 0)
    };
}

// Year 0 has no prior row: opening balances are the inputs themselves.
function inputBalances(inputs: SimulationInputs): Balances {
    const people = [inputs.person, ...(inputs.spouse ? [inputs.spouse] : [])];
    return {
        rrsp: people.reduce((s, p) => s + p.rrsp.balance, 0),
        tfsa: people.reduce((s, p) => s + p.tfsa.balance, 0),
        nonReg: people.reduce((s, p) => s + personNonReg(p), 0),
        acb: people.reduce((s, p) => s + personACB(p), 0)
    };
}

// Mandatory CPP/QPP + EI never reach the household's pocket, and the engine folds
// them into `netEmploymentIncome` without reporting them separately. Rebuild them
// from the inputs the same way the engine does: a person earns their (nominal,
// un-indexed) `currentIncome` while alive and below their retirement age.
function payrollWithheld(inputs: SimulationInputs, r: SimulationResult): { payroll: number; employment: number } {
    const entries: Array<[Person, number | undefined]> = [
        [inputs.person, r.age],
        ...(inputs.spouse ? [[inputs.spouse, r.spouseAge] as [Person, number | undefined]] : [])
    ];
    let payroll = 0;
    let employment = 0;
    for (const [p, age] of entries) {
        if (age === undefined || age > p.lifeExpectancy) continue;
        const emp = age < p.retirementAge ? p.currentIncome : 0;
        if (emp <= 0) continue;
        employment += emp;
        payroll += calculatePayrollContributions(emp, inputs.province, r.inflationFactor).total;
    }
    return { payroll, employment };
}

const sumLines = (lines: AuditLine[]) =>
    lines.reduce((s, l) => s + (l.kind === 'info' || l.kind === 'result' || l.kind === 'subtotal' ? 0 : l.amount), 0);

function incomeSourcesSection(r: SimulationResult, hasSpouse: boolean): AuditSection {
    const lines: AuditLine[] = [];

    const source = (
        label: string,
        gross: number,
        net: number,
        split?: { person: number; spouse: number },
        note?: string,
        taxShareLabel?: string
    ) => {
        if (Math.abs(gross) < EPS && Math.abs(net) < EPS) return;
        lines.push({
            label,
            amount: net,
            gross,
            taxShare: gross - net,
            ...(taxShareLabel ? { taxShareLabel } : {}),
            ...(hasSpouse && split ? { person: split.person, spouse: split.spouse } : {}),
            note
        });
    };

    // Employment's gross−net gap is income tax PLUS CPP/EI contributions, so the
    // generic "Tax" subtext label would misattribute the payroll share.
    source('Employment income', r.employmentIncome, r.netEmploymentIncome, undefined,
        undefined, 'Tax + CPP/EI');
    source('CPP', r.cppIncome, r.netCPPIncome, { person: r.personNetCPP, spouse: r.spouseNetCPP });
    source('OAS', r.oasIncome, r.netOASIncome, { person: r.personNetOAS, spouse: r.spouseNetOAS },
        r.oasClawbackPaid > 1 ? 'Reduced by the OAS recovery tax — see Taxes' : undefined);
    source('Workplace (DB) pension', r.pensionIncome, r.netPensionIncome,
        { person: r.personNetPension, spouse: r.spouseNetPension });
    source('Investment income (interest & dividends)', r.investmentIncome, r.netInvestmentIncome);

    if ((r.pensionSplitAmount ?? 0) > EPS) {
        lines.push({
            label: 'Pension income split to spouse',
            amount: r.pensionSplitAmount!,
            kind: 'info',
            note: 'Moves taxable income between spouses; household cash is unchanged'
        });
    }

    // The per-source nets are a pro-rata display allocation of each person's total
    // tax, so they do not sum to household cash. The one identity that does hold
    // exactly is that the You/Spouse benefit splits add up to the household figures.
    const expected = r.netCPPIncome + r.netOASIncome + r.netPensionIncome;
    const actual = r.personNetCPP + r.spouseNetCPP + r.personNetOAS + r.spouseNetOAS
        + r.personNetPension + r.spouseNetPension;

    return {
        key: 'incomeSources',
        title: 'Income sources',
        lines,
        note: 'Tax is apportioned across sources pro-rata for display. The exact household cash identity is in Cash flow.',
        check: {
            label: 'You + Spouse benefit nets equal the household totals',
            expected,
            actual,
            residual: actual - expected
        }
    };
}

function taxesSection(inputs: SimulationInputs, r: SimulationResult, hasSpouse: boolean): AuditSection {
    const lines: AuditLine[] = [];
    const { payroll } = payrollWithheld(inputs, r);

    // --- The partition -------------------------------------------------------
    // Every line here is the same pro-rata allocation the engine uses for the
    // per-source nets in Income sources: each slice of a person's taxable income
    // carries (slice / taxable income) x that person's tax bill. The slices
    // EXHAUST taxable income — the six income sources, the taxable half of
    // realized gains, and the two deductions that shrink the base — so they add
    // up to the household bill exactly. Terminal tax at death is assessed
    // separately and reported in Estate, so it is deliberately absent.
    //
    // Slices are rendered signed and unclamped: a deduction reduces the bill, and
    // the dividend gross-up can push the investment slice past the cash it paid.
    const part = (label: string, amount: number, note?: string) => {
        if (Math.abs(amount) < EPS) return;
        lines.push({ label, amount, note });
    };

    // Employment's gross-minus-net gap carries CPP/EI withholding too (the engine
    // folds it into netEmploymentIncome), so back the payroll out to leave the
    // income tax alone.
    part('Employment income tax', (r.employmentIncome - r.netEmploymentIncome) - payroll,
        payroll > EPS ? 'Excludes CPP/EI contributions — shown below' : undefined);
    part('Tax on CPP', r.cppIncome - r.netCPPIncome);
    part('Tax on OAS', r.oasIncome - r.netOASIncome,
        r.oasClawbackPaid > EPS
            ? 'The OAS recovery tax is inside the household bill, but the pro-rata split spreads it over every line — not just this one'
            : undefined);
    part('Tax on DB pension', r.pensionIncome - r.netPensionIncome);
    part('Tax on investment income', r.investmentIncome - r.netInvestmentIncome,
        'Interest, dividends and foreign dividends — the slice is struck on the grossed-up dividend');
    part('Tax on RRSP/RRIF withdrawals', r.totalRRSPWithdrawal - r.netRRSPWithdrawal);
    // TFSA withdrawals are tax-free, so they carry no slice at all.
    part('Tax on non-registered sale gains', r.taxShareOnCapGains,
        'The taxable half of gains realized while living, including fund turnover');
    part('Less: enhanced CPP/QPP deduction', -r.taxReliefFromPayrollDeduction,
        'The enhanced CPP/QPP and CPP2 slice of payroll comes off taxable income');
    part('Less: RRSP contribution deduction', -r.taxReliefFromRRSPDeduction,
        "Contributions made out of this year's surplus");
    part('Less: pension income splitting', -(r.taxSavingsFromSplit ?? 0),
        'Splitting re-prices the whole bill after the per-source slices are struck');

    const partition = sumLines(lines);

    const effectiveRate = r.grossIncome > 0 ? (r.taxPaid / r.grossIncome) * 100 : 0;
    lines.push({
        label: 'Household income tax',
        amount: r.taxPaid,
        ...(hasSpouse ? { person: r.personTaxPaid, spouse: r.spouseTaxPaid } : {}),
        kind: 'result',
        note: r.grossIncome > 0
            ? `Effective rate ${effectiveRate.toFixed(1)}% of taxable income`
            : undefined
    });

    // --- Context below the result — none of these are addends ----------------
    // The per-person split is on the result row's You/Spouse columns; repeating it
    // as info keeps it readable in the single-column layout without looking like
    // two more lines to add up.
    if (hasSpouse) {
        lines.push({
            label: 'Your share (after any pension split)',
            amount: r.personTaxPaid,
            kind: 'info'
        });
        lines.push({
            label: "Spouse's share (after any pension split)",
            amount: r.spouseTaxPaid,
            kind: 'info'
        });
    }

    if (r.oasClawbackPaid > EPS) {
        lines.push({
            label: 'Of which OAS recovery tax (clawback)',
            amount: r.oasClawbackPaid,
            kind: 'info',
            note: 'Household total, before any pension split — spread across the lines above, not carried by one'
        });
    }

    // Marginal attribution: the extra tax each source adds on top of all other
    // income. These overlap with the total and with each other — they are not a
    // partition of the tax bill.
    if (Math.abs(r.capGainsTaxPaid) > EPS) {
        lines.push({ label: 'Of which capital gains (marginal)', amount: r.capGainsTaxPaid, kind: 'info' });
    }
    if (Math.abs(r.dividendTaxPaid) > EPS) {
        lines.push({
            label: r.dividendTaxPaid < 0
                ? 'Of which dividends (marginal) — credit sheltering other income'
                : 'Of which dividends (marginal)',
            amount: r.dividendTaxPaid,
            kind: 'info',
            note: r.dividendTaxPaid < 0
                ? 'Negative by design: the dividend tax credit exceeds the tax on the dividends'
                : undefined
        });
    }
    if (Math.abs(r.interestTaxPaid) > EPS) {
        lines.push({ label: 'Of which interest & foreign dividends (marginal)', amount: r.interestTaxPaid, kind: 'info' });
    }

    // Working years only: the CPP/EI withheld from pay (already netted out of the
    // employment line in Income sources). Payroll contributions, not income tax —
    // shown here so the household's full deductions are visible in one place, but
    // deliberately excluded from the partition and the check above.
    if (payroll > EPS) {
        lines.push({
            label: 'CPP/EI contributions (withheld from pay)',
            amount: payroll,
            kind: 'info',
            note: 'Payroll contributions, not income tax — not included in the household income tax above'
        });
    }

    return {
        key: 'taxes',
        title: 'Taxes',
        lines,
        note: 'The tax lines above the total are a pro-rata allocation — the same convention as the per-source nets in Income sources — and between them they partition the bill exactly. The "of which" lines are marginal attributions instead: each is the extra tax that source adds on top of all other income, so they overlap rather than partition.',
        check: {
            label: 'The per-source tax lines add up to the household income tax',
            expected: r.taxPaid,
            actual: partition,
            residual: partition - r.taxPaid
        }
    };
}

function cashFlowSection(inputs: SimulationInputs, r: SimulationResult, oneTimeInflows: number): AuditSection {
    const lines: AuditLine[] = [];
    const { payroll } = payrollWithheld(inputs, r);

    const add = (label: string, amount: number, note?: string, kind: AuditLineKind = 'normal') => {
        if (Math.abs(amount) < EPS) return;
        lines.push({ label, amount, note, kind });
    };

    // Gross cash basis. This mirrors the engine's own `netIncome` construction
    // exactly, which is why it reconciles to the cent — the per-source net figures
    // in Income sources are a pro-rata display split and do not.
    add('Employment income (gross)', r.employmentIncome);
    add('CPP (gross)', r.cppIncome);
    add('OAS (gross)', r.oasIncome);
    add('Workplace (DB) pension (gross)', r.pensionIncome);
    add('Investment income received', r.investmentIncome, 'Interest and dividend cash; growth stays in the account');
    add('One-time inflows', oneTimeInflows, 'Household cash — not attributed to either person');
    add('RRSP/RRIF withdrawals (gross)', r.totalRRSPWithdrawal, 'RRIF minimum + meltdown + top-up draws');
    add('TFSA withdrawals', r.totalTFSAWithdrawal);
    add('Non-registered sale proceeds (gross)', r.totalNonRegWithdrawal, 'Grossed up so the sale funds its own tax');

    const cashIn = sumLines(lines);
    lines.push({ label: 'Total cash in', amount: cashIn, kind: 'subtotal' });

    add('Income tax', -r.taxPaid);
    add('CPP/EI withheld on employment income', -payroll, 'Derived from the inputs — the engine folds this into net employment income');

    // Step 5.5 re-optimises tax after Step 3 has already sized withdrawals on the
    // pre-split tax bill, so the saving is cash the engine neither spends nor
    // reinvests. (Contrast the RRSP-deduction refund, which Step 5 sweeps into a
    // non-registered account.) Naming it keeps the residual honest.
    const splitSavings = r.taxSavingsFromSplit ?? 0;
    add('Pension-splitting saving left unallocated', -splitSavings,
        'The engine lowers the tax bill after withdrawals were sized, and never spends or reinvests the difference');

    const reinvested = r.reinvestedTFSA + r.reinvestedRRSP + r.reinvestedNonReg;
    add('Surplus reinvested', -reinvested, 'Swept to TFSA / RRSP / non-registered rather than spent');

    const available = sumLines(lines);
    lines.push({ label: 'Cash available to spend', amount: available, kind: 'result' });

    lines.push({ label: 'Target spending (incl. one-time expenses)', amount: r.spending, kind: 'info' });
    if (r.shortfall > EPS) {
        lines.push({
            label: 'Unfunded shortfall',
            amount: -r.shortfall,
            kind: 'info',
            note: 'Target spending the household could not fund after draining every account'
        });
    }

    const expected = r.spending - r.shortfall;

    return {
        key: 'cashFlow',
        title: 'Cash flow',
        lines,
        check: {
            label: 'Cash available equals target spending less any shortfall',
            expected,
            actual: available,
            residual: available - expected,
            // The withdrawal solvers size a gross-up from a marginal-tax estimate that
            // is not the tax the year is finally assessed at (different credit
            // arguments and a $1 binary-search tolerance), so a small residual is
            // inherent to the engine rather than to this reconciliation.
            note: 'Any residual is the gap between the tax the withdrawal solver assumed and the tax finally assessed.'
        }
    };
}

interface AccountSpec {
    key: Extract<AuditSectionKey, 'accountsRRSP' | 'accountsTFSA' | 'accountsNonReg'>;
    title: string;
    balance: (b: Balances) => number;
    reinvested: number;
    withdrawn: number;
    terminalTax: number;
    withdrawalLabel: string;
    terminalTaxLabel: string;
}

function accountSection(
    spec: AccountSpec,
    start: Balances,
    end: Balances,
    rolledOver: number,
    extraLines: AuditLine[] = []
): AuditSection {
    const startBal = spec.balance(start);
    const endBal = spec.balance(end);
    const lines: AuditLine[] = [
        { label: 'Opening balance', amount: startBal }
    ];

    if (spec.reinvested > EPS) lines.push({ label: 'Surplus reinvested', amount: spec.reinvested });
    if (spec.withdrawn > EPS) lines.push({ label: spec.withdrawalLabel, amount: -spec.withdrawn });
    if (spec.terminalTax > EPS) {
        lines.push({
            label: spec.terminalTaxLabel,
            amount: -spec.terminalTax,
            note: 'Deducted from the balance in the year of death'
        });
    }

    // Growth is the residual: the engine reports no per-account growth figure, and
    // every other flow is known, so this is exactly what is left over.
    const base = startBal + spec.reinvested;
    const growth = endBal - (startBal + spec.reinvested - spec.withdrawn - spec.terminalTax);
    const implausible = base > GROWTH_SANITY_MIN_BASE && Math.abs(growth) > GROWTH_SANITY_RATIO * base;
    lines.push({
        label: 'Investment growth (derived)',
        amount: growth,
        note: implausible
            ? 'Unusually large for the balance it grew on — the flows above may not fully explain this year'
            : undefined
    });

    const actual = sumLines(lines);
    lines.push({ label: 'Closing balance', amount: endBal, kind: 'result' });
    lines.push(...extraLines);

    return {
        key: spec.key,
        title: spec.title,
        lines,
        note: rolledOver > EPS
            ? 'Household totals combine both spouses, so the rollover from the deceased spouse nets out here.'
            : undefined,
        check: {
            label: 'Opening balance plus flows equals the closing balance',
            expected: endBal,
            actual,
            residual: actual - endBal,
            note: 'Growth is derived as the residual, so this always reconciles — the growth line carries a warning instead when it looks implausible.'
        }
    };
}

function estateSection(r: SimulationResult): AuditSection {
    const terminalRRSP = r.terminalTaxOnRRSP ?? 0;
    const terminalGains = r.terminalTaxOnCapGains ?? 0;
    const totalTerminal = r.totalTerminalTax ?? 0;
    const gross = r.grossEstateValue ?? 0;
    const net = r.netEstateValue ?? 0;

    const who: string[] = [];
    if (r.personDeathThisYear) who.push('You');
    if (r.spouseDeathThisYear) who.push('Spouse');

    const lines: AuditLine[] = [];

    if ((r.rrspRolledToSpouse ?? 0) > EPS) {
        lines.push({
            label: 'RRSP/RRIF rolled over to the surviving spouse',
            amount: r.rrspRolledToSpouse!,
            kind: 'info',
            note: 'Tax-free rollover — no deemed disposition, so no terminal tax on it'
        });
    }
    if (r.terminalRealizedGains > EPS) {
        lines.push({
            label: 'Capital gains deemed realized at death',
            amount: r.terminalRealizedGains,
            kind: 'info',
            note: 'Full gain; half is taxable'
        });
    }

    lines.push({
        label: 'Assets before terminal tax',
        amount: gross,
        kind: 'info'
    });
    if (terminalRRSP > EPS) lines.push({ label: 'Terminal tax on RRSP/RRIF', amount: -terminalRRSP });
    if (terminalGains > EPS) lines.push({ label: 'Terminal tax on capital gains', amount: -terminalGains });
    if (totalTerminal > EPS) lines.push({ label: 'Total terminal tax', amount: -totalTerminal, kind: 'subtotal' });

    lines.push({
        label: 'Net estate to heirs',
        amount: net,
        kind: 'result',
        note: totalTerminal > EPS
            ? 'The terminal tax was already deducted from the account balances shown above'
            : undefined
    });

    return {
        key: 'estate',
        title: 'Estate',
        lines,
        note: who.length > 0 ? `Death year — ${who.join(' and ')}.` : 'Death year.',
        check: {
            label: 'Assets before terminal tax less the tax equals the net estate',
            expected: net,
            actual: gross - totalTerminal,
            residual: (gross - totalTerminal) - net
        }
    };
}

/**
 * Build the full audit for `results[index]`.
 *
 * `inputs` is needed for the opening balances of year 0, for the CPP/EI figure the
 * engine does not report, and to match one-time events by the primary person's age.
 */
export function buildYearAudit(
    inputs: SimulationInputs,
    results: SimulationResult[],
    index: number
): YearAudit {
    const r = results[index];
    if (!r) throw new RangeError(`yearAudit: no projection row at index ${index}`);

    const hasSpouse = inputs.spouse !== undefined;
    const start = index > 0 ? householdBalances(results[index - 1]) : inputBalances(inputs);
    const end = householdBalances(r);

    // The engine matches one-time events on the PRIMARY person's age only.
    const events = (inputs.oneTimeExpenses ?? []).filter(e => e.age === r.age);
    const oneTimeInflows = events.filter(e => e.type === 'inflow').reduce((s, e) => s + e.amount, 0);

    const badges: AuditBadge[] = [];
    if (index === 0) badges.push('first-year');
    if (index === results.length - 1) badges.push('final-year');
    if (r.isDeathYear) badges.push('death-year');
    if (r.shortfall > 1) badges.push('shortfall');
    if (events.length > 0) badges.push('one-time-event');

    const rolledOver = r.rrspRolledToSpouse ?? 0;

    const nonRegExtras: AuditLine[] = [
        { label: 'Adjusted cost base — opening', amount: start.acb, kind: 'info' },
        { label: 'Adjusted cost base — closing', amount: end.acb, kind: 'info' }
    ];
    if (r.totalRealizedCapGains > EPS) {
        nonRegExtras.push({
            label: 'Capital gains realized while living',
            amount: r.totalRealizedCapGains,
            kind: 'info',
            note: 'Sales plus fund turnover; the full gain, of which half is taxable'
        });
    }
    if (r.terminalRealizedGains > EPS) {
        nonRegExtras.push({
            label: 'Capital gains deemed realized at death',
            amount: r.terminalRealizedGains,
            kind: 'info'
        });
    }

    const sections: AuditSection[] = [
        incomeSourcesSection(r, hasSpouse),
        taxesSection(inputs, r, hasSpouse),
        cashFlowSection(inputs, r, oneTimeInflows),
        accountSection({
            key: 'accountsRRSP', title: 'RRSP / RRIF', balance: b => b.rrsp,
            reinvested: r.reinvestedRRSP, withdrawn: r.totalRRSPWithdrawal,
            terminalTax: r.terminalTaxOnRRSP ?? 0,
            withdrawalLabel: 'Withdrawals (gross)',
            terminalTaxLabel: 'Terminal tax on deemed withdrawal at death'
        }, start, end, rolledOver),
        accountSection({
            key: 'accountsTFSA', title: 'TFSA', balance: b => b.tfsa,
            reinvested: r.reinvestedTFSA, withdrawn: r.totalTFSAWithdrawal,
            terminalTax: 0,
            withdrawalLabel: 'Withdrawals (tax-free)',
            terminalTaxLabel: ''
        }, start, end, rolledOver),
        accountSection({
            key: 'accountsNonReg', title: 'Non-registered', balance: b => b.nonReg,
            reinvested: r.reinvestedNonReg, withdrawn: r.totalNonRegWithdrawal,
            terminalTax: r.terminalTaxOnCapGains ?? 0,
            withdrawalLabel: 'Sale proceeds (gross)',
            terminalTaxLabel: 'Terminal tax on deemed disposition at death'
        }, start, end, rolledOver, nonRegExtras)
    ];

    if (r.isDeathYear) sections.push(estateSection(r));

    return {
        year: r.year,
        age: r.age,
        spouseAge: r.spouseAge,
        hasSpouse,
        badges,
        sections
    };
}
