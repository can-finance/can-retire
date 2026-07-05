import { describe, it, expect } from 'vitest';
import {
    calculateDetailedCPP,
    calculateAtAllStartAges,
    generateEarningsFromSimple,
    parseStatementEarnings,
    maxAnnualBenefitAt65,
    startAgeAdjustment,
    ympeFor,
    YMPE_BY_YEAR,
    LATEST_DATA_YEAR,
} from './cppDetailed';

// Person born 1961: turns 18 in 1979, turns 65 in 2026.
const BIRTH_YEAR = 1961;

/** Earnings at that year's YMPE for every year in [fromYear, toYear]. */
function maxEarnings(fromYear: number, toYear: number): Record<number, number> {
    const out: Record<number, number> = {};
    for (let y = fromYear; y <= toYear; y++) out[y] = ympeFor(y);
    return out;
}

describe('maxAnnualBenefitAt65', () => {
    it('is 25% of the five-year average YMPE', () => {
        const avg = (YMPE_BY_YEAR[2022] + YMPE_BY_YEAR[2023] + YMPE_BY_YEAR[2024] + YMPE_BY_YEAR[2025] + YMPE_BY_YEAR[2026]) / 5;
        expect(maxAnnualBenefitAt65()).toBeCloseTo(0.25 * avg, 5);
    });
});

describe('startAgeAdjustment', () => {
    it('reduces 36% at 60 and adds 42% at 70', () => {
        expect(startAgeAdjustment(60)).toBeCloseTo(0.64, 10);
        expect(startAgeAdjustment(65)).toBe(1);
        expect(startAgeAdjustment(70)).toBeCloseTo(1.42, 10);
    });
});

describe('calculateDetailedCPP', () => {
    it('a full max-earnings career starting at 65 gets the maximum', () => {
        const r = calculateDetailedCPP({
            birthYear: BIRTH_YEAR,
            startAge: 65,
            earningsByYear: maxEarnings(1979, 2025),
        });
        expect(r.contributoryYears).toBe(47);
        expect(r.averageRatio).toBeCloseTo(1, 5);
        expect(r.annualBenefit).toBeCloseTo(maxAnnualBenefitAt65(), 2);
    });

    it('40 max years out of 47 still earns the full pension (drop-out absorbs the gaps)', () => {
        // 7 zero years (1979-1985), max from 1986 on: general drop-out is
        // 47 × 17% = 7.99 years, so the zeros are dropped almost entirely.
        const r = calculateDetailedCPP({
            birthYear: BIRTH_YEAR,
            startAge: 65,
            earningsByYear: maxEarnings(1986, 2025),
        });
        expect(r.generalDropoutYears).toBeCloseTo(47 * 0.17, 5);
        expect(r.averageRatio).toBeGreaterThan(0.999);
    });

    it('half-of-YMPE earnings produce roughly half the max', () => {
        const earnings: Record<number, number> = {};
        for (let y = 1979; y <= 2025; y++) earnings[y] = ympeFor(y) / 2;
        const r = calculateDetailedCPP({ birthYear: BIRTH_YEAR, startAge: 65, earningsByYear: earnings });
        expect(r.averageRatio).toBeCloseTo(0.5, 5);
    });

    it('earnings above YMPE are capped at a ratio of 1', () => {
        const earnings: Record<number, number> = {};
        for (let y = 1979; y <= 2025; y++) earnings[y] = 1_000_000;
        const r = calculateDetailedCPP({ birthYear: BIRTH_YEAR, startAge: 65, earningsByYear: earnings });
        expect(r.averageRatio).toBeCloseTo(1, 5);
    });

    it('starting at 60 applies the 36% reduction and shortens the period', () => {
        const r = calculateDetailedCPP({
            birthYear: BIRTH_YEAR + 5, // 60 in 2026
            startAge: 60,
            earningsByYear: maxEarnings(1984, 2025),
        });
        expect(r.contributoryYears).toBe(42); // 18 → 60
        expect(r.adjustmentFactor).toBeCloseTo(0.64, 10);
        expect(r.annualBenefit).toBeCloseTo(maxAnnualBenefitAt65() * 0.64, 2);
    });

    it('delaying to 70 with zero earnings after 65 never dilutes the average', () => {
        const at65 = calculateDetailedCPP({
            birthYear: BIRTH_YEAR, startAge: 65, earningsByYear: maxEarnings(1979, 2025),
        });
        const at70 = calculateDetailedCPP({
            birthYear: BIRTH_YEAR, startAge: 70, earningsByYear: maxEarnings(1979, 2025),
        });
        expect(at70.averageRatio).toBeCloseTo(at65.averageRatio, 5);
        expect(at70.annualBenefit).toBeCloseTo(at65.annualBenefit * 1.42, 2);
    });

    it('working past 65 replaces low years (post-65 substitution)', () => {
        // Low earnings early on; max earnings 65-69 substitute in.
        const earnings = maxEarnings(1990, 2030);
        const withSub = calculateDetailedCPP({ birthYear: BIRTH_YEAR, startAge: 70, earningsByYear: earnings });
        const without = calculateDetailedCPP({
            birthYear: BIRTH_YEAR, startAge: 70,
            earningsByYear: maxEarnings(1990, 2025), // stops at 65
        });
        expect(withSub.averageRatio).toBeGreaterThan(without.averageRatio);
    });

    it('child-rearing years with low earnings are excluded', () => {
        const earnings = maxEarnings(1979, 2025);
        // Zero-earning child-rearing gap wider than the general drop-out can absorb
        const gapYears = [];
        for (let y = 1990; y <= 1999; y++) { delete earnings[y]; gapYears.push(y); }

        const withoutCRDO = calculateDetailedCPP({ birthYear: BIRTH_YEAR, startAge: 65, earningsByYear: earnings });
        const withCRDO = calculateDetailedCPP({
            birthYear: BIRTH_YEAR, startAge: 65, earningsByYear: earnings, childRearingYears: gapYears,
        });

        expect(withoutCRDO.averageRatio).toBeLessThan(1);
        expect(withCRDO.childRearingDropped).toEqual(gapYears);
        expect(withCRDO.averageRatio).toBeCloseTo(1, 5);
    });

    it('child-rearing years with high earnings are NOT excluded', () => {
        const r = calculateDetailedCPP({
            birthYear: BIRTH_YEAR, startAge: 65,
            earningsByYear: maxEarnings(1979, 2025),
            childRearingYears: [1990, 1991, 1992],
        });
        expect(r.childRearingDropped).toEqual([]);
    });

    it('contributory period never starts before 1966', () => {
        const r = calculateDetailedCPP({
            birthYear: 1945, // turned 18 in 1963
            startAge: 65,
            earningsByYear: maxEarnings(1966, 2009),
        });
        expect(r.contributoryYears).toBe(44); // 1966 → 2009 (65 in 2010)
    });

    it('no earnings means no benefit', () => {
        const r = calculateDetailedCPP({ birthYear: BIRTH_YEAR, startAge: 65, earningsByYear: {} });
        expect(r.annualBenefit).toBe(0);
    });
});

describe('calculateAtAllStartAges', () => {
    it('returns 11 entries from 60 to 70, monotonically increasing for a max career', () => {
        const all = calculateAtAllStartAges({
            birthYear: BIRTH_YEAR,
            earningsByYear: maxEarnings(1979, 2030),
        });
        expect(all).toHaveLength(11);
        expect(all[0].startAge).toBe(60);
        expect(all[10].startAge).toBe(70);
        for (let i = 1; i < all.length; i++) {
            expect(all[i].annualBenefit).toBeGreaterThan(all[i - 1].annualBenefit);
        }
    });
});

describe('generateEarningsFromSimple', () => {
    it('converts a today\'s-dollar salary into constant-ratio nominal earnings', () => {
        const half = ympeFor(LATEST_DATA_YEAR) / 2;
        const table = generateEarningsFromSimple({
            birthYear: 1970, workStartAge: 25, workEndAge: 30, avgSalaryTodayDollars: half,
        });
        expect(Object.keys(table)).toHaveLength(6); // ages 25-30 inclusive
        expect(table[1995]).toBe(Math.round(ympeFor(1995) / 2));
    });

    it('caps the ratio at 1 for salaries above the YMPE', () => {
        const table = generateEarningsFromSimple({
            birthYear: 1970, workStartAge: 25, workEndAge: 25, avgSalaryTodayDollars: 500_000,
        });
        expect(table[1995]).toBe(ympeFor(1995));
    });
});

describe('parseStatementEarnings', () => {
    it('parses year + dollar amount lines', () => {
        const text = '2004\t$39,000.00\t$1,700\n2005  41100  1800\nnot a data line';
        expect(parseStatementEarnings(text)).toEqual({ 2004: 39000, 2005: 41100 });
    });

    it('parses the full Statement of Contributions table (contributions before earnings)', () => {
        const text = [
            'Year\tYour contributions\tYour pensionable earnings',
            'Base portion\tFirst additional portion\tSecond additional portion\tTotal\tBase portion\tFirst additional portion\tSecond additional portion',
            '1993\t$0.00\t\t\t\t\t\t$0.00\t$0.00\t\t\t\t\t',
            '1994\t$32.71\t\t\t\t\t\t$32.71\t$4,657.00\t\t\t\t\t',
            '2002\t$1,673.20\t\t\t\t\t\t$1,673.20\t$39,100.00\t M\t\t\t\t',
            '2010\t$0.00\t\t\t\t\t\t$0.00\t$0.00\t\t\t\t\t',
            '2019\t$2,668.05\t\t$80.85\t\t\t\t$2,748.90\t$57,400.00\t M\t$57,400.00\t M\t\t',
            '2024\t$3,217.50\t\t$650.00\t\t$188.00\t\t$4,055.50\t$68,500.00\t M\t$68,500.00\t M\t$4,700.00\t M',
            '2025\t$3,356.10\t\t$678.00\t\t$396.00\t\t$4,430.10\t$71,300.00\t M\t$71,300.00\t M\t$9,900.00\t M',
        ].join('\n');
        expect(parseStatementEarnings(text)).toEqual({
            1993: 0,
            1994: 4657,      // earnings, not the $32.71 contribution
            2002: 39100,
            2010: 0,
            2019: 57400,     // base portion, not the total contribution
            2024: 68500,     // base portion, not the $4,700 second-additional earnings
            2025: 71300,
        });
    });

    it('maps the Statement "M" (maximum) marker to that year\'s YMPE', () => {
        expect(parseStatementEarnings('2010 M')).toEqual({ 2010: ympeFor(2010) });
    });

    it('ignores years outside the plausible CPP range', () => {
        expect(parseStatementEarnings('1950 $5,000')).toEqual({});
    });
});
