// Shared currency formatters used across chart components and summary cards.

/**
 * Short form for axis ticks and tooltips: $1.2M, $450k, $99
 * Handles negative values correctly for SpendingChart.
 */
export const formatCurrencyShort = (val: number): string => {
    const abs = Math.abs(val);
    if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${(val / 1_000).toFixed(0)}k`;
    return `$${val}`;
};

/**
 * A Monte Carlo answer, rounded to what it can honestly claim and written
 * short: $1.23M, $850k, $45k. Separate runs move a solved amount by a few
 * percent, so it rounds to the nearest $10,000 from $100k up and the nearest
 * $1,000 below. Rounds the size, so a negative mirrors its positive.
 */
export const roundCurrencyApprox = (val: number): number => {
    const abs = Math.abs(val);
    const step = abs >= 100_000 ? 10_000 : 1_000;
    const rounded = Math.round(abs / step) * step;
    return val < 0 ? -rounded : rounded;
};

export const formatCurrencyApprox = (val: number): string => {
    const r = roundCurrencyApprox(val);
    const abs = Math.abs(r);
    const sign = r < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${sign}$${Number((abs / 1_000_000).toFixed(2))}M`;
    if (abs >= 1_000) return `${sign}$${abs / 1_000}k`;
    return '$0';
};

/**
 * Full CAD currency for tooltip rows: $1,234
 */
export const formatCurrencyCAD = (val: number): string =>
    new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
        maximumFractionDigits: 0,
    }).format(val);
