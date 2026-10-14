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
 * A Monte Carlo success rate (0–100) as a whole percent, rounded DOWN so a rate
 * that misses a target is never shown at or above it: 84.6% against an 85%
 * target reads "84%", not "85%" next to a ✗. Every pass/fail mark compares the
 * unrounded rate (rate >= target), and a passing rate floors to at least the
 * target, so the number and the mark always agree. The tiny allowance absorbs
 * float noise from successes / iterations × 100 (29 / 100 × 100 is
 * 28.999…), so an exact rate isn't shown a point low. Pass `target` wherever a
 * mark sits next to the number: it caps a missing rate below the target even
 * inside that allowance. null shows a dash.
 *
 * Use this for every success rate on screen, so the same plan never reads 93%
 * in one place and 94% (or 93.5%) in another.
 */
export const formatSuccessRate = (rate: number | null, target?: number): string => {
    if (rate === null || !Number.isFinite(rate)) return '—';
    let shown = wholeSuccessRate(rate);
    if (target !== undefined && rate < target && shown >= target) shown = Math.ceil(target) - 1;
    return `${Math.max(0, shown)}%`;
};

/**
 * The whole number formatSuccessRate shows (without a target). Compare or
 * subtract these, not the raw rates, wherever the result sits beside the
 * displayed numbers — a "+7 pts" delta or a best-of highlight then always
 * matches what the reader sees.
 */
export const wholeSuccessRate = (rate: number): number => Math.max(0, Math.floor(rate + 1e-9));

/**
 * Full CAD currency for tooltip rows: $1,234
 */
export const formatCurrencyCAD = (val: number): string =>
    new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
        maximumFractionDigits: 0,
    }).format(val);
