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
        for (const title of ['Income sources', 'Taxes', 'Cash flow', 'RRSP / RRIF', 'TFSA', 'Non-registered']) {
            expect(screen.getByText(title)).toBeInTheDocument();
        }
        expect(screen.getByText(String(results[5].year), { exact: false })).toBeInTheDocument();
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

    it('a fully reconciling section shows "balances" rather than an unexplained row', () => {
        const results = runSimulation(INITIAL_INPUTS);
        render(
            <YearAuditDrawer
                inputs={INITIAL_INPUTS} results={results} index={0}
                inflationAdjusted={false} hasSpouse={false} onClose={vi.fn()} onNavigate={vi.fn()}
            />
        );
        // Every account waterfall reconciles exactly by construction (growth is
        // the residual) — its check row must read as balancing.
        expect(screen.getAllByText(/— balances/).length).toBeGreaterThan(0);
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
