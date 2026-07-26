import type { OneTimeEvent, Person, SimulationInputs, SimulationResult } from '../engine/types';
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
    | 'info'      // context only — never part of the section's arithmetic; rendered muted
    | 'reference';// the section's headline number, shown for context only — excluded from
                  // arithmetic exactly like 'info', but rendered at normal weight/colour
                  // because it IS the figure the reader is meant to notice (e.g. "Assets
                  // before terminal tax", "Target spending")

// Substituted by the drawer with `noteAmount` (scaled the same way as every other
// figure, so it moves correctly with the real/nominal toggle) — lets a note cite a
// specific dollar figure without baking a stale nominal value into the string.
export const NOTE_AMOUNT_TOKEN = '{amount}';

export interface AuditLine {
    label: string;
    // Signed value in the section's own arithmetic: deductions are negative, so a
    // section's lines add up literally.
    amount: number;
    // Per-person split of `amount`, present only when the plan has a spouse and the
    // engine reports the split.
    person?: number;
    spouse?: number;
    note?: string;
    // A nominal dollar figure `note` references via `NOTE_AMOUNT_TOKEN` — e.g. the
    // denominator behind a percentage the note quotes. Kept separate from `note`
    // itself so the drawer can scale it like any other amount.
    noteAmount?: number;
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
    lines.reduce((s, l) => s + (
        l.kind === 'info' || l.kind === 'result' || l.kind === 'subtotal' || l.kind === 'reference' ? 0 : l.amount
    ), 0);

/**
 * Section 1 — every dollar of gross cash the household takes in this year.
 *
 * These are the lines that used to open `cashFlowSection`, unchanged: they mirror
 * the engine's own `netIncome` construction exactly (projection.ts builds
 * `pCashGross + sCashGross + one-time inflows + TFSA/non-reg withdrawals` before
 * subtracting tax, payroll and reinvestment), which is why the whole flow
 * reconciles to the cent. Nothing here is netted down — tax comes off in the two
 * sections below.
 */
function incomeSourcesSection(
    r: SimulationResult,
    oneTimeInflows: number,
    hasSpouse: boolean,
    events: OneTimeEvent[]
): AuditSection {
    const lines: AuditLine[] = [];

    const add = (label: string, amount: number, note?: string) => {
        if (Math.abs(amount) < EPS) return;
        lines.push({ label, amount, note });
    };

    // The engine reports per-person NET benefit figures but this section is
    // gross, so the split can never be attached to the gross line itself (that
    // would misrepresent it as the gross line's own split). Instead it is a
    // separate `info` line, gated on the same gross figure being present, and
    // labelled unambiguously as net so it cannot be mistaken for a breakdown of
    // the gross amount above it.
    const addNetSplit = (label: string, personNet: number, spouseNet: number, gate: number) => {
        if (!hasSpouse || Math.abs(gate) < EPS) return;
        lines.push({
            label,
            amount: personNet + spouseNet,
            person: personNet,
            spouse: spouseNet,
            kind: 'info',
            note: 'Net of tax, per person — not a split of the gross line above. Tax is assessed pro-rata across every income source (see Taxes), not per benefit.'
        });
    };

    add('Employment income', r.employmentIncome);
    add('CPP (gross)', r.cppIncome);
    addNetSplit('Net CPP received — You / Spouse', r.personNetCPP, r.spouseNetCPP, r.cppIncome);
    add('OAS (gross)', r.oasIncome);
    addNetSplit('Net OAS received — You / Spouse', r.personNetOAS, r.spouseNetOAS, r.oasIncome);
    add('Workplace (DB) pension (gross)', r.pensionIncome);
    addNetSplit('Net DB pension received — You / Spouse', r.personNetPension, r.spouseNetPension, r.pensionIncome);
    add('Investment income received', r.investmentIncome,
        'Interest and dividends paid out by non-registered accounts only — RRSP and TFSA earnings stay inside those accounts. Capital growth stays in the account too.');
    add('RRSP/RRIF withdrawals (gross)', r.totalRRSPWithdrawal, 'RRIF minimum + meltdown + top-up draws');
    add('TFSA withdrawals', r.totalTFSAWithdrawal);
    add('Non-registered sale proceeds (gross)', r.totalNonRegWithdrawal, 'Grossed up so the sale funds its own tax');
    add('One-time inflows', oneTimeInflows, 'Household cash — not attributed to either person');

    // Name each inflow event as its own `info` line under the summed addend
    // above — informational only, so multiple events in one year cannot change
    // the section total.
    for (const e of events.filter(ev => ev.type === 'inflow')) {
        if (Math.abs(e.amount) < EPS) continue;
        lines.push({
            label: `Includes one-time: ${e.name?.trim() || 'One-time inflow'}`,
            amount: e.amount,
            kind: 'info'
        });
    }

    // Every line above is an addend, so the total is exact by construction — there
    // is no independent quantity left for a check to test.
    lines.push({ label: 'Total cash in (pre-tax)', amount: sumLines(lines), kind: 'result' });

    return {
        key: 'incomeSources',
        title: 'Income & withdrawals (gross)',
        lines
    };
}

function taxesSection(inputs: SimulationInputs, r: SimulationResult, hasSpouse: boolean): AuditSection {
    const lines: AuditLine[] = [];
    const { payroll } = payrollWithheld(inputs, r);

    // --- The partition -------------------------------------------------------
    // Every line here is a pro-rata allocation of the household bill: each slice of
    // a person's taxable income carries (slice / taxable income) x that person's
    // tax bill. The slices
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
    part('Employment income tax', (r.employmentIncome - r.netEmploymentIncome) - payroll);
    part('Tax on CPP', r.cppIncome - r.netCPPIncome);
    // The OAS clawback is explained once, on the info line below the result — not
    // here too (see the 'Includes OAS recovery tax' line further down).
    part('Tax on OAS', r.oasIncome - r.netOASIncome);
    part('Tax on DB pension', r.pensionIncome - r.netPensionIncome);
    part('Tax on investment income', r.investmentIncome - r.netInvestmentIncome,
        'Interest, dividends and foreign dividends');
    part('Tax on non-registered sale gains', r.taxShareOnCapGains,
        'The taxable half of gains realized while living, including fund turnover');

    // The marginal per-source attributions (capGainsTaxPaid / dividendTaxPaid /
    // interestTaxPaid) are deliberately NOT shown here: they overlap each other and
    // the partition, so they read as lines that should add up but don't. The
    // marginal view lives in the year-by-year table's Tax Paid hover breakdown.

    part('Tax on RRSP/RRIF withdrawals', r.totalRRSPWithdrawal - r.netRRSPWithdrawal);
    // TFSA withdrawals are tax-free, so they carry no slice at all.
    part('Less: enhanced CPP/QPP deduction', -r.taxReliefFromPayrollDeduction,
        'The enhanced portion of CPP/QPP contributions (and CPP2) is deducted from taxable income — this is the tax that deduction saves');
    part('Less: RRSP contribution deduction', -r.taxReliefFromRRSPDeduction,
        "Contributions made out of this year's surplus");
    part('Less: pension income splitting', -(r.taxSavingsFromSplit ?? 0),
        'Splitting re-prices the whole bill after the per-source slices are struck');

    // The partition sums to r.taxPaid by construction of the engine's pro-rata
    // fields (see the comment above the slices) — there is no independent
    // quantity here for a check to test. That identity is asserted directly in
    // yearAudit.test.ts instead of rendered as a permanently-green row.

    // The denominator is the engine's `finalTaxable` — taxable income, not cash
    // received: it includes the 38% dividend gross-up and only half of realized
    // capital gains, so it will not match 'Total cash in (pre-tax)' a few lines
    // above. Naming the figure via NOTE_AMOUNT_TOKEN (rather than baking a nominal
    // dollar string into the note) lets a reader see exactly which number the
    // percentage is against, and keeps it correct under the real/nominal toggle.
    const effectiveRate = r.grossIncome > 0 ? (r.taxPaid / r.grossIncome) * 100 : 0;
    lines.push({
        label: 'Household income tax',
        amount: r.taxPaid,
        ...(hasSpouse ? { person: r.personTaxPaid, spouse: r.spouseTaxPaid } : {}),
        kind: 'result',
        note: r.grossIncome > 0
            ? `Effective rate ${effectiveRate.toFixed(1)}% of ${NOTE_AMOUNT_TOKEN} taxable income — not the same figure as 'Total cash in (pre-tax)' above, since taxable income includes the 38% dividend gross-up and only half of realized capital gains`
            : undefined,
        noteAmount: r.grossIncome > 0 ? r.grossIncome : undefined
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
            label: 'Includes OAS recovery tax (clawback)',
            amount: r.oasClawbackPaid,
            kind: 'info',
            note: 'Household total, before any pension split — spread across the lines above, not carried by one'
        });
    }

    // Splitting is tax context, not cash: it moves taxable income between spouses
    // and leaves household cash untouched, so it belongs here rather than in the
    // gross cash-in section.
    if ((r.pensionSplitAmount ?? 0) > EPS) {
        lines.push({
            label: 'Pension income split to spouse',
            amount: r.pensionSplitAmount!,
            kind: 'info',
            note: 'Moves taxable income between spouses; household cash is unchanged'
        });
    }

    return {
        key: 'taxes',
        title: 'Taxes',
        lines
    };
}

/**
 * Section 3 — carries the gross total down through the two withholdings to net
 * income, then reconciles net income against what the household actually spent.
 *
 * `cashIn` is the *result line of section 1*, not a re-derivation, so the two
 * sections cannot drift. The arithmetic below is the same sequence the single old
 * `cashFlowSection` performed — gross lines summed, then income tax, payroll, any
 * splitting saving the engine could not allocate, and reinvestment subtracted —
 * which is what keeps the check's expected/actual construction, and so its
 * residual, unchanged.
 */
function cashFlowSection(
    inputs: SimulationInputs,
    r: SimulationResult,
    cashIn: number,
    expenseEvents: OneTimeEvent[]
): AuditSection {
    const lines: AuditLine[] = [];
    const { payroll } = payrollWithheld(inputs, r);

    const add = (label: string, amount: number, note?: string, kind: AuditLineKind = 'normal') => {
        if (Math.abs(amount) < EPS) return;
        lines.push({ label, amount, note, kind });
    };

    add('Total cash in (pre-tax)', cashIn, 'Carried down from Income & withdrawals above');

    // Track whether either withholding actually rendered a line: a TFSA-only
    // retirement year (or any year with no taxable income and no payroll) has
    // neither, and in that case "Net income" would print the exact same figure as
    // "Total cash in (pre-tax)" immediately above it under a different name — a
    // subtotal with nothing subtracted. Only show it when it has something to say.
    const beforeDeductions = lines.length;
    add('Less: income tax', -r.taxPaid);
    add('Less: CPP/EI contributions', -payroll,
        'Withheld on employment income; derived from the inputs — the engine folds it into net employment income');
    const hadDeduction = lines.length > beforeDeductions;

    if (hadDeduction) {
        lines.push({ label: 'Net income', amount: sumLines(lines), kind: 'subtotal' });
    }

    // The pension-splitting saving is normally swept into a non-registered account
    // by Step 5.5, so it arrives below inside "Surplus reinvested". It can only
    // stay unallocated when neither spouse holds a non-registered account to
    // receive it; naming that case keeps the residual honest instead of passing
    // real cash off as solver drift.
    add('Pension-splitting saving left unallocated', -(r.unallocatedSplitSaving ?? 0),
        'Neither spouse holds a non-registered account, so the engine had nowhere to put the refund');

    const reinvested = r.reinvestedTFSA + r.reinvestedRRSP + r.reinvestedNonReg;
    add('Surplus reinvested', -reinvested, 'Swept to TFSA / RRSP / non-registered rather than spent');

    const available = sumLines(lines);
    lines.push({ label: 'Cash available to spend', amount: available, kind: 'result' });

    // The number the whole section builds toward — excluded from the arithmetic
    // like an `info` line, but rendered at normal weight so it doesn't read as a
    // mere annotation (see AuditLineKind).
    lines.push({ label: 'Target spending (incl. one-time expenses)', amount: r.spending, kind: 'reference' });

    // Named `info` lines only — the amount is already folded into r.spending
    // above, so these must never be addends or the check would double-count them.
    for (const e of expenseEvents) {
        if (Math.abs(e.amount) < EPS) continue;
        lines.push({
            label: `Includes one-time: ${e.name?.trim() || 'One-time expense'}`,
            amount: e.amount,
            kind: 'info'
        });
    }

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
        title: 'Net income & spending',
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
        label: 'Investment growth',
        amount: growth,
        note: implausible
            ? 'Unusually large for the balance it grew on — the flows above may not fully explain this year'
            : undefined
    });

    // Growth is defined above as whatever residual makes the waterfall close, so
    // opening balance + flows always equals the closing balance by construction —
    // there is no independent quantity here for a check to test (the
    // growth-implausibility note above is the real safeguard). The waterfall
    // identity is asserted directly in yearAudit.test.ts instead of rendered as a
    // permanently-green row.
    lines.push({ label: 'Closing balance', amount: endBal, kind: 'result' });
    lines.push(...extraLines);

    return {
        key: spec.key,
        title: spec.title,
        lines,
        note: rolledOver > EPS
            ? 'Household totals combine both spouses, so the rollover from the deceased spouse nets out here.'
            : undefined
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
            note: 'Tax-free rollover — no deemed disposition, so no terminal tax on it. TFSA and non-registered ' +
                'balances transfer to the survivor the same way (also tax-free) but have no rollover amount of ' +
                'their own to report — the household totals in the account sections above simply continue unbroken.'
        });
    }
    // Capital gains deemed realized at death are reported once, in the
    // Non-registered section (it sits with the ACB and realized-gains context) —
    // not duplicated here.

    // This is the section's starting figure, reconstructed rather than observed:
    // the account sections above already report the deceased's balances NET of
    // terminal tax (the engine deducts it before closing the books), so this line
    // adds the tax back on to show what the estate was worth before it. It is not
    // a number still waiting to be taxed.
    lines.push({
        label: 'Assets before terminal tax',
        amount: gross,
        kind: 'reference',
        note: totalTerminal > EPS
            ? 'Reconstructed by adding the terminal tax below back onto the post-tax balances the account sections above already report'
            : undefined
    });
    if (terminalRRSP > EPS) lines.push({ label: 'Terminal tax on RRSP/RRIF', amount: -terminalRRSP });
    if (terminalGains > EPS) lines.push({ label: 'Terminal tax on capital gains', amount: -terminalGains });
    // A subtotal only earns its keep when it is actually totalling two things —
    // with just one component nonzero it would print the same number twice in a
    // row under different labels.
    if (terminalRRSP > EPS && terminalGains > EPS) {
        lines.push({ label: 'Total terminal tax', amount: -totalTerminal, kind: 'subtotal' });
    }

    lines.push({
        label: 'Net estate to heirs',
        amount: net,
        kind: 'result',
        note: totalTerminal > EPS
            ? 'Matches the post-tax closing balances in the account sections above — the terminal tax was deducted there, not in this section'
            : undefined
    });

    // The engine computes gross as net + terminal tax (see SimulationResult), so
    // gross − tax = net is tautological — there is no independent quantity here
    // for a check to test. That identity is asserted directly against the engine
    // fields in yearAudit.test.ts instead of rendered as a permanently-green row.

    return {
        key: 'estate',
        title: 'Estate',
        lines,
        note: who.length > 0 ? `Death year — ${who.join(' and ')}.` : 'Death year.'
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
    // Same partition the engine itself uses in projection.ts (expense = anything
    // not explicitly typed 'inflow').
    const inflowEvents = events.filter(e => e.type === 'inflow');
    const expenseEvents = events.filter(e => e.type !== 'inflow');
    const oneTimeInflows = inflowEvents.reduce((s, e) => s + e.amount, 0);

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
            kind: 'info',
            note: 'Full gain; half is taxable'
        });
    }

    // Section 3 starts from section 1's own result line rather than recomputing the
    // gross total, so the two can never disagree.
    const income = incomeSourcesSection(r, oneTimeInflows, hasSpouse, events);
    const cashIn = income.lines.find(l => l.kind === 'result')!.amount;

    const sections: AuditSection[] = [
        income,
        taxesSection(inputs, r, hasSpouse),
        cashFlowSection(inputs, r, cashIn, expenseEvents),
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
