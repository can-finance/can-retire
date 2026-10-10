import { describe, it, expect } from 'vitest';
import { calculateEstimatedCPP, calculateOAS, cppOverrideAtStartAge } from './cpp';

describe('cppOverrideAtStartAge', () => {
    it('returns the estimate unchanged (bit-for-bit) at the age it was worked out for', () => {
        expect(cppOverrideAtStartAge(14_000, 65, 65)).toBe(14_000);
        expect(cppOverrideAtStartAge(14_000, 60, 60)).toBe(14_000);
        expect(cppOverrideAtStartAge(14_000, 70, 70)).toBe(14_000);
        expect(cppOverrideAtStartAge(12_345.67, 62, 62)).toBe(12_345.67);
    });

    it('treats a missing base age as the current start age (no adjustment)', () => {
        expect(cppOverrideAtStartAge(14_000, 60)).toBe(14_000);
        expect(cppOverrideAtStartAge(14_000, 70, undefined)).toBe(14_000);
    });

    it('re-bases an age-65 estimate: 36% less at 60, 42% more at 70', () => {
        expect(cppOverrideAtStartAge(10_000, 60, 65)).toBeCloseTo(6_400, 6);
        expect(cppOverrideAtStartAge(10_000, 62, 65)).toBeCloseTo(10_000 * (1 - 36 * 0.006), 6);
        expect(cppOverrideAtStartAge(10_000, 70, 65)).toBeCloseTo(14_200, 6);
    });

    it('re-bases between two non-65 ages through the age-65 amount', () => {
        // 14,200 at 70 is 10,000 at 65, which is 6,400 at 60 — and back again
        expect(cppOverrideAtStartAge(14_200, 60, 70)).toBeCloseTo(6_400, 6);
        expect(cppOverrideAtStartAge(6_400, 70, 60)).toBeCloseTo(14_200, 6);
        expect(cppOverrideAtStartAge(14_200, 65, 70)).toBeCloseTo(10_000, 6);
    });

    it('caps at 70 and floors at 60, like the CPP Calculator', () => {
        expect(cppOverrideAtStartAge(10_000, 72, 65)).toBeCloseTo(14_200, 6);
        expect(cppOverrideAtStartAge(14_200, 75, 70)).toBe(14_200);
        expect(cppOverrideAtStartAge(10_000, 58, 65)).toBeCloseTo(6_400, 6);
    });

    it('uses the same early/late rates as the simple estimate within 60–70', () => {
        for (let a = 60; a <= 70; a++) {
            expect(cppOverrideAtStartAge(18_092, a, 65)).toBeCloseTo(calculateEstimatedCPP(40, a), 6);
        }
    });
});

describe('calculateEstimatedCPP', () => {
    it('full career starting at 65 gets the 2026 maximum', () => {
        expect(calculateEstimatedCPP(40, 65)).toBeCloseTo(18_092, 2);
    });

    it('scales linearly with contribution years, capped at 40', () => {
        expect(calculateEstimatedCPP(20, 65)).toBeCloseTo(18_092 * 0.5, 2);
        expect(calculateEstimatedCPP(45, 65)).toBeCloseTo(18_092, 2);
        expect(calculateEstimatedCPP(0, 65)).toBe(0);
    });

    it('early start at 60 reduces by 36% (0.6%/month × 60)', () => {
        expect(calculateEstimatedCPP(40, 60)).toBeCloseTo(18_092 * 0.64, 2);
    });

    it('late start at 70 increases by 42% (0.7%/month × 60)', () => {
        expect(calculateEstimatedCPP(40, 70)).toBeCloseTo(18_092 * 1.42, 2);
    });

    it('indexes with inflation', () => {
        expect(calculateEstimatedCPP(40, 65, 1.5)).toBeCloseTo(18_092 * 1.5, 2);
    });
});

describe('calculateOAS', () => {
    it('pays nothing before the chosen start age', () => {
        expect(calculateOAS(64, 65)).toBe(0);
        expect(calculateOAS(69, 70)).toBe(0);
    });

    it('pays the 2026 base at 65', () => {
        expect(calculateOAS(65, 65)).toBeCloseTo(9_024, 2);
    });

    it('deferral to 70 adds 36% (0.6%/month × 60, capped)', () => {
        expect(calculateOAS(70, 70)).toBeCloseTo(9_024 * 1.36, 2);
        // Start ages past 70 cap at the 60-month bonus
        expect(calculateOAS(72, 72)).toBeCloseTo(9_024 * 1.36, 2);
    });

    it('age 75+ gets the 10% boost on top', () => {
        expect(calculateOAS(76, 65)).toBeCloseTo(9_024 * 1.10, 2);
        expect(calculateOAS(76, 70)).toBeCloseTo(9_024 * 1.36 * 1.10, 2);
    });
});
