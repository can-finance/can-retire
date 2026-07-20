import type { SimulationInputs, SimulationResult, MonteCarloResult } from '../engine/types';
import type { SummaryMetrics } from './summaryMetrics';

export const MAX_COMPARANDS = 3;

export interface Comparand { id: string; name: string; inputs: SimulationInputs; }
export interface ComparisonRun {
    comparand: Comparand;
    color: string;
    results: SimulationResult[];
    metrics: SummaryMetrics;
    monteCarlo: MonteCarloResult | null; // null while still computing
}
export type BandMode = 'off' | 'p25p75' | 'p5p95';

// Index of the "best" value in a row, or null when it can't be meaningfully
// highlighted: fewer than two non-null values, or every value tied.
export function bestIndex(values: (number | null)[], dir: 'max' | 'min'): number | null {
    const present = values
        .map((v, i) => ({ v, i }))
        .filter((x): x is { v: number; i: number } => x.v !== null);
    if (present.length < 2) return null;
    const allEqual = present.every(x => x.v === present[0].v);
    if (allEqual) return null;
    let best = present[0];
    for (const x of present) {
        if (dir === 'max' ? x.v > best.v : x.v < best.v) best = x;
    }
    return best.i;
}

export interface ComparisonChartRow {
    year: number;
    det0?: number; det1?: number; det2?: number;          // deterministic totalAssets per slot
    band0?: [number, number]; band1?: [number, number]; band2?: [number, number];
    age0?: number; age1?: number; age2?: number;          // primary person's age per slot (tooltip)
}

// Rows are keyed dynamically (det0/band1/age2/...); a narrow index cast keeps the
// public interface strict while letting the builder write slot-suffixed keys.
type MutableRow = Record<string, number | [number, number] | undefined>;

export function buildComparisonChartData(
    runs: ComparisonRun[],
    bandMode: BandMode,
    isInflationAdjusted: boolean,
): ComparisonChartRow[] {
    const slots = runs.slice(0, MAX_COMPARANDS);
    const rowByYear = new Map<number, ComparisonChartRow>();

    const rowFor = (year: number): MutableRow => {
        let row = rowByYear.get(year);
        if (!row) {
            row = { year };
            rowByYear.set(year, row);
        }
        return row as unknown as MutableRow;
    };

    slots.forEach((run, i) => {
        // Each scenario carries its own inflation assumption — deflate strictly by
        // its own factors, never a shared/global one.
        const factorByYear = new Map<number, number>(run.results.map(r => [r.year, r.inflationFactor]));
        const deflate = (val: number, year: number): number =>
            isInflationAdjusted ? val / (factorByYear.get(year) ?? 1.0) : val;

        for (const r of run.results) {
            const row = rowFor(r.year);
            row[`det${i}`] = deflate(r.totalAssets, r.year);
            row[`age${i}`] = r.age;
        }

        if (bandMode !== 'off' && run.monteCarlo) {
            for (const p of run.monteCarlo.percentiles) {
                const low = bandMode === 'p5p95' ? p.p5 : p.p25;
                const high = bandMode === 'p5p95' ? p.p95 : p.p75;
                rowFor(p.year)[`band${i}`] = [deflate(low, p.year), deflate(high, p.year)];
            }
        }
    });

    return Array.from(rowByYear.values()).sort((a, b) => a.year - b.year);
}
