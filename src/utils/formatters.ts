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
 * Full CAD currency for tooltip rows: $1,234
 */
export const formatCurrencyCAD = (val: number): string =>
    new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
        maximumFractionDigits: 0,
    }).format(val);
