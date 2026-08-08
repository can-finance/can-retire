// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { runSimulation } from '../../engine/projection';
import type { Person, NonRegisteredAccount, SimulationInputs, SimulationResult } from '../../engine/types';
import { formatCurrencyCAD } from '../../utils/formatters';
import { YearlyBreakdownTable } from './YearlyBreakdownTable';
import {
    averageTaxRate,
    COLUMN_GROUPS_STORAGE_KEY,
    DEFAULT_COLUMN_GROUPS,
    type ColumnGroup,
} from './yearlyBreakdownColumns';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same fixture style as YearAuditDrawer.test.tsx.
const nonReg = (over: Partial<NonRegisteredAccount> = {}): NonRegisteredAccount => ({
    type: 'NonRegistered', id: 'nr', name: 'Non-Registered',
    balance: 0, adjustedCostBase: 0,
    assetMix: { bonds: 0, cash: 0, dividend: 0, capitalGain: 1 },
    ...over
});

const person = (over: Partial<Person> = {}): Person => ({
    age: 65, retirementAge: 60, lifeExpectancy: 80,
    currentIncome: 0, cppStartAge: 65, cppContributedYears: 39, oasStartAge: 65,
    rrsp: { type: 'RRSP', balance: 600_000 },
    tfsa: { type: 'TFSA', balance: 100_000 },
    nonRegisteredAccounts: [nonReg({ balance: 200_000, adjustedCostBase: 120_000, receivesSurplus: true })],
    ...over
});

const inputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => ({
    person: person(), province: 'ON', inflationRate: 0.025,
    preRetirementSpend: 0, postRetirementSpend: 70_000,
    oneTimeExpenses: [], useIncomeSplitting: false, withdrawalStrategy: 'tax-efficient',
    returnRates: { bondReturn: 0.03, cashInterest: 0.02, dividend: 0.02, capitalGrowth: 0.04 },
    ...over
});

const SINGLE = inputs();
const COUPLE = inputs({
    spouse: person({ age: 63, rrsp: { type: 'RRSP', balance: 400_000 } }),
    postRetirementSpend: 100_000,
});

const SINGLE_RESULTS = runSimulation(SINGLE);
const COUPLE_RESULTS = runSimulation(COUPLE);

function headerLabels(): string[] {
    return screen.getAllByRole('columnheader').map(th => th.textContent ?? '');
}

function bodyRows(): HTMLElement[] {
    // The header row is the only <tr> inside <thead>; everything else is a data row.
    const table = screen.getByRole('table');
    return within(table).getAllByRole('row').slice(1) as HTMLElement[];
}

/** Text of the body cell sitting under the named header, in the first data row. */
function firstRowCell(label: string): string {
    const idx = headerLabels().indexOf(label);
    expect(idx, `no column headed "${label}"`).toBeGreaterThanOrEqual(0);
    return (within(bodyRows()[0]).getAllByRole('cell')[idx].textContent ?? '').trim();
}

function seedGroups(groups: ColumnGroup[]) {
    window.localStorage.setItem(COLUMN_GROUPS_STORAGE_KEY, JSON.stringify(groups));
}

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('YearlyBreakdownTable — inflation adjustment', () => {
    it('divides currency cells by the row\'s inflationFactor when the toggle is on', () => {
        // Pick a row far enough out that the factor is unmistakably > 1.
        const idx = 10;
        const row: SimulationResult = SINGLE_RESULTS[idx];
        expect(row.inflationFactor).toBeGreaterThan(1.2);

        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        const nominalHeaders = headerLabels();
        const totalIdx = nominalHeaders.indexOf('Total Assets');
        const nominal = within(bodyRows()[idx]).getAllByRole('cell')[totalIdx].textContent;
        expect(nominal).toBe(formatCurrencyCAD(row.totalAssets));

        cleanup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} inflationAdjusted />);
        const adjusted = within(bodyRows()[idx]).getAllByRole('cell')[totalIdx].textContent;
        expect(adjusted).toBe(formatCurrencyCAD(row.totalAssets / row.inflationFactor));
        expect(adjusted).not.toBe(nominal);
    });

    it('adjusts tax-group currency columns too, and leaves the average rate alone', () => {
        seedGroups(['tax']);
        const idx = 10;
        const row = SINGLE_RESULTS[idx];
        const rate = averageTaxRate(row);
        expect(rate, 'fixture should have a taxable year here').not.toBeNull();

        render(<YearlyBreakdownTable data={SINGLE_RESULTS} inflationAdjusted />);
        const labels = headerLabels();
        const cells = within(bodyRows()[idx]).getAllByRole('cell');
        expect(cells[labels.indexOf('Taxable Income')].textContent)
            .toBe(formatCurrencyCAD(row.grossIncome / row.inflationFactor));
        expect(cells[labels.indexOf('Tax Paid')].textContent)
            .toBe(formatCurrencyCAD(row.taxPaid / row.inflationFactor));
        // A ratio of two nominal figures — the toggle must not move it.
        expect(cells[labels.indexOf('Avg Tax Rate')].textContent)
            .toBe(`${(rate! * 100).toFixed(1)}%`);
    });

    it('leaves Year and Age untouched by the toggle', () => {
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} inflationAdjusted />);
        expect(firstRowCell('Year')).toBe(String(SINGLE_RESULTS[0].year));
        expect(firstRowCell('Age')).toBe(String(SINGLE_RESULTS[0].age));
    });
});

describe('YearlyBreakdownTable — column groups', () => {
    const BALANCE_COLS = ['RRSP', 'TFSA', 'Non-Reg', 'Total Assets', 'RRSP Drawn'];
    const INCOME_COLS = ['Net CPP', 'Net OAS', 'Net Pension', 'Total Spend', 'Surplus / Shortfall'];
    const TAX_COLS = ['Taxable Income', 'Tax Paid', 'OAS Clawback', 'Avg Tax Rate', 'Estate Tax'];
    const ANCHORS = ['Year', 'Age'];

    it('defaults to Balances + Income with Tax off', () => {
        expect(DEFAULT_COLUMN_GROUPS).toEqual(['balances', 'income']);
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        const labels = headerLabels();
        expect(labels).toEqual([...ANCHORS, ...BALANCE_COLS, ...INCOME_COLS]);
        expect(screen.getByRole('button', { name: 'Balances' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Income' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Tax' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('a toggle click adds/removes exactly that group\'s columns', async () => {
        const user = userEvent.setup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);

        await user.click(screen.getByRole('button', { name: 'Tax' }));
        expect(headerLabels()).toEqual([...ANCHORS, ...BALANCE_COLS, ...INCOME_COLS, ...TAX_COLS]);

        await user.click(screen.getByRole('button', { name: 'Balances' }));
        expect(headerLabels()).toEqual([...ANCHORS, ...INCOME_COLS, ...TAX_COLS]);

        await user.click(screen.getByRole('button', { name: 'Income' }));
        expect(headerLabels()).toEqual([...ANCHORS, ...TAX_COLS]);

        await user.click(screen.getByRole('button', { name: 'Tax' }));
        // Anchors survive even with every group off.
        expect(headerLabels()).toEqual(ANCHORS);
    });

    it('two toggles dispatched in the same tick both take effect', () => {
        // Regression: the setter takes a value rather than an updater, so without the
        // ref mirror the second click rebuilt the list from the pre-click state and
        // silently undid the first. Browser automation hits this; a human rarely does.
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        act(() => {
            screen.getByRole('button', { name: 'Balances' }).click();
            screen.getByRole('button', { name: 'Tax' }).click();
        });
        expect(headerLabels()).toEqual([...ANCHORS, ...INCOME_COLS, ...TAX_COLS]);
    });

    it('persists the choice to localStorage and reads it back on mount', async () => {
        const user = userEvent.setup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        await user.click(screen.getByRole('button', { name: 'Tax' }));
        await user.click(screen.getByRole('button', { name: 'Income' }));
        expect(JSON.parse(window.localStorage.getItem(COLUMN_GROUPS_STORAGE_KEY)!)).toEqual(['balances', 'tax']);

        cleanup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(headerLabels()).toEqual([...ANCHORS, ...BALANCE_COLS, ...TAX_COLS]);
    });

    it('falls back to the default when the persisted value is junk', () => {
        window.localStorage.setItem(COLUMN_GROUPS_STORAGE_KEY, '"not-an-array"');
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(headerLabels()).toEqual([...ANCHORS, ...BALANCE_COLS, ...INCOME_COLS]);
    });

    it('drops unknown group ids from a persisted value', () => {
        window.localStorage.setItem(COLUMN_GROUPS_STORAGE_KEY, JSON.stringify(['tax', 'wat', 'tax']));
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(headerLabels()).toEqual([...ANCHORS, ...TAX_COLS]);
    });

    // The whole point of the single-source column list: header and body can never
    // drift. Check every group combination, single and spouse.
    const COMBOS: ColumnGroup[][] = [
        [], ['balances'], ['income'], ['tax'],
        ['balances', 'income'], ['balances', 'tax'], ['income', 'tax'],
        ['balances', 'income', 'tax'],
    ];

    for (const spouse of [false, true]) {
        for (const combo of COMBOS) {
            it(`header and body stay aligned — ${spouse ? 'couple' : 'single'}, groups [${combo.join(',')}]`, () => {
                seedGroups(combo);
                const data = spouse ? COUPLE_RESULTS : SINGLE_RESULTS;
                render(<YearlyBreakdownTable data={data} hasSpouse={spouse} />);

                const headerCount = screen.getAllByRole('columnheader').length;
                const rows = bodyRows();
                expect(rows.length).toBe(data.length);
                for (const row of rows) {
                    expect(within(row).getAllByRole('cell')).toHaveLength(headerCount);
                }

                // Anchors are outside every group and always lead.
                const labels = headerLabels();
                expect(labels.slice(0, spouse ? 3 : 2)).toEqual(spouse ? ['Year', 'Age', 'Sp Age'] : ['Year', 'Age']);
                expect(headerCount).toBe((spouse ? 3 : 2) + combo.reduce(
                    (n, g) => n + (g === 'balances' ? (spouse ? 8 : 5) : 5), 0));
            });
        }
    }

    it('keeps the frozen columns sticky with their pinned offsets when groups change', async () => {
        const user = userEvent.setup();
        seedGroups([]);
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);

        const expectFrozen = () => {
            const heads = screen.getAllByRole('columnheader');
            const cells = within(bodyRows()[0]).getAllByRole('cell');
            const lefts = ['left-0', 'left-[72px]', 'left-[136px]'];
            for (let i = 0; i < 3; i++) {
                for (const el of [heads[i], cells[i]]) {
                    expect(el.className).toContain('sticky');
                    expect(el.className).toContain(lefts[i]);
                }
            }
            // The frozen region's edge rule sits on the last frozen column only.
            expect(heads[2].className).toContain('shadow-[1px_0_0_0_rgb(226_232_240)]');
            expect(heads[1].className).not.toContain('shadow-[1px_0_0_0_rgb(226_232_240)]');
            // ...and never on the first scrolling column, whatever it happens to be.
            if (heads.length > 3) expect(heads[3].className).not.toContain('sticky left-');
        };

        expectFrozen();
        await user.click(screen.getByRole('button', { name: 'Tax' }));
        expectFrozen();
        await user.click(screen.getByRole('button', { name: 'Balances' }));
        expectFrozen();
        await user.click(screen.getByRole('button', { name: 'Income' }));
        expectFrozen();
    });
});

describe('YearlyBreakdownTable — new columns', () => {
    it('RRSP Drawn shows the household total and a three-way split tooltip', async () => {
        const user = userEvent.setup();
        const idx = COUPLE_RESULTS.findIndex(r => r.totalRRSPWithdrawal > 1);
        expect(idx).toBeGreaterThanOrEqual(0);
        const row = COUPLE_RESULTS[idx];
        // The engine's partition is exact — the tooltip relies on it.
        expect(row.rrifMinimumWithdrawal + row.voluntaryMeltWithdrawal + row.topUpWithdrawal)
            .toBeCloseTo(row.totalRRSPWithdrawal, 6);

        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        const labels = headerLabels();
        const cell = within(bodyRows()[idx]).getAllByRole('cell')[labels.indexOf('RRSP Drawn')];
        expect(cell.textContent).toBe(formatCurrencyCAD(row.totalRRSPWithdrawal));

        await user.hover(within(cell).getByText(formatCurrencyCAD(row.totalRRSPWithdrawal)));
        const tip = screen.getByRole('tooltip').textContent ?? '';
        expect(tip).toContain('before tax');
        // Only material lines appear, and every one that does carries its figure.
        for (const [label, amount] of [
            ['Mandatory RRIF minimum', row.rrifMinimumWithdrawal],
            ['Voluntary meltdown', row.voluntaryMeltWithdrawal],
            ['Extra draw to fund spending', row.topUpWithdrawal],
        ] as const) {
            if (amount > 1) expect(tip).toContain(`${label}: ${formatCurrencyCAD(amount)}`);
            else expect(tip).not.toContain(label);
        }
    });

    it('the OAS Clawback header warns that it is inside Tax Paid, not on top of it', () => {
        seedGroups(['tax']);
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        const th = screen.getByRole('columnheader', { name: 'OAS Clawback' });
        const tip = th.getAttribute('title') ?? '';
        expect(tip).toMatch(/Part of Tax Paid, not a charge on top of it/);
        expect(tip).toMatch(/count it twice/i);
    });

    it('Avg Tax Rate matches the "Effective rate" line in the Tax Paid tooltip', async () => {
        const user = userEvent.setup();
        seedGroups(['tax']);
        const idx = SINGLE_RESULTS.findIndex(r => averageTaxRate(r) !== null);
        expect(idx).toBeGreaterThanOrEqual(0);
        const row = SINGLE_RESULTS[idx];

        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        const labels = headerLabels();
        const cells = within(bodyRows()[idx]).getAllByRole('cell');
        const shown = cells[labels.indexOf('Avg Tax Rate')].textContent!;

        await user.hover(within(cells[labels.indexOf('Tax Paid')]).getByText(formatCurrencyCAD(row.taxPaid)));
        expect(screen.getByRole('tooltip').textContent).toContain(`Effective rate: ${shown} of taxable income`);
    });

    it('renders a dash rather than a rate when there is no taxable income', () => {
        // A pure-TFSA household never has taxable income, so the guard fires every year.
        const noTax = runSimulation(inputs({
            person: person({
                rrsp: { type: 'RRSP', balance: 0 },
                tfsa: { type: 'TFSA', balance: 900_000 },
                nonRegisteredAccounts: [nonReg()],
                cppContributedYears: 0, cppStartAge: 70, oasStartAge: 70, lifeExpectancy: 68,
            }),
            postRetirementSpend: 40_000,
        }));
        seedGroups(['tax']);
        render(<YearlyBreakdownTable data={noTax} />);
        expect(averageTaxRate(noTax[0])).toBeNull();
        expect(firstRowCell('Avg Tax Rate')).toBe('—');
        expect(firstRowCell('OAS Clawback')).toBe('—');
    });
});
