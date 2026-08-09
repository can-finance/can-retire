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
    ACCOUNT_DETAIL_STORAGE_KEY,
    averageTaxRate,
    DEFAULT_ACCOUNT_DETAIL,
    formatPercent1,
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

// The base fixtures carry no DB pension at all, so the Net Pension column is
// absent from them — every expectation below is written against that.
const SINGLE_RESULTS = runSimulation(SINGLE);
const COUPLE_RESULTS = runSimulation(COUPLE);

// ...and these two do have one, so the column comes back.
const PENSION_SINGLE_RESULTS = runSimulation(inputs({
    person: person({ pension: { annualAmount: 40_000, startAge: 65, indexedToInflation: true } }),
}));
// Only the SPOUSE has the pension: netPensionIncome is the combined household
// figure, so one pass over the data has to find it wherever it comes from.
const SPOUSE_PENSION_RESULTS = runSimulation(inputs({
    spouse: person({
        age: 63, rrsp: { type: 'RRSP', balance: 400_000 },
        pension: { annualAmount: 30_000, startAge: 65, indexedToInflation: true },
    }),
    postRetirementSpend: 100_000,
}));

// Nothing taxable survives to the death year: no RRSP, no unrealized non-reg
// gain, no benefits (dies before either start age), so the deemed disposition is
// worth nothing and the estate-tax footer must not render.
const NO_ESTATE_TAX_RESULTS = runSimulation(inputs({
    person: person({
        rrsp: { type: 'RRSP', balance: 0 },
        tfsa: { type: 'TFSA', balance: 900_000 },
        nonRegisteredAccounts: [nonReg()],
        cppContributedYears: 0, cppStartAge: 70, oasStartAge: 70, lifeExpectancy: 68,
    }),
    postRetirementSpend: 40_000,
}));

// The PRIMARY person dies first and the spouse outlives them, so the later rows
// have no marginal rate of their own to report — the one case that has to render
// a dash rather than 0%.
const WIDOWED_SPOUSE_RESULTS = runSimulation(inputs({
    person: person({ age: 65, lifeExpectancy: 70 }),
    spouse: person({ age: 63, rrsp: { type: 'RRSP', balance: 400_000 } }),
    postRetirementSpend: 100_000,
}));

function headerLabels(): string[] {
    return screen.getAllByRole('columnheader').map(th => th.textContent ?? '');
}

function bodyRows(): HTMLElement[] {
    // Scoped to <tbody>, so neither the sticky header nor the estate-tax <tfoot>
    // total can ever be mistaken for a data row.
    const tbody = screen.getByRole('table').querySelector('tbody')!;
    return within(tbody).getAllByRole('row') as HTMLElement[];
}

/** The estate-tax total row, or null when the table renders no <tfoot> at all. */
function footerRow(): HTMLElement | null {
    const tfoot = screen.getByRole('table').querySelector('tfoot');
    return tfoot ? (within(tfoot).getByRole('row') as HTMLElement) : null;
}

/** Rows the engine charged terminal tax on, by the file's ">$1" nominal rule. */
function terminalRows(data: SimulationResult[]): SimulationResult[] {
    return data.filter(r => (r.totalTerminalTax ?? 0) > 1);
}

function estateTotal(data: SimulationResult[], adjusted = false): number {
    return terminalRows(data).reduce(
        (sum, r) => sum + (adjusted ? r.totalTerminalTax! / r.inflationFactor : r.totalTerminalTax!),
        0
    );
}

/** Text of the body cell sitting under the named header, in the first data row. */
function firstRowCell(label: string): string {
    const idx = headerLabels().indexOf(label);
    expect(idx, `no column headed "${label}"`).toBeGreaterThanOrEqual(0);
    return (within(bodyRows()[0]).getAllByRole('cell')[idx].textContent ?? '').trim();
}

// --- The full column vocabulary, in render order ---------------------------
const ANCHORS = ['Year', 'Age'];
const SP_ANCHORS = ['Year', 'Age', 'Sp Age'];
const OWN_BALANCES = ['RRSP', 'TFSA', 'Non-Reg'];
const SP_BALANCES = ['Sp RRSP', 'Sp TFSA', 'Sp Non-Reg'];
// What survives the account-detail toggle: a household total and a flow.
const BALANCE_SUMMARY = ['Total Assets', 'RRSP Drawn'];
const PENSION_COL = 'Net Pension';
const INCOME_COLS = ['Net CPP', 'Net OAS', 'Total Spend', 'Surplus / Shortfall'];
// Estate tax is deliberately NOT among them — it is a <tfoot> total, not a column.
const TAX_COLS = ['Taxable Income', 'Tax Paid', 'OAS Clawback', 'Avg Tax Rate', 'Marginal Rate'];

/**
 * Every column the table should render, for a given household/option shape.
 *
 * `detail` is deliberately REQUIRED rather than defaulted: DEFAULT_ACCOUNT_DETAIL
 * has moved once already, and a default here would let it move again while every
 * test that spelled out the full column vocabulary quietly started describing a
 * different table. Each test says which setting it means, and pairs this with
 * `setAccountDetail` so the render agrees with the expectation.
 */
function expectedLabels({ spouse = false, detail, pension = false }: { spouse?: boolean; detail: boolean; pension?: boolean }): string[] {
    const balances = detail
        ? [...OWN_BALANCES, ...(spouse ? SP_BALANCES : [])]
        : [];
    const income = pension
        ? ['Net CPP', 'Net OAS', PENSION_COL, 'Total Spend', 'Surplus / Shortfall']
        : INCOME_COLS;
    return [
        ...(spouse ? SP_ANCHORS : ANCHORS),
        ...balances, ...BALANCE_SUMMARY, ...income, ...TAX_COLS,
    ];
}

/**
 * Pin the account-detail switch for the render that follows, through the same
 * persisted key the component reads on mount. Only the tests ABOUT the default
 * (and the two-clicks-in-a-tick regression, which cares about the delta rather
 * than the starting point) leave it unset.
 */
function setAccountDetail(on: boolean): void {
    window.localStorage.setItem(ACCOUNT_DETAIL_STORAGE_KEY, JSON.stringify(on));
}

const detailToggle = () => screen.getByRole('button', { name: 'Account details' });

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

    it('adjusts the tax currency columns too, and leaves the average rate alone', () => {
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
        // Ratios, not amounts — the toggle must not move either of them.
        expect(cells[labels.indexOf('Avg Tax Rate')].textContent)
            .toBe(`${(rate! * 100).toFixed(1)}%`);
        expect(row.personMarginalRate, 'fixture should have a live person here').toBeDefined();
        expect(cells[labels.indexOf('Marginal Rate')].textContent)
            .toBe(formatPercent1(row.personMarginalRate!));
    });

    it('leaves Year and Age untouched by the toggle', () => {
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} inflationAdjusted />);
        expect(firstRowCell('Year')).toBe(String(SINGLE_RESULTS[0].year));
        expect(firstRowCell('Age')).toBe(String(SINGLE_RESULTS[0].age));
    });
});

describe('YearlyBreakdownTable — the column set', () => {
    // "Every column there is" means the widest table, which is account details ON
    // — switched on explicitly, since that is no longer the default.
    it('shows every column there is, for a single person', () => {
        setAccountDetail(true);
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(headerLabels()).toEqual(expectedLabels({ detail: true }));
    });

    it('shows every column there is, plus the spouse ones, for a couple', () => {
        setAccountDetail(true);
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        expect(headerLabels()).toEqual(expectedLabels({ spouse: true, detail: true }));
    });

    it('offers exactly one column control — no group toggles', () => {
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Account details']);
        for (const gone of ['Balances', 'Income', 'Tax']) {
            expect(screen.queryByRole('button', { name: gone })).toBeNull();
        }
    });
});

describe('YearlyBreakdownTable — account detail', () => {
    it('is OFF by default, so a reader with no stored preference gets the narrow table', () => {
        // The default is the table's first impression, and the per-account columns
        // are the bulk of its width — hence off. Nothing is stored here on purpose.
        expect(DEFAULT_ACCOUNT_DETAIL).toBe(false);
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        expect(detailToggle()).toHaveAttribute('aria-pressed', 'false');
        expect(headerLabels()).toEqual(expectedLabels({ spouse: true, detail: false }));
        // Total Assets and RRSP Drawn still carry the balance story.
        for (const kept of BALANCE_SUMMARY) expect(headerLabels()).toContain(kept);
    });

    it('switching it off hides exactly the six per-account columns for a couple', async () => {
        const user = userEvent.setup();
        setAccountDetail(true);
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        const before = headerLabels();
        expect(before).toEqual(expectedLabels({ spouse: true, detail: true }));

        await user.click(detailToggle());

        const after = headerLabels();
        expect(before.filter(l => !after.includes(l))).toEqual([...OWN_BALANCES, ...SP_BALANCES]);
        expect(after).toEqual(expectedLabels({ spouse: true, detail: false }));
        expect(detailToggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('drops three columns for a single person, keeping Total Assets and RRSP Drawn', async () => {
        const user = userEvent.setup();
        setAccountDetail(true);
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(headerLabels()).toEqual(expectedLabels({ detail: true }));
        await user.click(detailToggle());
        expect(headerLabels()).toEqual(expectedLabels({ detail: false }));
    });

    it('is never disabled — there is nothing left to gate it on', async () => {
        const user = userEvent.setup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(detailToggle()).not.toHaveAttribute('aria-disabled');
        await user.click(detailToggle());
        expect(detailToggle()).not.toHaveAttribute('aria-disabled');
    });

    it('persists the choice to localStorage and reads it back on mount', async () => {
        const user = userEvent.setup();
        // Starts from the default (nothing stored), so the round trip covers the
        // switched-ON value first...
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        await user.click(detailToggle());
        expect(JSON.parse(window.localStorage.getItem(ACCOUNT_DETAIL_STORAGE_KEY)!)).toBe(true);

        cleanup();
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        expect(headerLabels()).toEqual(expectedLabels({ spouse: true, detail: true }));
        expect(detailToggle()).toHaveAttribute('aria-pressed', 'true');

        // ...and then the switched-OFF one, which now coincides with the default and
        // so would survive a read that only honoured a truthy stored value.
        await user.click(detailToggle());
        expect(JSON.parse(window.localStorage.getItem(ACCOUNT_DETAIL_STORAGE_KEY)!)).toBe(false);

        cleanup();
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        expect(headerLabels()).toEqual(expectedLabels({ spouse: true, detail: false }));
        expect(detailToggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('falls back to the default when the persisted value is junk', () => {
        // A TRUTHY non-boolean, so an unsanitized read would switch the detail on and
        // the assertion below would catch it — the fallback has to reach the default,
        // not merely something.
        window.localStorage.setItem(ACCOUNT_DETAIL_STORAGE_KEY, '"nope"');
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(headerLabels()).toEqual(expectedLabels({ detail: DEFAULT_ACCOUNT_DETAIL }));
        expect(headerLabels()).not.toContain('RRSP');
        expect(detailToggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('two clicks in one tick land on the original value, not a lost first click', () => {
        // Regression: the setter takes a value rather than an updater, so without the
        // ref mirror the second click rebuilt from the pre-click state and silently
        // undid the first. Browser automation hits this; a human rarely does.
        //
        // Started explicitly ON so the pass condition is a column that is THERE
        // rather than one that is merely still missing.
        setAccountDetail(true);
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        act(() => {
            detailToggle().click();
            detailToggle().click();
        });
        expect(headerLabels()).toContain('RRSP');
        expect(detailToggle()).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps the anchors leading and frozen whether detail is on or off', async () => {
        const user = userEvent.setup();
        // Starts ON — the widest table is the one most likely to disturb the frozen
        // region — and the two clicks below take it off and back on again.
        setAccountDetail(true);
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);

        const expectFrozen = () => {
            const heads = screen.getAllByRole('columnheader');
            const cells = within(bodyRows()[0]).getAllByRole('cell');
            expect(heads.slice(0, 3).map(h => h.textContent)).toEqual(SP_ANCHORS);
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
            expect(heads[3].className).not.toContain('sticky left-');
        };

        expectFrozen();
        await user.click(detailToggle());
        expectFrozen();
        await user.click(detailToggle());
        expectFrozen();
    });
});

describe('YearlyBreakdownTable — Net Pension column', () => {
    it('is absent when the household has no DB pension anywhere in the projection', () => {
        expect(SINGLE_RESULTS.every(r => r.netPensionIncome <= 1)).toBe(true);
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(headerLabels()).not.toContain(PENSION_COL);
        expect(screen.queryByRole('columnheader', { name: PENSION_COL })).toBeNull();
    });

    // The pension column sits among the income columns, well clear of the
    // per-account balances; the switch is pinned only so the expectation can name
    // the whole column set.
    it('appears, between Net OAS and Total Spend, when there is one', () => {
        expect(PENSION_SINGLE_RESULTS.some(r => r.netPensionIncome > 1)).toBe(true);
        setAccountDetail(false);
        render(<YearlyBreakdownTable data={PENSION_SINGLE_RESULTS} />);
        const labels = headerLabels();
        expect(labels).toEqual(expectedLabels({ detail: false, pension: true }));
        expect(labels.indexOf(PENSION_COL)).toBe(labels.indexOf('Net OAS') + 1);
    });

    it('appears when only the SPOUSE has the pension — the figure is a household one', () => {
        setAccountDetail(true);
        render(<YearlyBreakdownTable data={SPOUSE_PENSION_RESULTS} hasSpouse />);
        expect(headerLabels()).toEqual(expectedLabels({ spouse: true, detail: true, pension: true }));
    });

    it('renders the household figure, and a You/Spouse split on hover for a couple', async () => {
        const user = userEvent.setup();
        const idx = SPOUSE_PENSION_RESULTS.findIndex(r => r.netPensionIncome > 1);
        expect(idx).toBeGreaterThanOrEqual(0);
        const row = SPOUSE_PENSION_RESULTS[idx];

        render(<YearlyBreakdownTable data={SPOUSE_PENSION_RESULTS} hasSpouse />);
        const labels = headerLabels();
        const cell = within(bodyRows()[idx]).getAllByRole('cell')[labels.indexOf(PENSION_COL)];
        expect(cell.textContent).toBe(formatCurrencyCAD(row.netPensionIncome));

        await user.hover(within(cell).getByText(formatCurrencyCAD(row.netPensionIncome)));
        const tip = screen.getByRole('tooltip').textContent ?? '';
        expect(tip).toContain(`You: ${formatCurrencyCAD(row.personNetPension)}`);
        expect(tip).toContain(`Spouse: ${formatCurrencyCAD(row.spouseNetPension)}`);
    });

    it('uses the file\'s ">$1" materiality rule, so a token pension does not earn a column', () => {
        // A pension small enough that no year clears $1 net. The assertion on the
        // data comes first, so if the fixture ever became material this test fails
        // loudly rather than quietly checking nothing.
        const token = runSimulation(inputs({
            person: person({ pension: { annualAmount: 1, startAge: 65, indexedToInflation: false } }),
        }));
        expect(token.some(r => r.netPensionIncome > 0)).toBe(true);
        expect(token.every(r => r.netPensionIncome <= 1)).toBe(true);
        render(<YearlyBreakdownTable data={token} />);
        expect(headerLabels()).not.toContain(PENSION_COL);
    });

    it('is decided on nominal figures, so the today\'s-dollars toggle cannot change it', () => {
        for (const [data, want] of [[SINGLE_RESULTS, false], [PENSION_SINGLE_RESULTS, true]] as const) {
            for (const adjusted of [false, true]) {
                render(<YearlyBreakdownTable data={data} inflationAdjusted={adjusted} />);
                expect(headerLabels().includes(PENSION_COL)).toBe(want);
                cleanup();
            }
        }
    });

    it('does not disturb header/body alignment when it drops out', () => {
        for (const data of [SINGLE_RESULTS, PENSION_SINGLE_RESULTS]) {
            render(<YearlyBreakdownTable data={data} />);
            const headerCount = screen.getAllByRole('columnheader').length;
            for (const row of bodyRows()) {
                expect(within(row).getAllByRole('cell')).toHaveLength(headerCount);
            }
            cleanup();
        }
    });
});

describe('YearlyBreakdownTable — header and body stay aligned', () => {
    // The whole point of the single-source column list: header and body can never
    // drift. Cover both household sizes, both detail settings, with and without a
    // pension — i.e. every filter that can remove a column.
    const SETS = [
        { name: 'single', data: SINGLE_RESULTS, spouse: false, pension: false },
        { name: 'couple', data: COUPLE_RESULTS, spouse: true, pension: false },
        { name: 'single with pension', data: PENSION_SINGLE_RESULTS, spouse: false, pension: true },
        { name: 'couple with spouse pension', data: SPOUSE_PENSION_RESULTS, spouse: true, pension: true },
    ];

    for (const set of SETS) {
        for (const detail of [true, false]) {
            it(`${set.name}, account detail ${detail ? 'on' : 'off'}`, () => {
                setAccountDetail(detail);
                render(<YearlyBreakdownTable data={set.data} hasSpouse={set.spouse} />);

                const labels = headerLabels();
                expect(labels).toEqual(expectedLabels({ spouse: set.spouse, detail, pension: set.pension }));

                const rows = bodyRows();
                expect(rows.length).toBe(set.data.length);
                for (const row of rows) {
                    expect(within(row).getAllByRole('cell')).toHaveLength(labels.length);
                }

                // Anchors are unconditional and always lead.
                expect(labels.slice(0, set.spouse ? 3 : 2)).toEqual(set.spouse ? SP_ANCHORS : ANCHORS);
            });
        }
    }
});

describe('YearlyBreakdownTable — column detail', () => {
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

    it('the OAS Clawback header warns that it is inside Tax Paid, not on top of it', async () => {
        const user = userEvent.setup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        const th = screen.getByRole('columnheader', { name: 'OAS Clawback' });
        // A HelpTooltip like every other tooltip in the table, not a native `title`
        // (which needs a long hover on exactly the right text and never shows on touch).
        expect(th).not.toHaveAttribute('title');

        await user.hover(within(th).getByText('OAS Clawback'));
        const tip = screen.getByRole('tooltip').textContent ?? '';
        expect(tip).toMatch(/already included in tax paid/i);
        expect(tip).toMatch(/not added on top/i);
    });

    it('gives every column header a HelpTooltip rather than a native title', async () => {
        const user = userEvent.setup();
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        for (const th of screen.getAllByRole('columnheader')) {
            const label = th.textContent ?? '';
            expect(th, `"${label}" still carries a native title`).not.toHaveAttribute('title');
            await user.hover(within(th).getByText(label));
            expect(screen.getByRole('tooltip').textContent ?? '').not.toBe('');
            await user.unhover(within(th).getByText(label));
        }
    });

    it('Avg Tax Rate matches the "Effective rate" line in the Tax Paid tooltip', async () => {
        const user = userEvent.setup();
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

    it('Marginal Rate shows your figure, with the spouse\'s on hover', async () => {
        const user = userEvent.setup();
        const idx = COUPLE_RESULTS.findIndex(
            r => r.personMarginalRate !== undefined && r.spouseMarginalRate !== undefined
        );
        expect(idx).toBeGreaterThanOrEqual(0);
        const row = COUPLE_RESULTS[idx];
        const shown = formatPercent1(row.personMarginalRate!);

        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        const labels = headerLabels();
        const cell = within(bodyRows()[idx]).getAllByRole('cell')[labels.indexOf('Marginal Rate')];
        // The cell itself is the PRIMARY person's rate — the spouse's is on hover,
        // the same treatment Net CPP / Net OAS / Net Pension get.
        expect(cell.textContent).toBe(shown);

        await user.hover(within(cell).getByText(shown));
        const tip = screen.getByRole('tooltip').textContent ?? '';
        expect(tip).toContain(`You: ${shown}`);
        expect(tip).toContain(`Spouse: ${formatPercent1(row.spouseMarginalRate!)}`);
    });

    it('the Marginal Rate header states the $1,000 basis and what it includes', async () => {
        const user = userEvent.setup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        const th = screen.getByRole('columnheader', { name: 'Marginal Rate' });
        await user.hover(within(th).getByText('Marginal Rate'));
        const tip = screen.getByRole('tooltip').textContent ?? '';
        expect(tip).toContain('$1,000');
        expect(tip).toMatch(/RRSP\/RRIF withdrawal/);
        expect(tip).toMatch(/OAS clawback/i);
        // It must not read as a bracket lookup, and it must warn that other kinds
        // of income are taxed differently.
        expect(tip).toMatch(/not just the bracket/i);
        expect(tip).toMatch(/gains and dividends/i);
        // Kept to roughly the length of its neighbours — this table's headers were
        // deliberately cut back and this one must not undo that.
        expect(tip.length).toBeLessThanOrEqual(170);
    });

    it('shows a dash, not 0%, for a person who has died', () => {
        const dead = WIDOWED_SPOUSE_RESULTS.findIndex(r => r.personMarginalRate === undefined);
        expect(dead, 'fixture should outlive the primary person').toBeGreaterThan(0);
        // Genuinely absent rather than a zero the engine happened to compute
        expect(WIDOWED_SPOUSE_RESULTS[dead].personMarginalRate).not.toBe(0);

        render(<YearlyBreakdownTable data={WIDOWED_SPOUSE_RESULTS} hasSpouse />);
        const labels = headerLabels();
        const cell = within(bodyRows()[dead]).getAllByRole('cell')[labels.indexOf('Marginal Rate')];
        expect(cell.textContent).toBe('—');
        expect(cell.textContent).not.toContain('0.0%');
    });

    it('renders a dash rather than a rate when there is no taxable income', () => {
        // A pure-TFSA household never has taxable income, so the guard fires every year.
        const noTax = NO_ESTATE_TAX_RESULTS;
        render(<YearlyBreakdownTable data={noTax} />);
        expect(averageTaxRate(noTax[0])).toBeNull();
        expect(firstRowCell('Avg Tax Rate')).toBe('—');
        expect(firstRowCell('OAS Clawback')).toBe('—');
    });
});

describe('YearlyBreakdownTable — estate tax footer', () => {
    it('has no Estate Tax column — the figure is a footer total', () => {
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(headerLabels()).not.toContain('Estate Tax');
        expect(screen.queryByRole('columnheader', { name: 'Estate Tax' })).toBeNull();
    });

    it('totals the terminal tax, and names the year in the tooltip rather than the label', async () => {
        const user = userEvent.setup();
        const charged = terminalRows(SINGLE_RESULTS);
        expect(charged).toHaveLength(1);

        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        const foot = footerRow()!;
        expect(foot).not.toBeNull();
        const head = within(foot).getByRole('rowheader');
        // The label has to fit the frozen anchor region on one line, so it carries
        // no year at all — not even the single-year case.
        expect(head.textContent).toBe('Estate tax');
        expect(head.textContent).not.toMatch(/\d{4}/);
        expect(foot.textContent).toContain(formatCurrencyCAD(estateTotal(SINGLE_RESULTS)));

        // The year the reader lost from the label is in the tooltip instead.
        await user.hover(within(head).getByText('Estate tax'));
        expect(screen.getByRole('tooltip').textContent).toContain(String(charged[0].year));
    });

    it('for a couple, names the SECOND death — the first rolls over tax-free', async () => {
        const user = userEvent.setup();
        // The engine only assesses a deemed disposition when nobody survives, so the
        // first death produces a rollover and a zero, and the whole bill surfaces later.
        const firstDeath = COUPLE_RESULTS.findIndex(r => r.isDeathYear);
        expect(firstDeath).toBeGreaterThanOrEqual(0);
        expect(COUPLE_RESULTS[firstDeath].rrspRolledToSpouse!).toBeGreaterThan(0);
        expect(COUPLE_RESULTS[firstDeath].totalTerminalTax ?? 0).toBeCloseTo(0, 6);

        const charged = terminalRows(COUPLE_RESULTS);
        expect(charged).toHaveLength(1);
        expect(charged[0].year).toBeGreaterThan(COUPLE_RESULTS[firstDeath].year);

        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        const head = within(footerRow()!).getByRole('rowheader');
        expect(head.textContent).toBe('Estate tax');
        await user.hover(within(head).getByText('Estate tax'));
        expect(screen.getByRole('tooltip').textContent).toContain(String(charged[0].year));
    });

    it('is absent entirely when no year carries a material terminal tax', () => {
        expect(terminalRows(NO_ESTATE_TAX_RESULTS)).toHaveLength(0);
        render(<YearlyBreakdownTable data={NO_ESTATE_TAX_RESULTS} />);
        expect(footerRow()).toBeNull();
        expect(screen.queryByText(/Estate tax/)).toBeNull();
    });

    it('keeps the terminal-tax explanation, on the footer label', async () => {
        const user = userEvent.setup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        await user.hover(within(footerRow()!).getByText('Estate tax'));
        const tip = screen.getByRole('tooltip').textContent ?? '';
        expect(tip).toContain('deemed disposition of RRSP/RRIF');
        expect(tip).toContain('unrealized capital gains');
        expect(tip).toMatch(/already deducted from the account balances/i);
    });

    it('explains the spousal rollover only when there is a spouse', async () => {
        const user = userEvent.setup();
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        await user.hover(within(footerRow()!).getByText('Estate tax'));
        expect(screen.getByRole('tooltip').textContent).toMatch(/second death/);

        cleanup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        await user.hover(within(footerRow()!).getByText('Estate tax'));
        expect(screen.getByRole('tooltip').textContent).not.toMatch(/second death/);
    });

    it('follows the today\'s-dollars toggle, using the taxed row\'s inflationFactor', () => {
        const charged = terminalRows(SINGLE_RESULTS)[0];
        expect(charged.inflationFactor).toBeGreaterThan(1.2);

        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        const nominal = footerRow()!.textContent ?? '';
        expect(nominal).toContain(formatCurrencyCAD(charged.totalTerminalTax!));

        cleanup();
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} inflationAdjusted />);
        const adjusted = footerRow()!.textContent ?? '';
        expect(adjusted).toContain(formatCurrencyCAD(estateTotal(SINGLE_RESULTS, true)));
        expect(adjusted).not.toBe(nominal);
    });

    it('is decided on nominal figures, so the toggle cannot make it appear or vanish', () => {
        for (const [data, want] of [[SINGLE_RESULTS, true], [NO_ESTATE_TAX_RESULTS, false]] as const) {
            for (const adjusted of [false, true]) {
                render(<YearlyBreakdownTable data={data} inflationAdjusted={adjusted} />);
                expect(footerRow() !== null).toBe(want);
                cleanup();
            }
        }
    });

    // The whole point of deriving the index: the amount must track Tax Paid through
    // every filter that can add or remove a column ahead of it.
    const FOOTER_SETS = [
        { name: 'single', data: SINGLE_RESULTS, spouse: false },
        { name: 'couple', data: COUPLE_RESULTS, spouse: true },
        { name: 'single with pension', data: PENSION_SINGLE_RESULTS, spouse: false },
        { name: 'couple with spouse pension', data: SPOUSE_PENSION_RESULTS, spouse: true },
    ];

    for (const set of FOOTER_SETS) {
        for (const detail of [true, false]) {
            it(`puts the amount under Tax Paid — ${set.name}, account detail ${detail ? 'on' : 'off'}`, () => {
                setAccountDetail(detail);
                render(<YearlyBreakdownTable data={set.data} hasSpouse={set.spouse} />);

                const labels = headerLabels();
                const frozen = set.spouse ? 3 : 2;
                const taxPaidIdx = labels.indexOf('Tax Paid');
                // Tax Paid never sits inside the frozen anchor region, so the label's
                // span and the amount can never collide however the columns filter.
                expect(taxPaidIdx).toBeGreaterThanOrEqual(frozen);

                const foot = footerRow()!;
                // The label spans EXACTLY the frozen anchors, the amount sits in Tax
                // Paid's own column, and every other column gets an empty cell.
                const head = within(foot).getByRole('rowheader') as HTMLTableCellElement;
                expect(head).toHaveAttribute('colspan', String(frozen));
                expect(head.textContent).toBe('Estate tax');
                // Confined to the anchors, it can be frozen like every other cell
                // there: pinned, opaque against the cells scrolling under it, and
                // carrying the frozen region's edge rule.
                expect(head.className).toContain('sticky');
                expect(head.className).toContain('left-0');
                expect(head.className).toContain('bg-slate-50');
                expect(head.className).toContain('shadow-[1px_0_0_0_rgb(226_232_240)]');

                const cells = within(foot).getAllByRole('cell');
                expect(cells).toHaveLength(labels.length - frozen);

                // The amount is at Tax Paid's index, by construction rather than count.
                const amountCell = cells[taxPaidIdx - frozen];
                expect(amountCell).toHaveAttribute('data-column', 'taxPaid');
                expect(amountCell.textContent).toBe(formatCurrencyCAD(estateTotal(set.data)));
                // ...and nothing anywhere else in the row, before it or after it.
                for (const cell of cells) {
                    if (cell !== amountCell) expect(cell.textContent).toBe('');
                }

                // Total cells rendered must still span the table exactly.
                expect(head.colSpan + cells.length).toBe(labels.length);
            });
        }
    }

    it('scrolls with the table vertically, but freezes its label sideways', () => {
        setAccountDetail(true);
        render(<YearlyBreakdownTable data={COUPLE_RESULTS} hasSpouse />);
        const foot = footerRow()!;
        const head = within(foot).getByRole('rowheader');
        const cells = within(foot).getAllByRole('cell');

        for (const el of [head, ...cells]) {
            // Nothing pins the row to the bottom of the scroll box — it is an
            // ordinary last row vertically...
            expect(el.className).not.toContain('bottom-0');
            // ...which is what lets it carry an ordinary top border rather than the
            // shadow a sticky row would need.
            expect(el.className).toContain('border-t');
            expect(el.className).not.toContain('shadow-[0_-1px');
        }

        // Sideways the label is frozen exactly like the body's anchor cells: pinned
        // at left-0, opaque so the cells scrolling under it cannot show through,
        // layered above them, and carrying the frozen region's edge rule.
        expect(head.className).toContain('sticky');
        expect(head.className).toContain('left-0');
        expect(head.className).toContain('bg-slate-50');
        expect(head.className).toMatch(/\bz-10\b/);
        expect(head.className).toContain('shadow-[1px_0_0_0_rgb(226_232_240)]');
        // "Estate tax" fits the frozen region on one line — that is what pays for
        // the freeze, so the label must not be allowed to wrap.
        expect(head.className).toContain('whitespace-nowrap');

        // Everything to its right scrolls, or the freeze would be pointless.
        for (const cell of cells) {
            expect(cell.className).not.toContain('sticky');
            expect(cell.className).not.toContain('left-');
            expect(cell.className).not.toContain('shadow-[1px_0_0_0_rgb(226_232_240)]');
            expect(cell.className).not.toMatch(/\bz-\d/);
        }
    });

    it('is not counted as a data row', () => {
        render(<YearlyBreakdownTable data={SINGLE_RESULTS} />);
        expect(bodyRows()).toHaveLength(SINGLE_RESULTS.length);
        expect(footerRow()).not.toBeNull();
    });
});
