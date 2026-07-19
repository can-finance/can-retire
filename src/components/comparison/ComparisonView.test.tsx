// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ComparisonView } from './ComparisonView';
import { INITIAL_INPUTS } from '../../utils/inputSanitizer';
import type { SavedPlan } from '../../hooks/usePlans';
import type { SimulationResult } from '../../engine/types';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock the engine so no real simulation runs and recharts gets tiny, fixed
// data. computeSummaryMetrics (utils/summaryMetrics.ts) is NOT mocked -- it
// runs real math over these fake rows, which is fine since the numbers below
// are plausible and internally consistent. summaryMetrics also imports
// `totalNonRegBalance` from this same module, so the real module is spread in
// first and only runSimulation/runMonteCarlo are overridden.
vi.mock('../../engine/projection', async importOriginal => ({
    ...(await importOriginal<typeof import('../../engine/projection')>()),
    runSimulation: vi.fn(
        (): SimulationResult[] => [
            {
                year: 2026,
                age: 60,
                totalAssets: 900000,
                grossIncome: 60000,
                cppIncome: 0,
                oasIncome: 0,
                netIncome: 55000,
                spending: 55000,
                taxPaid: 8000,
                personTaxPaid: 8000,
                spouseTaxPaid: 0,
                oasClawbackPaid: 0,
                capGainsTaxPaid: 500,
                terminalRealizedGains: 0,
                dividendTaxPaid: 0,
                interestTaxPaid: 0,
                accounts: { rrsp: 400000, tfsa: 200000, nonRegistered: 300000, nonRegisteredACB: 150000 },
                netEmploymentIncome: 0,
                netCPPIncome: 0,
                netOASIncome: 0,
                netInvestmentIncome: 10000,
                personNetCPP: 0,
                spouseNetCPP: 0,
                personNetOAS: 0,
                spouseNetOAS: 0,
                netRRSPWithdrawal: 30000,
                netTFSAWithdrawal: 10000,
                netNonRegWithdrawal: 15000,
                reinvestedTFSA: 0,
                reinvestedRRSP: 0,
                reinvestedNonReg: 0,
                personNetRRSP: 30000,
                spouseNetRRSP: 0,
                personNetTFSA: 10000,
                spouseNetTFSA: 0,
                personNetNonReg: 15000,
                spouseNetNonReg: 0,
                totalTFSAWithdrawal: 10000,
                totalNonRegWithdrawal: 15000,
                totalRRSPWithdrawal: 30000,
                employmentIncome: 0,
                investmentIncome: 10000,
                totalRealizedCapGains: 5000,
                inflationFactor: 1.0,
                householdSurplus: 0,
                shortfall: 0,
            },
            {
                year: 2027,
                age: 61,
                totalAssets: 870000,
                grossIncome: 58000,
                cppIncome: 0,
                oasIncome: 0,
                netIncome: 54000,
                spending: 55000,
                taxPaid: 7800,
                personTaxPaid: 7800,
                spouseTaxPaid: 0,
                oasClawbackPaid: 0,
                capGainsTaxPaid: 450,
                terminalRealizedGains: 147000, // death year: gross non-reg gains (nonRegistered - ACB)
                dividendTaxPaid: 0,
                interestTaxPaid: 0,
                accounts: { rrsp: 380000, tfsa: 195000, nonRegistered: 295000, nonRegisteredACB: 148000 },
                netEmploymentIncome: 0,
                netCPPIncome: 0,
                netOASIncome: 0,
                netInvestmentIncome: 9800,
                personNetCPP: 0,
                spouseNetCPP: 0,
                personNetOAS: 0,
                spouseNetOAS: 0,
                netRRSPWithdrawal: 29000,
                netTFSAWithdrawal: 9500,
                netNonRegWithdrawal: 14500,
                reinvestedTFSA: 0,
                reinvestedRRSP: 0,
                reinvestedNonReg: 0,
                personNetRRSP: 29000,
                spouseNetRRSP: 0,
                personNetTFSA: 9500,
                spouseNetTFSA: 0,
                personNetNonReg: 14500,
                spouseNetNonReg: 0,
                totalTFSAWithdrawal: 9500,
                totalNonRegWithdrawal: 14500,
                totalRRSPWithdrawal: 29000,
                employmentIncome: 0,
                investmentIncome: 9800,
                totalRealizedCapGains: 4800,
                inflationFactor: 1.025,
                householdSurplus: 0,
                shortfall: 0,
                isDeathYear: true,
                totalTerminalTax: 20000,
                grossEstateValue: 870000,
                netEstateValue: 850000,
            },
        ],
    ),
    runMonteCarlo: vi.fn(() => ({
        percentiles: [
            { year: 2026, age: 60, p5: 700000, p25: 800000, p50: 900000, p75: 950000, p95: 1000000 },
            { year: 2027, age: 61, p5: 650000, p25: 780000, p50: 870000, p75: 930000, p95: 980000 },
        ],
        successRate: 87,
        medianEndOfPlanAssets: 500000,
    })),
}));

function makePlan(overrides: Partial<SavedPlan> = {}): SavedPlan {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        name: overrides.name ?? 'Plan',
        inputs: overrides.inputs ?? INITIAL_INPUTS,
        lastSaved: overrides.lastSaved ?? new Date().toISOString(),
    };
}

function renderView(plans: SavedPlan[], activePlanId: string | null, onExit = vi.fn()) {
    render(
        <ComparisonView
            plans={plans}
            activePlanId={activePlanId}
            liveInputs={INITIAL_INPUTS}
            isInflationAdjusted={false}
            onToggleInflation={vi.fn()}
            onExit={onExit}
        />
    );
    return { onExit };
}

/** Chip <button> for a given label, matched on its own text (excludes the date span). */
function chipButton(name: string): HTMLElement {
    return screen.getByRole('button', { name: new RegExp(`^${name}`) });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ComparisonView', () => {
    it('defaults to the active plan + the most recently edited other plan', () => {
        const older = makePlan({ name: 'Older Plan', lastSaved: '2026-01-01T00:00:00.000Z' });
        const active = makePlan({ name: 'Active Plan', lastSaved: '2026-03-01T00:00:00.000Z' });
        const newer = makePlan({ name: 'Newer Plan', lastSaved: '2026-06-01T00:00:00.000Z' });
        renderView([older, active, newer], active.id);

        expect(chipButton('Active Plan')).toHaveAttribute('aria-pressed', 'true');
        expect(chipButton('Newer Plan')).toHaveAttribute('aria-pressed', 'true');
        expect(chipButton('Older Plan')).toHaveAttribute('aria-pressed', 'false');
    });

    it("marks the active plan's chip with an (active) label", () => {
        const active = makePlan({ name: 'Active Plan' });
        const other = makePlan({ name: 'Other Plan' });
        renderView([active, other], active.id);

        expect(screen.getByRole('button', { name: /^Active Plan.*\(active\)/ })).toBeInTheDocument();
    });

    it('enforces a max of 3 selected comparands', async () => {
        const user = userEvent.setup();
        const a = makePlan({ name: 'Plan A', lastSaved: '2026-01-01T00:00:00.000Z' });
        const b = makePlan({ name: 'Plan B', lastSaved: '2026-02-01T00:00:00.000Z' });
        const c = makePlan({ name: 'Plan C', lastSaved: '2026-03-01T00:00:00.000Z' });
        const d = makePlan({ name: 'Plan D', lastSaved: '2026-06-01T00:00:00.000Z' });
        // Default selection is A (active) + Plan D (most recent); select Plan B as the third.
        renderView([a, b, c, d], a.id);

        await user.click(chipButton('Plan B'));

        expect(chipButton('Plan B')).toHaveAttribute('aria-pressed', 'true');
        expect(chipButton('Plan C')).toBeDisabled();
    });

    it('enforces a minimum of 1 selected comparand', async () => {
        const user = userEvent.setup();
        const active = makePlan({ name: 'Active Plan' });
        const other = makePlan({ name: 'Other Plan' });
        renderView([active, other], active.id);

        // Default selection: Active Plan + Other Plan (2 selected).
        await user.click(chipButton('Active Plan'));
        expect(chipButton('Active Plan')).toHaveAttribute('aria-pressed', 'false');

        // Down to one selected (Other Plan) -- clicking it again must be a no-op.
        await user.click(chipButton('Other Plan'));
        expect(chipButton('Other Plan')).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows a placeholder success rate, then fills in the mocked Monte Carlo result', () => {
        vi.useFakeTimers();
        try {
            const active = makePlan({ name: 'Active Plan' });
            const other = makePlan({ name: 'Other Plan' });
            renderView([active, other], active.id);

            // Before the deferred Monte Carlo timers run, both selected comparands show placeholders.
            const placeholders = screen.getAllByText('…');
            expect(placeholders.length).toBeGreaterThanOrEqual(2);

            act(() => {
                vi.runAllTimers();
            });

            const successCells = screen.getAllByText('87%');
            expect(successCells).toHaveLength(2); // Active Plan + Other Plan
        } finally {
            vi.useRealTimers();
        }
    });

    it('shows the insufficient-plans state and no chart/table with fewer than two plans', () => {
        renderView([makePlan()], null);

        expect(screen.getByText('Create at least two plans to compare.')).toBeInTheDocument();
        expect(screen.queryByRole('table')).toBeNull();
    });

    it('calls onExit when "Back to Dashboard" is clicked', async () => {
        const user = userEvent.setup();
        const { onExit } = renderView([makePlan(), makePlan()], null);

        await user.click(screen.getByRole('button', { name: 'Back to Dashboard' }));

        expect(onExit).toHaveBeenCalledTimes(1);
    });
});
