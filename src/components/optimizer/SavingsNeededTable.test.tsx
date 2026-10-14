// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SavingsNeededTable } from './SavingsNeededTable';
import type { SavingsAgeRow, SavingsNeededResult } from '../../utils/meltdownOptimizer';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

// What each row claims, not how it looks. Hand-built fixtures: no solver runs.

// A single person, 57 today, retiring at 60 with $500k saved, who needs about
// $1.2M by 60 against the $850k they're on track for.
const row = (over: Partial<SavingsAgeRow>): SavingsAgeRow => ({
    delta: 0, retirementAge: 60, isPlan: false, status: 'found',
    neededSavings: 700_000, neededAtRetirement: 1_203_000, currentAtRetirement: 851_000,
    savingsGap: 200_000, haveEnough: false, successRateAtCurrent: 62,
    clears: true, stepUpCapHit: false, boundHit: false,
    ...over,
});

const ROWS: SavingsAgeRow[] = [
    // Retiring this year: no working year left, so today's figures stand in.
    row({ delta: -3, retirementAge: 57, neededSavings: 1_400_000, neededAtRetirement: null, currentAtRetirement: null, successRateAtCurrent: 20 }),
    // No amount up to the cap meets the target: only a best probe.
    row({ delta: -2, retirementAge: 58, neededSavings: 10_000_000, neededAtRetirement: 11_500_000, currentAtRetirement: 700_000, clears: false, boundHit: true, successRateAtCurrent: 31 }),
    row({ delta: 0, isPlan: true }),
    row({ delta: 1, retirementAge: 61, neededSavings: 450_000, neededAtRetirement: 902_000, currentAtRetirement: 1_018_000, haveEnough: true, successRateAtCurrent: 90 }),
    // Both sides round to $1M.
    row({ delta: 2, retirementAge: 62, neededSavings: 500_000, neededAtRetirement: 1_004_000, currentAtRetirement: 996_000, haveEnough: true, successRateAtCurrent: 86 }),
];

const sn = (over: Partial<SavingsNeededResult> = {}): SavingsNeededResult => ({
    status: 'found', basis: 'proportional',
    currentSavings: 500_000, neededSavings: 700_000, deterministicSavings: 650_000,
    searchCap: 10_000_000, savingsGap: 200_000,
    haveEnough: false, needIsZero: false, strategyChangeNeeded: false,
    neededAccounts: [],
    stillWorking: true, reportedWho: 'person', currentAge: 57, retirementAge: 60,
    neededAtRetirement: 1_203_000, currentAtRetirement: 851_000,
    mcSuccessTarget: 85, achievedSuccessRate: 87, stepUpCapHit: false, boundHit: false,
    postRetirementSpend: 60_000, withdrawalStrategy: 'tax-efficient', strategyChanged: false,
    badMarketsAge: null, perYear: null, ageRows: ROWS,
    ...over,
});

const rowsOf = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '');

describe('SavingsNeededTable', () => {
    it('one row per age: the plan row marked, amounts at retirement, the difference in words', () => {
        const { container } = render(<SavingsNeededTable result={sn()} />);
        const [now, missing, plan, later, later2] = rowsOf(container);

        expect(plan).toContain('your plan');
        expect(plan).toContain('$1.2M');
        expect(plan).toContain('$850k');
        expect(plan).toContain('$350k more');
        expect(plan).toContain('✗ 62%');
        expect(rowsOf(container).filter(t => t.includes('your plan'))).toHaveLength(1);

        expect(later).toContain('$900k');
        expect(later).toContain('$120k to spare');
        expect(later).toContain('✓ 90%');
        expect(later2).toContain('about right');

        // Retiring now: today's need and today's savings, marked.
        expect(now).toContain('$1.4Mtoday');
        expect(now).toContain('$500ktoday');
        expect(now).toContain('$900k more');

        // No amount meets the target: a dash, never the best probe.
        expect(missing).not.toContain('$11.5M');
        expect(missing).not.toContain('$10M');
        expect(missing).toContain('$700k');
        expect(missing).toContain('✗ 31%');
        expect(missing.match(/—/g)).toHaveLength(2);

        const text = container.textContent ?? '';
        expect(text).toContain('A dash means no amount meets your target.');
        expect(text).toContain('Retiring this year uses today\'s amounts.');
        expect(text).toContain('Other ages are estimates that keep your answer\'s choices and may run a little high.');
        expect(text).toContain('Amounts are in today\'s dollars.');
    });

    it('a couple: both ages, and no dash or today notes when every row clears in a later year', () => {
        const couple = ROWS.slice(2).map(r => ({ ...r, otherRetirementAge: r.retirementAge + 2 }));
        const { container } = render(<SavingsNeededTable result={sn({ ageRows: couple })} />);
        const text = container.textContent ?? '';
        expect(text).toContain('You retire at');
        expect(text).toContain('Spouse');
        expect(rowsOf(container)[0]).toMatch(/^60your plan62/);
        expect(text).not.toContain('A dash means');
        expect(text).not.toContain('For retiring this year');
    });

    it('hidden with only the plan row, or none', () => {
        expect(render(<SavingsNeededTable result={sn({ ageRows: [row({ isPlan: true })] })} />).container.textContent).toBe('');
        cleanup();
        expect(render(<SavingsNeededTable result={sn({ ageRows: [] })} />).container.textContent).toBe('');
    });
});
