import { describe, it, expect } from 'vitest';
import { calculateEstimatedCPP, calculateOAS } from './cpp';

describe('calculateEstimatedCPP', () => {
    it('full career starting at 65 gets the 2025 maximum', () => {
        expect(calculateEstimatedCPP(40, 65)).toBeCloseTo(17_196, 2);
    });

    it('scales linearly with contribution years, capped at 40', () => {
        expect(calculateEstimatedCPP(20, 65)).toBeCloseTo(17_196 * 0.5, 2);
        expect(calculateEstimatedCPP(45, 65)).toBeCloseTo(17_196, 2);
        expect(calculateEstimatedCPP(0, 65)).toBe(0);
    });

    it('early start at 60 reduces by 36% (0.6%/month × 60)', () => {
        expect(calculateEstimatedCPP(40, 60)).toBeCloseTo(17_196 * 0.64, 2);
    });

    it('late start at 70 increases by 42% (0.7%/month × 60)', () => {
        expect(calculateEstimatedCPP(40, 70)).toBeCloseTo(17_196 * 1.42, 2);
    });

    it('indexes with inflation', () => {
        expect(calculateEstimatedCPP(40, 65, 1.5)).toBeCloseTo(17_196 * 1.5, 2);
    });
});

describe('calculateOAS', () => {
    it('pays nothing before the chosen start age', () => {
        expect(calculateOAS(64, 65)).toBe(0);
        expect(calculateOAS(69, 70)).toBe(0);
    });

    it('pays the 2025 base at 65', () => {
        expect(calculateOAS(65, 65)).toBeCloseTo(8_820, 2);
    });

    it('deferral to 70 adds 36% (0.6%/month × 60, capped)', () => {
        expect(calculateOAS(70, 70)).toBeCloseTo(8_820 * 1.36, 2);
        // Start ages past 70 cap at the 60-month bonus
        expect(calculateOAS(72, 72)).toBeCloseTo(8_820 * 1.36, 2);
    });

    it('age 75+ gets the 10% boost on top', () => {
        expect(calculateOAS(76, 65)).toBeCloseTo(8_820 * 1.10, 2);
        expect(calculateOAS(76, 70)).toBeCloseTo(8_820 * 1.36 * 1.10, 2);
    });
});
