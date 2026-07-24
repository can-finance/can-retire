import { describe, it, expect } from 'vitest';
import { calculateIncomeTax, calculateOASClawback, calculateOptimalSplit, TAX_CONSTANTS } from './tax';
import type { SplitPerson } from './tax';

describe('calculateIncomeTax — golden values (2025, no age/pension/dividend credits)', () => {
    it('ON, $50,000: matches hand calculation', () => {
        // Federal: 50,000 × 14.5%                     =  7,250.00
        // Fed BPA credit: 16,129 × 15%                = -2,419.35
        // ON: 50,000 × 5.05%                          =  2,525.00
        // ON BPA credit: 12,747 × 5.05%               =   -643.72
        // ON surtax: basic prov tax 1,881.28 < 5,710  =       0
        // OHP: 48,001–72,000 band                     =    600.00
        // Total                                       =  7,311.93
        expect(calculateIncomeTax(50_000, 'ON')).toBeCloseTo(7_311.93, 1);
    });

    it('AB, $100,000: matches hand calculation', () => {
        // Federal: 57,375 × 14.5% + 42,625 × 20.5%    = 17,057.50
        // Fed BPA credit: 16,129 × 15%                = -2,419.35
        // AB: 60,000 × 8% + 40,000 × 10%              =  8,800.00
        // AB BPA credit: 22,323 × 8%                  = -1,785.84
        // Total                                       = 21,652.31
        expect(calculateIncomeTax(100_000, 'AB')).toBeCloseTo(21_652.31, 1);
    });

    it('income below the basic personal amount owes zero tax', () => {
        expect(calculateIncomeTax(12_000, 'ON')).toBe(0);
        expect(calculateIncomeTax(0, 'ON')).toBe(0);
    });

    it('Ontario Health Premium steps up by $300 crossing the $20,000 band edge', () => {
        const below = calculateIncomeTax(20_000, 'ON');
        const above = calculateIncomeTax(20_001, 'ON');
        // $1 of income at ~19.55% marginal plus the $300 OHP jump
        expect(above - below).toBeGreaterThan(299);
        expect(above - below).toBeLessThan(302);
    });

    it('Ontario surtax kicks in at high income', () => {
        // At $200k, ON basic tax far exceeds both surtax thresholds, so the marginal
        // rate in the 200-210k band is fed 29% + ON 12.16% × 1.56 (both surtax tiers).
        const at200k = calculateIncomeTax(200_000, 'ON');
        const at210k = calculateIncomeTax(210_000, 'ON');
        const marginal = (at210k - at200k) / 10_000;
        expect(marginal).toBeGreaterThan(0.29 + 0.1216 * 1.56);
        expect(marginal).toBeLessThan(0.55);
    });

    it('unknown province falls back to Ontario brackets (minus ON-only levies)', () => {
        // 'XX' uses ON brackets and BPA but skips the OHP/surtax, which only apply
        // when province === 'ON'. At $80k (no surtax range) the gap is exactly the $750 OHP.
        const diff = calculateIncomeTax(80_000, 'ON') - calculateIncomeTax(80_000, 'XX');
        expect(diff).toBeCloseTo(750, 5);
    });

    it('inflation indexing scales brackets and credits proportionally', () => {
        // Doubling all thresholds/credits with doubled income doubles the tax,
        // except the OHP (deliberately not indexed) and ON surtax interplay — use AB.
        const base = calculateIncomeTax(80_000, 'AB', 1.0);
        const indexed = calculateIncomeTax(160_000, 'AB', 2.0);
        expect(indexed).toBeCloseTo(base * 2, 0);
    });

    it('age amount reduces tax for 65+ at moderate income', () => {
        const under65 = calculateIncomeTax(40_000, 'ON', 1.0, undefined, 64);
        const over65 = calculateIncomeTax(40_000, 'ON', 1.0, undefined, 65);
        // Below the $45,522 threshold: full claim 9,028 × (15% + 5%) = 1,805.60
        expect(under65 - over65).toBeCloseTo(9_028 * 0.20, 0);
    });

    it('pension income credit caps at $2,000 of eligible income', () => {
        const noPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 66, 0);
        const smallPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 66, 1_000);
        const bigPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 66, 50_000);
        expect(noPension - smallPension).toBeCloseTo(1_000 * 0.20, 1);
        expect(noPension - bigPension).toBeCloseTo(2_000 * 0.20, 1);
    });

    it('applies the pension credit under 65 (caller is responsible for age-qualifying)', () => {
        // The internal age gate was removed: DB lifetime-pension income qualifies at any
        // age, so a caller passing eligible pension income for a 60-year-old gets the credit.
        const noPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 60, 0);
        const withPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 60, 2_000);
        expect(noPension - withPension).toBeCloseTo(2_000 * 0.20, 1);
    });
});

describe('calculateOASClawback', () => {
    it('is zero at or below the threshold', () => {
        expect(calculateOASClawback(TAX_CONSTANTS.oas.clawbackThreshold, 8_820)).toBe(0);
        expect(calculateOASClawback(50_000, 8_820)).toBe(0);
    });

    it('recovers 15% of income above the threshold', () => {
        // 100,000 − 93,454 = 6,546 × 15% = 981.90
        expect(calculateOASClawback(100_000, 8_820)).toBeCloseTo(981.90, 2);
    });

    it('is capped at the OAS actually received', () => {
        expect(calculateOASClawback(500_000, 8_820)).toBe(8_820);
    });

    it('threshold indexes with inflation', () => {
        // At factor 2.0 the threshold doubles, so 100k income is below it
        expect(calculateOASClawback(100_000, 8_820, 2.0)).toBe(0);
    });
});

describe('calculateOptimalSplit', () => {
    // db = DB lifetime pension (splittable/creditable at any age),
    // rrif = RRIF income (splittable/creditable only at 65+)
    const splitP = (
        taxableIncome: number,
        { db = 0, rrif = 0 }: { db?: number; rrif?: number } = {},
        age = 66
    ): SplitPerson => ({
        taxableIncome, dbPensionIncome: db, rrifIncome: rrif, oasIncome: 0, grossedUpDividends: 0, age
    });

    it('splits from the high-income spouse and saves tax', () => {
        const result = calculateOptimalSplit(splitP(120_000, { rrif: 100_000 }), splitP(10_000), 'ON', 1.0);
        expect(result.fromPerson).toBe(1);
        expect(result.taxSavings).toBeGreaterThan(0);
        expect(result.splitAmount).toBeGreaterThan(0);
        expect(result.splitAmount).toBeLessThanOrEqual(50_000 + 1); // max 50% of eligible income
    });

    it('does not split RRIF-only income when the transferor is under 65', () => {
        const result = calculateOptimalSplit(splitP(120_000, { rrif: 100_000 }, 64), splitP(10_000), 'ON', 1.0);
        expect(result.splitAmount).toBe(0);
        expect(result.taxSavings).toBe(0);
    });

    it('a sub-65 transferor CAN split DB pension income (the main feature win)', () => {
        const result = calculateOptimalSplit(splitP(120_000, { db: 60_000 }, 58), splitP(10_000, {}, 58), 'ON', 1.0);
        expect(result.fromPerson).toBe(1);
        expect(result.splitAmount).toBeGreaterThan(0);
        expect(result.taxSavings).toBeGreaterThan(0);
        expect(result.splitAmount).toBeLessThanOrEqual(30_000 + 1); // max 50% of DB pension
    });

    it('a sub-65 transferor with only RRIF income still cannot split', () => {
        const result = calculateOptimalSplit(splitP(120_000, { rrif: 60_000 }, 58), splitP(10_000, {}, 58), 'ON', 1.0);
        expect(result.splitAmount).toBe(0);
        expect(result.taxSavings).toBe(0);
    });

    it('under-65 recipient gets the pension credit on split DB income but not on split RRIF income', () => {
        // Same household shape either way; only the transferor's income TYPE differs.
        // DB stays creditable in the 60-year-old recipient's hands → extra ~$400 saved;
        // RRIF does not qualify under 65, so that saving is absent.
        const dbCase = calculateOptimalSplit(splitP(120_000, { db: 60_000 }, 66), splitP(10_000, {}, 60), 'ON', 1.0);
        const rrifCase = calculateOptimalSplit(splitP(120_000, { rrif: 60_000 }, 66), splitP(10_000, {}, 60), 'ON', 1.0);
        expect(dbCase.splitAmount).toBeGreaterThan(0);
        expect(rrifCase.splitAmount).toBeGreaterThan(0);
        expect(dbCase.taxSavings).toBeGreaterThan(rrifCase.taxSavings);
    });

    it('never reports savings when incomes are already equal', () => {
        const result = calculateOptimalSplit(splitP(60_000, { rrif: 30_000 }), splitP(60_000, { rrif: 30_000 }), 'ON', 1.0);
        // Symmetric household: any split moves income the wrong way; savings ~0
        expect(result.taxSavings).toBeLessThan(50);
    });
});
