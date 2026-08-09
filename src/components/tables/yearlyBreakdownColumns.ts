import type { SimulationResult } from '../../engine/types';

/*
 * Non-component half of YearlyBreakdownTable: the persisted display option and
 * the shared derivations. It lives in its own module because a .tsx file that
 * exports anything besides components loses React Fast Refresh (and trips
 * react-refresh/only-export-components).
 */

// ---------------------------------------------------------------------------
// Account detail
// ---------------------------------------------------------------------------

/*
 * Every column in this table is always shown, with one exception: the
 * per-account balances (RRSP / TFSA / Non-Reg, doubled for a couple). Those sit
 * behind a single switch, because they are the one block a reader can give up
 * without losing a fact — Total Assets summarises them, and RRSP Drawn (a FLOW,
 * not a balance) carries the insight none of them do. Switching the detail off
 * drops six columns for a couple, three for a single person.
 *
 * Which columns those are is a property of each column (`accountDetail` on
 * ColumnDef), not a key list kept next to the filter — the filter never has to
 * be revisited when a column is added.
 */
export const ACCOUNT_DETAIL_STORAGE_KEY = 'yearly_table_account_detail_v1';

/*
 * Default OFF. The table's problem is width, and the per-account columns are
 * the bulk of it: off drops three columns for a single person and six for a
 * couple, which is the difference between a first look that fits and one that
 * scrolls sideways. Total Assets still carries the balance story, and the
 * breakdown is one click away.
 *
 * This reaches anyone with no stored preference, not only brand-new visitors
 * — someone who has used the app but never touched the switch will see the
 * table lose those columns.
 */
export const DEFAULT_ACCOUNT_DETAIL = false;

// localStorage is user-editable; anything that isn't a boolean falls back.
export function sanitizeAccountDetail(raw: unknown): boolean | null {
    return typeof raw === 'boolean' ? raw : null;
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
