// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { runSimulation } from '../../engine/projection';
import type { Person, NonRegisteredAccount, SimulationInputs } from '../../engine/types';
import { INITIAL_INPUTS } from '../../utils/inputSanitizer';
import { buildYearAudit } from '../../utils/yearAudit';
import { YearAuditDrawer } from './YearAuditDrawer';
import { YearlyBreakdownTable } from '../tables/YearlyBreakdownTable';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same fixture style as yearAudit.test.ts: a blank-slate retired 65-year-old
// with no CPP/OAS and empty accounts, built up per scenario.
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

// Spouse dies at 78 (rollover to the survivor), primary lives to 90 (terminal tax)
// — the same WIDOWED scenario as yearAudit.test.ts, giving two death years plus a
// spouse split to exercise.
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

// No RRSP, no employment, and CPP/OAS start ages past life expectancy so they
// never trigger — every year's cash-in is a tax-free TFSA withdrawal, so
// taxPaid and payroll are both exactly zero (see yearAudit.test.ts's identical
// fixture for the data-layer coverage of this case).
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

// First INITIAL_INPUTS year whose cash-flow check has residual >= $1 — the
// engine-inherent gap documented in yearAudit.test.ts (stale-age solver estimate
// vs. final assessed tax). Located at test time rather than hardcoded so this
// stays correct if the engine's drift characteristics change.
function findCashFlowResidualIndex(ins: SimulationInputs): { index: number; results: ReturnType<typeof runSimulation> } {
    const results = runSimulation(ins);
    for (let i = 0; i < results.length; i++) {
        const check = buildYearAudit(ins, results, i).sections.find(s => s.key === 'cashFlow')!.check;
        if (check && Math.abs(check.residual) >= 1) return { index: i, results };
    }
    throw new Error('Fixture assumption broken: expected a cash-flow residual >= $1 somewhere in INITIAL_INPUTS');
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('YearAuditDrawer', () => {
    it('renders every core section for a real simulation year', () => {
        const results = runSimulation(INITIAL_INPUTS);
        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS}
                results={results}
                index={5}
                inflationAdjusted={false}
                hasSpouse={false}
                onClose={vi.fn()}
                onNavigate={vi.fn()}
            />
        );

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        for (const title of [
            'Income & withdrawals (gross)', 'Taxes', 'Net income & spending',
            'RRSP / RRIF', 'TFSA', 'Non-registered',
        ]) {
            expect(screen.getByText(title)).toBeInTheDocument();
        }
        expect(screen.getByText(String(results[5].year), { exact: false })).toBeInTheDocument();
    });

    it('reads as one flow: gross total carries into net income and then spending', () => {
        const results = runSimulation(INITIAL_INPUTS);
        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS} results={results} index={0}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        // Once as section 1's result, once as section 3's carry-over line.
        expect(screen.getAllByText('Total cash in (pre-tax)')).toHaveLength(2);
        expect(screen.getByText('Net income')).toBeInTheDocument();
        expect(screen.getByText('Less: income tax')).toBeInTheDocument();
        expect(screen.getByText('Less: CPP/EI contributions')).toBeInTheDocument();
        expect(screen.getByText(/Target spending/)).toBeInTheDocument();
    });

    it('groups the account waterfalls under their own heading and accent styling', () => {
        const results = runSimulation(INITIAL_INPUTS);
        const { container } = render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS} results={results} index={5}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText('Account balances')).toBeInTheDocument();
        // One tinted, colour-accented card per account section.
        for (const accent of ['border-l-sky-500', 'border-l-emerald-500', 'border-l-amber-500']) {
            expect(container.querySelector(`.${accent}`), accent).not.toBeNull();
        }
    });

    it('shows the Estate section only in a death year', () => {
        const results = runSimulation(WIDOWED);
        const deathIndex = results.findIndex(r => r.isDeathYear);
        expect(deathIndex).toBeGreaterThanOrEqual(0);

        render(
            <YearAuditDrawer
                inputs={WIDOWED}
                results={results}
                index={deathIndex}
                inflationAdjusted={false}
                hasSpouse
                onClose={vi.fn()}
                onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText('Estate')).toBeInTheDocument();
        cleanup();

        const liveIndex = results.findIndex(r => !r.isDeathYear);
        expect(liveIndex).toBeGreaterThanOrEqual(0);
        render(
            <YearAuditDrawer
                inputs={WIDOWED}
                results={results}
                index={liveIndex}
                inflationAdjusted={false}
                hasSpouse
                onClose={vi.fn()}
                onNavigate={vi.fn()}
            />
        );
        expect(screen.queryByText('Estate')).toBeNull();
    });

    it('Escape calls onClose', async () => {
        const user = userEvent.setup();
        const results = runSimulation(INITIAL_INPUTS);
        const onClose = vi.fn();
        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS}
                results={results}
                index={3}
                inflationAdjusted={false}
                hasSpouse={false}
                onClose={onClose}
                onNavigate={vi.fn()}
            />
        );

        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ArrowRight/ArrowLeft call onNavigate with the adjacent index', async () => {
        const user = userEvent.setup();
        const results = runSimulation(INITIAL_INPUTS);
        const onNavigate = vi.fn();
        const middle = Math.floor(results.length / 2);
        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS}
                results={results}
                index={middle}
                inflationAdjusted={false}
                hasSpouse={false}
                onClose={vi.fn()}
                onNavigate={onNavigate}
            />
        );

        await user.keyboard('{ArrowRight}');
        expect(onNavigate).toHaveBeenCalledWith(middle + 1);

        onNavigate.mockClear();
        await user.keyboard('{ArrowLeft}');
        expect(onNavigate).toHaveBeenCalledWith(middle - 1);
    });

    it('the Previous-year button is disabled at index 0 and enabled elsewhere', () => {
        const results = runSimulation(INITIAL_INPUTS);
        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS}
                results={results}
                index={0}
                inflationAdjusted={false}
                hasSpouse={false}
                onClose={vi.fn()}
                onNavigate={vi.fn()}
            />
        );
        expect(screen.getByRole('button', { name: 'Previous year' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Next year' })).toBeEnabled();
        cleanup();

        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS}
                results={results}
                index={results.length - 1}
                inflationAdjusted={false}
                hasSpouse={false}
                onClose={vi.fn()}
                onNavigate={vi.fn()}
            />
        );
        expect(screen.getByRole('button', { name: 'Previous year' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled();
    });

    it('renders the badges the audit reports: first-year, final-year, shortfall, one-time-event, death-year', () => {
        const initial = runSimulation(INITIAL_INPUTS);
        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS} results={initial} index={0}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText('First year')).toBeInTheDocument();
        cleanup();

        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS} results={initial} index={initial.length - 1}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText('Final year')).toBeInTheDocument();
        cleanup();

        const shortfallResults = runSimulation(SHORTFALL);
        const shortfallIndex = shortfallResults.findIndex(r => r.shortfall > 1);
        expect(shortfallIndex).toBeGreaterThanOrEqual(0);
        render(
            <YearAuditDrawer
                inputs={SHORTFALL} results={shortfallResults} index={shortfallIndex}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText('Shortfall')).toBeInTheDocument();
        cleanup();

        const oneTimeResults = runSimulation(ONE_TIME);
        const eventIndex = oneTimeResults.findIndex(r => r.age === 66);
        render(
            <YearAuditDrawer
                inputs={ONE_TIME} results={oneTimeResults} index={eventIndex}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText('One-time event')).toBeInTheDocument();
        cleanup();

        const widowedResults = runSimulation(WIDOWED);
        const deathIndex = widowedResults.findIndex(r => r.isDeathYear);
        render(
            <YearAuditDrawer
                inputs={WIDOWED} results={widowedResults} index={deathIndex}
                inflationAdjusted={false} hasSpouse onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText('Death year')).toBeInTheDocument();
    });

    it('renders the one-time expense as a named info line, and the one-time inflow named alongside its addend', () => {
        const results = runSimulation(ONE_TIME);
        const expenseIndex = results.findIndex(r => r.age === 66);
        render(
            <YearAuditDrawer
                inputs={ONE_TIME} results={results} index={expenseIndex}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText('Includes one-time: Roof')).toBeInTheDocument();
        cleanup();

        const inflowIndex = results.findIndex(r => r.age === 67);
        render(
            <YearAuditDrawer
                inputs={ONE_TIME} results={results} index={inflowIndex}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText('Includes one-time: Inheritance')).toBeInTheDocument();
        expect(screen.getByText('One-time inflows')).toBeInTheDocument();
    });

    it('shows an "unexplained" residual row when a section check does not balance', () => {
        const { index, results } = findCashFlowResidualIndex(INITIAL_INPUTS);
        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS} results={results} index={index}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getByText(/unexplained:/i)).toBeInTheDocument();
    });

    it('shows at most one check row — cashFlow is the only section with one — and it reads "balances" when the residual is small', () => {
        const results = runSimulation(INITIAL_INPUTS);
        const { index: residualIndex } = findCashFlowResidualIndex(INITIAL_INPUTS);
        // Pick a year other than the one with the known >=$1 residual, so the
        // cashFlow check row reads as balancing.
        const index = residualIndex === 0 ? 1 : 0;
        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS} results={results} index={index}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        // Only the cashFlow section (Net income & spending) still carries a check
        // — taxes/accounts/estate hold by construction and no longer render one.
        const checkRows = screen.getAllByText(/— balances|— unexplained:/);
        expect(checkRows).toHaveLength(1);
        expect(screen.getByText(/— balances/)).toBeInTheDocument();
    });

    it('the effective-rate note substitutes the taxable-income figure, scaled with the real/nominal toggle', () => {
        const results = runSimulation(INITIAL_INPUTS);
        const i = results.findIndex(r => r.taxPaid > 1 && r.grossIncome > 0);
        expect(i, 'expected a taxed year').toBeGreaterThanOrEqual(0);

        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS} results={results} index={i}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        // The note must not still contain the raw token, and must show a dollar
        // figure — proof the substitution ran rather than just leaving the label.
        expect(screen.queryByText(/\{amount\}/)).toBeNull();
        expect(screen.getByText(/Effective rate .*% of \$[\d,]+ taxable income/)).toBeInTheDocument();
    });

    it('reference lines (Assets before terminal tax, Target spending) render legibly, not muted like info', () => {
        const results = runSimulation(ONE_TIME);
        const deathIndex = results.length - 1;
        expect(results[deathIndex].totalTerminalTax).toBeGreaterThan(0);

        render(
            <YearAuditDrawer
                inputs={ONE_TIME} results={results} index={deathIndex}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        const assetsCell = screen.getByText('Assets before terminal tax').closest('td')!;
        expect(assetsCell.className).not.toContain('text-slate-400');

        const targetCell = screen.getByText(/Target spending/).closest('td')!;
        expect(targetCell.className).not.toContain('text-slate-400');

        // A genuine info annotation alongside it must stay muted, so the contrast
        // is deliberate rather than the muted styling having been removed outright.
        const oneTimeIdx = results.findIndex(r => r.age === 66);
        cleanup();
        render(
            <YearAuditDrawer
                inputs={ONE_TIME} results={results} index={oneTimeIdx}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        const infoCell = screen.getByText('Includes one-time: Roof').closest('td')!;
        expect(infoCell.className).toContain('text-slate-400');
    });

    it('a TFSA-only year omits "Net income" — nothing was deducted between it and "Total cash in"', () => {
        const results = runSimulation(TFSA_ONLY);
        render(
            <YearAuditDrawer
                inputs={TFSA_ONLY} results={results} index={0}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        // Appears twice by design (section 1's result and section 3's carry-over
        // line) — see the "reads as one flow" test above.
        expect(screen.getAllByText('Total cash in (pre-tax)').length).toBeGreaterThan(0);
        expect(screen.queryByText('Net income')).toBeNull();
        expect(screen.queryByText('Less: income tax')).toBeNull();
        expect(screen.queryByText('Less: CPP/EI contributions')).toBeNull();
    });

    it('the estate section shows the deemed-gains line once (in Non-registered), and the rollover note names TFSA/non-reg', () => {
        const results = runSimulation(WIDOWED);
        const rolloverIndex = results.findIndex(r => r.spouseDeathThisYear);
        expect(rolloverIndex).toBeGreaterThanOrEqual(0);
        render(
            <YearAuditDrawer
                inputs={WIDOWED} results={results} index={rolloverIndex}
                inflationAdjusted={false} hasSpouse onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        // A specific phrase from the rollover note, not just "TFSA" or
        // "non-registered" alone — both also appear as section headings on this
        // page, which would make a bare substring match ambiguous.
        expect(screen.getByText(/TFSA and non-registered balances transfer/i)).toBeInTheDocument();
        cleanup();

        const terminalIndex = results.length - 1;
        expect(results[terminalIndex].terminalRealizedGains).toBeGreaterThan(0);
        render(
            <YearAuditDrawer
                inputs={WIDOWED} results={results} index={terminalIndex}
                inflationAdjusted={false} hasSpouse onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        expect(screen.getAllByText('Capital gains deemed realized at death')).toHaveLength(1);
    });
});

describe('YearlyBreakdownTable — onSelectYear wiring', () => {
    it('row click and Enter both call onSelectYear with that row\'s year', async () => {
        const user = userEvent.setup();
        const results = runSimulation(INITIAL_INPUTS);
        const onSelectYear = vi.fn();
        render(<YearlyBreakdownTable data={results} onSelectYear={onSelectYear} />);

        const target = results[2];
        const row = screen.getByRole('row', { name: `Open ${target.year} breakdown` });

        await user.click(row);
        expect(onSelectYear).toHaveBeenCalledWith(target.year);

        onSelectYear.mockClear();
        row.focus();
        await user.keyboard('{Enter}');
        expect(onSelectYear).toHaveBeenCalledWith(target.year);
    });

    it('rows are not focusable/clickable when onSelectYear is not provided', () => {
        const results = runSimulation(INITIAL_INPUTS);
        render(<YearlyBreakdownTable data={results} />);
        expect(screen.queryByRole('row', { name: /Open \d+ breakdown/ })).toBeNull();
    });
});
