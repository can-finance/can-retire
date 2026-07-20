import { describe, it, expect } from 'vitest';
import { buildComparisonChartData, bestIndex, MAX_COMPARANDS } from './comparison';
import type { ComparisonRun } from './comparison';
import type { SimulationResult, MonteCarloPercentile, MonteCarloResult } from '../engine/types';
import type { SummaryMetrics } from './summaryMetrics';

// Minimal SimulationResult row — the builder only reads year/age/totalAssets/inflationFactor.
const row = (year: number, age: number, totalAssets: number, inflationFactor: number): SimulationResult =>
    ({ year, age, totalAssets, inflationFactor } as SimulationResult);

// Minimal percentile row — the builder only reads year + p5/p25/p75/p95.
const pct = (year: number, p5: number, p25: number, p75: number, p95: number): MonteCarloPercentile =>
    ({ year, p5, p25, p75, p95 } as MonteCarloPercentile);

const mc = (percentiles: MonteCarloPercentile[]): MonteCarloResult =>
    ({ percentiles } as MonteCarloResult);

const makeRun = (
    id: string,
    results: SimulationResult[],
    monteCarlo: MonteCarloResult | null = null,
): ComparisonRun => ({
    comparand: { id, name: id, inputs: {} as ComparisonRun['comparand']['inputs'] },
    color: '#000',
    results,
    metrics: {} as SummaryMetrics,
    monteCarlo,
});

describe('buildComparisonChartData', () => {
    it('produces a sorted union year axis and omits slot keys for uncovered years', () => {
        const runA = makeRun('A', [
            row(2030, 60, 100, 1.0),
            row(2031, 61, 110, 1.0),
            row(2032, 62, 120, 1.0),
        ]);
        const runB = makeRun('B', [
            row(2030, 60, 200, 1.0),
            row(2031, 61, 210, 1.0),
            row(2032, 62, 220, 1.0),
            row(2033, 63, 230, 1.0),
            row(2034, 64, 240, 1.0),
        ]);

        const data = buildComparisonChartData([runA, runB], 'off', false);

        expect(data.map(r => r.year)).toEqual([2030, 2031, 2032, 2033, 2034]);

        // Run A does not cover 2033/2034 — those rows must not carry a det0 key at all.
        const y2033 = data.find(r => r.year === 2033)!;
        const y2034 = data.find(r => r.year === 2034)!;
        expect('det0' in y2033).toBe(false);
        expect('det0' in y2034).toBe(false);
        expect(y2033.det0).toBeUndefined();
        // Run B still covers them.
        expect(y2033.det1).toBe(230);
        expect(y2034.det1).toBe(240);
    });

    it('deflates each plan by its own inflation factors when inflation-adjusted', () => {
        const runA = makeRun('A', [row(2030, 60, 100, 2.0)]);
        const runB = makeRun('B', [row(2030, 60, 100, 4.0)]);

        const real = buildComparisonChartData([runA, runB], 'off', true);
        expect(real[0].det0).toBe(50);  // 100 / 2.0
        expect(real[0].det1).toBe(25);  // 100 / 4.0 — its OWN factor, not shared

        const nominal = buildComparisonChartData([runA, runB], 'off', false);
        expect(nominal[0].det0).toBe(100);
        expect(nominal[0].det1).toBe(100);
    });

    it("picks [p25, p75] for 'p25p75' mode in low-high tuple order", () => {
        const run = makeRun('A', [row(2030, 60, 100, 1.0)], mc([pct(2030, 10, 25, 75, 95)]));
        const data = buildComparisonChartData([run], 'p25p75', false);
        expect(data[0].band0).toEqual([25, 75]);
    });

    it("picks [p5, p95] for 'p5p95' mode", () => {
        const run = makeRun('A', [row(2030, 60, 100, 1.0)], mc([pct(2030, 10, 25, 75, 95)]));
        const data = buildComparisonChartData([run], 'p5p95', false);
        expect(data[0].band0).toEqual([10, 95]);
    });

    it("emits no band keys for 'off' mode", () => {
        const run = makeRun('A', [row(2030, 60, 100, 1.0)], mc([pct(2030, 10, 25, 75, 95)]));
        const data = buildComparisonChartData([run], 'off', false);
        expect('band0' in data[0]).toBe(false);
        expect(data[0].band0).toBeUndefined();
    });

    it('emits no band keys when monteCarlo is null even with a band mode on', () => {
        const run = makeRun('A', [row(2030, 60, 100, 1.0)], null);
        const data = buildComparisonChartData([run], 'p25p75', false);
        expect('band0' in data[0]).toBe(false);
    });

    it('deflates band bounds by the same per-plan factor', () => {
        const run = makeRun('A', [row(2030, 60, 100, 2.0)], mc([pct(2030, 100, 200, 600, 900)]));
        const data = buildComparisonChartData([run], 'p25p75', true);
        expect(data[0].band0).toEqual([100, 300]); // [200/2, 600/2]
    });

    it('emits only the first MAX_COMPARANDS slots', () => {
        const runs = ['A', 'B', 'C', 'D'].map(id => makeRun(id, [row(2030, 60, 100, 1.0)]));
        const data = buildComparisonChartData(runs, 'off', false);
        const r = data[0];
        expect(r.det0).toBe(100);
        expect(r.det1).toBe(100);
        expect(r.det2).toBe(100);
        expect(MAX_COMPARANDS).toBe(3);
        // The 4th run is dropped — no det3 key ever exists.
        expect('det3' in r).toBe(false);
    });

    it('carries the primary age per slot for the tooltip', () => {
        const runA = makeRun('A', [row(2030, 60, 100, 1.0)]);
        const runB = makeRun('B', [row(2030, 58, 200, 1.0)]);
        const data = buildComparisonChartData([runA, runB], 'off', false);
        expect(data[0].age0).toBe(60);
        expect(data[0].age1).toBe(58);
    });
});

describe('bestIndex', () => {
    it('returns the index of the max for dir "max"', () => {
        expect(bestIndex([10, 30, 20], 'max')).toBe(1);
    });

    it('returns the index of the min for dir "min"', () => {
        expect(bestIndex([10, 30, 5], 'min')).toBe(2);
    });

    it('ignores nulls when finding the best', () => {
        expect(bestIndex([null, 30, 10], 'max')).toBe(1);
        expect(bestIndex([50, null, 20], 'min')).toBe(2);
    });

    it('returns null when fewer than two non-null values', () => {
        expect(bestIndex([null, 42, null], 'max')).toBeNull();
        expect(bestIndex([], 'max')).toBeNull();
        expect(bestIndex([null, null], 'min')).toBeNull();
    });

    it('returns null when every non-null value is tied', () => {
        expect(bestIndex([7, 7, 7], 'max')).toBeNull();
        expect(bestIndex([7, null, 7], 'min')).toBeNull();
    });

    it('returns the first index on a max/min tie among distinct values', () => {
        // Two values share the winning magnitude — the first wins.
        expect(bestIndex([30, 30, 10], 'max')).toBe(0);
    });
});
