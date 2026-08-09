/*
 * Evenly spaced x-axis ticks.
 *
 * Left to itself, Recharts fits as many tick labels as it can and drops the
 * rest, which produces runs like "55 56 57 58 60 61 62 64 66 68 70 71 72" —
 * the gaps vary, so the axis reads as though the data were unevenly sampled
 * when it is one row per year throughout. Choosing the ticks ourselves keeps
 * the spacing uniform and lands them on round numbers, which is easier to scan
 * and much easier for a reader who is working to read the axis at all.
 *
 * Pass the result to `<XAxis ticks={…} interval={0} />`. `interval={0}` matters:
 * without it Recharts still applies its own thinning on top and the gaps come
 * back at narrow widths.
 */

// Steps that read as round numbers on an age or year axis. 3 is deliberately
// absent — "51, 54, 57" is uniform but not what anyone counts in.
const NICE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/**
 * Ticks at a uniform, round interval spanning `values`.
 *
 * @param values   The axis values, in any order (ages or calendar years).
 * @param maxTicks Upper bound on how many labels to emit. Lower it for wider
 *                 labels — four-digit years need roughly twice the room two-digit
 *                 ages do.
 */
export function evenTicks(values: number[], maxTicks = 10): number[] {
    if (values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [min];

    // The smallest round step that keeps the count within budget. `maxTicks - 1`
    // because N labels span N-1 gaps. The fallback covers spans wider than the
    // largest nice step, so the loop below always terminates.
    const raw = (max - min) / Math.max(1, maxTicks - 1);
    const step = NICE_STEPS.find(s => s >= raw) ?? Math.ceil(raw / 100) * 100;

    // Start on a multiple of the step rather than on `min`, so the labels are
    // round (50, 55, 60…) instead of offset by wherever the plan happens to
    // begin (48, 53, 58…). The first data point simply goes unlabelled.
    const ticks: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
    return ticks;
}
