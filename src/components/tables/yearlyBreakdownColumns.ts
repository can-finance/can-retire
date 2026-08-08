import type { SimulationResult } from '../../engine/types';

/*
 * Non-component half of YearlyBreakdownTable: the column-group vocabulary and
 * the shared derivations. It lives in its own module because a .tsx file that
 * exports anything besides components loses React Fast Refresh (and trips
 * react-refresh/only-export-components).
 */

// ---------------------------------------------------------------------------
// Column groups
// ---------------------------------------------------------------------------

export type ColumnGroup = 'balances' | 'income' | 'tax';

export const COLUMN_GROUPS: { id: ColumnGroup; label: string; hint: string }[] = [
    { id: 'balances', label: 'Balances', hint: 'Account balances, total assets, and RRSP/RRIF withdrawn' },
    { id: 'income', label: 'Income', hint: 'Net CPP, OAS and pension, total spending, surplus/shortfall' },
    { id: 'tax', label: 'Tax', hint: 'Taxable income, tax paid, OAS clawback, average rate, estate tax' },
];

export const COLUMN_GROUPS_STORAGE_KEY = 'yearly_table_column_groups_v1';

/*
 * Default: Balances + Income on, Tax off.
 *
 * Measured at a 1440px viewport: the table's scroll box is 1231px wide and the
 * 13-column table was 1328px, so it scrolled sideways by 97px — enough to hide a
 * whole column, and side-scrolling a wide grid is exactly what this audience
 * struggles with. Balances + Income is 10 data columns and now measures 1231px,
 * i.e. it fits the scroll box exactly with no horizontal scrolling at all, which
 * is the entire point of the grouping. Tax detail is one click away, and every
 * row also opens the Year Audit drawer, which shows the full tax picture line by
 * line. (A couple adds Sp Age and three spouse balance columns, so the couple's
 * default is 16 columns and does still scroll — switching Balances off fits it.)
 */
export const DEFAULT_COLUMN_GROUPS: ColumnGroup[] = ['balances', 'income'];

const VALID_GROUPS: string[] = COLUMN_GROUPS.map(g => g.id);

// localStorage is user-editable and survives across releases, so validate.
// An EMPTY array is a legitimate persisted choice (every group switched off),
// so only a non-array payload falls back to the default.
export function sanitizeColumnGroups(raw: unknown): ColumnGroup[] | null {
    if (!Array.isArray(raw)) return null;
    const clean = raw.filter((g): g is ColumnGroup => typeof g === 'string' && VALID_GROUPS.includes(g));
    return [...new Set(clean)];
}

// ---------------------------------------------------------------------------
// Shared derivations
// ---------------------------------------------------------------------------

/**
 * Average (effective) tax rate for a year: tax paid ÷ taxable income.
 *
 * ONE definition, used by both the "Avg Tax Rate" column and the "Effective
 * rate" line inside the Tax Paid tooltip, so the two can never disagree.
 * Returns null when the year has no taxable income or no tax — the same guard
 * the tooltip has always used — and callers render a dash for that.
 *
 * It is a ratio of two nominal dollar figures, so the inflation toggle divides
 * numerator and denominator by the same factor and leaves the rate unchanged.
 */
export function averageTaxRate(row: SimulationResult): number | null {
    if (!(row.grossIncome > 0) || !(row.taxPaid > 0)) return null;
    return row.taxPaid / row.grossIncome;
}

export function formatPercent1(v: number): string {
    return `${(v * 100).toFixed(1)}%`;
}

/** Surplus reinvested across all three account types this year. */
export function reinvestedTotal(row: SimulationResult): number {
    return row.reinvestedTFSA + row.reinvestedRRSP + row.reinvestedNonReg;
}
