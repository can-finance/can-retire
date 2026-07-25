import { describe, it, expect } from 'vitest';
import {
    calculateIncomeTax,
    calculateOASClawback,
    calculateOHP,
    calculateTotalTax,
    calculatePayrollContributions,
    calculateOptimalSplit,
    federalBasicPersonalAmount,
    FEDERAL_AGE_AMOUNT,
    PROVINCIAL_AGE_AMOUNT,
    PROVINCIAL_PENSION_INCOME_AMOUNT,
    TAX_CONSTANTS,
} from './tax';
import type { SplitPerson } from './tax';

describe('calculateIncomeTax — golden values (no age/pension/dividend credits)', () => {
    // Federal lowest bracket is 14% (2026 on). Non-refundable federal credits are
    // valued at that same statutory rate, so BPA relief moved 15% -> 14% with it.
    it('ON, $50,000: matches hand calculation', () => {
        // Federal: 50,000 × 14%                       =  7,000.00
        // Fed BPA credit: 16,129 × 14%                = -2,258.06
        // ON: 50,000 × 5.05%                          =  2,525.00
        // ON BPA credit: 12,747 × 5.05%               =   -643.72
        // ON surtax: prov tax payable 1,881.28 < 5,710 =      0
        // OHP: 600 + 25% × (50,000 − 48,000), capped   =    750.00
        // Total                                       =  7,373.22
        expect(calculateIncomeTax(50_000, 'ON')).toBeCloseTo(7_373.22, 1);
    });

    it('AB, $100,000: matches hand calculation', () => {
        // Federal: 57,375 × 14% + 42,625 × 20.5%      = 16,770.63
        // Fed BPA credit: 16,129 × 14%                = -2,258.06
        // AB: 60,000 × 8% + 40,000 × 10%              =  8,800.00
        // AB BPA credit: 22,323 × 8%                  = -1,785.84
        // Total                                       = 21,526.73
        expect(calculateIncomeTax(100_000, 'AB')).toBeCloseTo(21_526.73, 1);
    });

    it('income below the basic personal amount owes zero tax', () => {
        expect(calculateIncomeTax(12_000, 'ON')).toBe(0);
        expect(calculateIncomeTax(0, 'ON')).toBe(0);
    });

    it('Ontario Health Premium phases in past $20,000 rather than jumping to $300', () => {
        // Previously this asserted a $300 cliff at the band edge — that was the bug.
        // CRA charges 6% of the excess here, so $1 of income costs ~6 cents of premium
        // on top of the ~19.55% marginal income tax.
        const below = calculateIncomeTax(20_000, 'ON');
        const above = calculateIncomeTax(20_001, 'ON');
        expect(above - below).toBeLessThan(1);
        // $20,100 is the canonical example: $6 of premium, not $300.
        expect(calculateIncomeTax(20_100, 'ON') - calculateIncomeTax(20_000, 'ON'))
            .toBeCloseTo(6 + 100 * (0.14 + 0.0505), 2);
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
        // when province === 'ON'. At $80k (no surtax range) the gap is exactly the OHP,
        // which is capped at $900 from $72,600 up.
        const diff = calculateIncomeTax(80_000, 'ON') - calculateIncomeTax(80_000, 'XX');
        expect(diff).toBeCloseTo(900, 5);
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
        // $40k is below BOTH income-test thresholds (fed $45,522, ON $46,330), so both
        // maxima are claimable in full — but each at its own amount and its own rate:
        //   federal 9,028 × 14%  = 1,263.92
        //   Ontario 6,223 × 5.05% =  314.26
        // (The old expectation of 9,028 × 19% applied the FEDERAL amount at a flat 5%
        // provincial proxy — wrong on both counts.)
        expect(under65 - over65).toBeCloseTo(9_028 * 0.14 + 6_223 * 0.0505, 2);
    });

    it('pension income credit caps separately at the federal and provincial amounts', () => {
        // Ontario's pension amount is $1,762, not the federal $2,000, and it is credited
        // at ON's own 5.05% rather than a flat 5%.
        const noPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 66, 0);
        const smallPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 66, 1_000);
        const bigPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 66, 50_000);
        // $1,000 is under both caps, so the whole amount is claimable on both sides.
        expect(noPension - smallPension).toBeCloseTo(1_000 * 0.14 + 1_000 * 0.0505, 2);
        // Large pension: federal caps at $2,000, Ontario at $1,762.
        expect(noPension - bigPension).toBeCloseTo(2_000 * 0.14 + 1_762 * 0.0505, 2);
    });

    it('applies the pension credit under 65 (caller is responsible for age-qualifying)', () => {
        // The internal age gate was removed: DB lifetime-pension income qualifies at any
        // age, so a caller passing eligible pension income for a 60-year-old gets the credit.
        const noPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 60, 0);
        const withPension = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 60, 2_000);
        expect(noPension - withPension).toBeCloseTo(2_000 * 0.14 + 1_762 * 0.0505, 2);
    });
});

describe('calculateOHP — Ontario Health Premium phase-in', () => {
    // The premium is a phase-in, not a step function. Within each band you pay the
    // previous band's ceiling plus a marginal rate on the excess over the band floor,
    // until that band's own ceiling is hit. Bands are frozen (never indexed).

    it('is zero at and below $20,000', () => {
        expect(calculateOHP(0)).toBe(0);
        expect(calculateOHP(19_999)).toBe(0);
        expect(calculateOHP(20_000)).toBe(0);
    });

    it('charges nothing extra at each band floor (no cliffs)', () => {
        // At a band floor the premium equals the previous band's ceiling exactly.
        expect(calculateOHP(20_000)).toBeCloseTo(0, 6);
        expect(calculateOHP(25_000)).toBeCloseTo(300, 6);
        expect(calculateOHP(36_000)).toBeCloseTo(450, 6);
        expect(calculateOHP(48_000)).toBeCloseTo(600, 6);
        expect(calculateOHP(72_000)).toBeCloseTo(750, 6);
        expect(calculateOHP(200_000)).toBeCloseTo(900, 6);
    });

    it('phases in at 6% in the two lower bands', () => {
        expect(calculateOHP(20_100)).toBeCloseTo(6, 6);      // the canonical CRA example
        expect(calculateOHP(22_500)).toBeCloseTo(150, 6);    // mid phase-in of band 1
        expect(calculateOHP(26_000)).toBeCloseTo(360, 6);    // 300 + 6% × 1,000
    });

    it('phases in at 25% in the three upper bands', () => {
        expect(calculateOHP(36_300)).toBeCloseTo(525, 6);    // 450 + 25% × 300
        expect(calculateOHP(48_400)).toBeCloseTo(700, 6);    // 600 + 25% × 400
        expect(calculateOHP(72_300)).toBeCloseTo(825, 6);    // 750 + 25% × 300
    });

    it('caps within each band and holds until the next band starts', () => {
        expect(calculateOHP(25_000)).toBeCloseTo(300, 6);    // band 1 cap, reached exactly at 25,000
        expect(calculateOHP(27_500)).toBeCloseTo(450, 6);    // band 2 cap
        expect(calculateOHP(30_000)).toBeCloseTo(450, 6);    // ...and holds to the band end
        expect(calculateOHP(36_600)).toBeCloseTo(600, 6);    // band 3 cap
        expect(calculateOHP(48_600)).toBeCloseTo(750, 6);    // band 4 cap
        expect(calculateOHP(72_600)).toBeCloseTo(900, 6);    // band 5 cap
    });

    it('tops out at $900 above $200,000', () => {
        expect(calculateOHP(200_001)).toBe(900);
        expect(calculateOHP(1_000_000)).toBe(900);
    });

    it('never decreases as income rises', () => {
        let prev = -1;
        for (let income = 0; income <= 220_000; income += 250) {
            const premium = calculateOHP(income);
            expect(premium).toBeGreaterThanOrEqual(prev);
            prev = premium;
        }
    });
});

describe('federalBasicPersonalAmount — high-income taper', () => {
    const FULL = TAX_CONSTANTS.basicPersonalAmount.federal;          // 16,129
    const FLOOR = TAX_CONSTANTS.basicPersonalAmount.federalMinimum;  // 14,538
    const START = TAX_CONSTANTS.federalBrackets[3].threshold;        // 177,882
    const END = TAX_CONSTANTS.federalBrackets[4].threshold;          // 253,414

    it('is the full amount up to the bottom of the 4th bracket', () => {
        expect(federalBasicPersonalAmount(0)).toBeCloseTo(FULL, 6);
        expect(federalBasicPersonalAmount(100_000)).toBeCloseTo(FULL, 6);
        expect(federalBasicPersonalAmount(START)).toBeCloseTo(FULL, 6);
    });

    it('slides linearly to the floor across the 4th bracket', () => {
        const mid = (START + END) / 2;
        expect(federalBasicPersonalAmount(mid)).toBeCloseTo((FULL + FLOOR) / 2, 6);
        // Quarter point: three quarters of the way from FLOOR back up to FULL.
        expect(federalBasicPersonalAmount(START + (END - START) / 4))
            .toBeCloseTo(FULL - (FULL - FLOOR) / 4, 6);
    });

    it('bottoms out at the floor from the 5th bracket up', () => {
        expect(federalBasicPersonalAmount(END)).toBeCloseTo(FLOOR, 6);
        expect(federalBasicPersonalAmount(500_000)).toBeCloseTo(FLOOR, 6);
    });

    it('indexes the amounts AND the taper endpoints with inflation', () => {
        expect(federalBasicPersonalAmount(2 * START, 2.0)).toBeCloseTo(2 * FULL, 6);
        expect(federalBasicPersonalAmount(2 * END, 2.0)).toBeCloseTo(2 * FLOOR, 6);
        expect(federalBasicPersonalAmount(START + END, 2.0)).toBeCloseTo(FULL + FLOOR, 6);
        // The un-indexed midpoint sits below the indexed taper start, so it is untapered.
        expect(federalBasicPersonalAmount((START + END) / 2, 2.0)).toBeCloseTo(2 * FULL, 6);
    });

    it('feeds through to calculateIncomeTax as extra marginal rate', () => {
        // Alberta: no surtax or health premium to muddy the marginal rate. Inside the
        // taper the effective federal marginal rate picks up the lost BPA relief.
        const taperEffect = ((FULL - FLOOR) / (END - START)) * 0.14;
        const inTaper = (calculateIncomeTax(210_000, 'AB') - calculateIncomeTax(200_000, 'AB')) / 10_000;
        expect(inTaper).toBeCloseTo(0.29 + 0.13 + taperEffect, 6);

        // Above the taper the extra rate disappears again.
        const aboveTaper = (calculateIncomeTax(270_000, 'AB') - calculateIncomeTax(260_000, 'AB')) / 10_000;
        expect(aboveTaper).toBeCloseTo(0.33 + 0.14, 6);
    });
});

describe('provincial age and pension credits use each province\'s own rate and amount', () => {
    // Both credits previously used a flat 5% proxy applied to the FEDERAL claim
    // amount. Neither part was right: the rate is the province's own lowest bracket
    // rate, and the claim is the province's own (usually smaller) amount.
    const ageSaving = (income: number, province: string) =>
        calculateIncomeTax(income, province, 1.0, undefined, 64)
        - calculateIncomeTax(income, province, 1.0, undefined, 65);

    const claimable = (income: number, { max, threshold }: { max: number; threshold: number }) =>
        Math.max(0, max - Math.max(0, income - threshold) * 0.15);

    it.each(['AB', 'BC', 'MB', 'SK'])('age credit for %s uses its own lowest bracket rate', (prov) => {
        const income = 40_000;
        const rate = TAX_CONSTANTS.provincialBrackets[prov][0].rate;
        const expected = claimable(income, FEDERAL_AGE_AMOUNT) * 0.14
            + claimable(income, PROVINCIAL_AGE_AMOUNT[prov]) * rate;
        expect(ageSaving(income, prov)).toBeCloseTo(expected, 2);
    });

    it('Alberta credits the age amount at 8%, Ontario at 5.05% — not a flat 5%', () => {
        const income = 40_000;
        const abProv = ageSaving(income, 'AB') - claimable(income, FEDERAL_AGE_AMOUNT) * 0.14;
        const onProv = ageSaving(income, 'ON') - claimable(income, FEDERAL_AGE_AMOUNT) * 0.14;

        expect(abProv).toBeCloseTo(PROVINCIAL_AGE_AMOUNT['AB'].max * 0.08, 2);
        expect(onProv).toBeCloseTo(PROVINCIAL_AGE_AMOUNT['ON'].max * 0.0505, 2);
        // The old flat-5%-of-the-federal-amount proxy would have given the same number
        // in both provinces; it does not.
        expect(abProv).not.toBeCloseTo(FEDERAL_AGE_AMOUNT.max * 0.05, 1);
        expect(onProv).not.toBeCloseTo(FEDERAL_AGE_AMOUNT.max * 0.05, 1);
        expect(abProv).not.toBeCloseTo(onProv, 1);
    });

    it('provincial age amounts run their own income test, not the federal one', () => {
        // Manitoba's age amount starts phasing out at $27,749 — far below the federal
        // $45,522 — so at $40k the provincial claim is already partly clawed back while
        // the federal claim is still whole.
        expect(claimable(40_000, FEDERAL_AGE_AMOUNT)).toBeCloseTo(FEDERAL_AGE_AMOUNT.max, 6);
        expect(claimable(40_000, PROVINCIAL_AGE_AMOUNT['MB']))
            .toBeCloseTo(3_728 - (40_000 - 27_749) * 0.15, 6);
        expect(ageSaving(40_000, 'MB')).toBeCloseTo(
            FEDERAL_AGE_AMOUNT.max * 0.14 + (3_728 - (40_000 - 27_749) * 0.15) * 0.108, 2
        );
    });

    it('pension amounts are capped provincially at the province\'s own figure', () => {
        // BC's pension amount is the un-indexed $1,000 floor, at BC's 5.06% rate.
        const saving = calculateIncomeTax(60_000, 'BC', 1.0, undefined, 60, 0)
            - calculateIncomeTax(60_000, 'BC', 1.0, undefined, 60, 50_000);
        expect(saving).toBeCloseTo(2_000 * 0.14 + 1_000 * 0.0506, 2);
        expect(PROVINCIAL_PENSION_INCOME_AMOUNT['BC']).toBe(1_000);
        expect(PROVINCIAL_PENSION_INCOME_AMOUNT['ON']).toBe(1_762);
    });

    it('unknown provinces fall back to the federal amounts', () => {
        // 'XX' borrows Ontario's brackets, so the RATE is ON's, but the claim amounts
        // fall back to federal rather than silently inheriting Ontario's.
        const saving = calculateIncomeTax(60_000, 'XX', 1.0, undefined, 60, 0)
            - calculateIncomeTax(60_000, 'XX', 1.0, undefined, 60, 50_000);
        expect(saving).toBeCloseTo(2_000 * 0.14 + 2_000 * 0.0505, 2);
    });
});

describe('Quebec federal abatement', () => {
    // Quebec residents pay 16.5% less basic federal tax. Without it, every Quebec
    // projection overstated total tax by roughly 8% a year.
    it('reduces Quebec tax relative to the same brackets without the abatement', () => {
        const qc = calculateIncomeTax(100_000, 'QC', 1.0);
        // Rebuild what QC would owe with no abatement: federal part + QC provincial part.
        const fedOnly = calculateIncomeTax(100_000, 'XX', 1.0)
            - (calculateIncomeTax(100_000, 'XX', 1.0) - fedPortion(100_000));
        expect(qc).toBeLessThan(fedPortion(100_000) + qcProvincialPortion(100_000) + 1);
        // The saving is 16.5% of basic federal tax, within a dollar.
        const expected = fedPortion(100_000) * (1 - 0.165) + qcProvincialPortion(100_000);
        expect(qc).toBeCloseTo(expected, 0);
        expect(fedOnly).toBeGreaterThan(0); // sanity: helper wired up
    });

    it('leaves other provinces untouched', () => {
        // $80k: below the Ontario surtax threshold, so ON tax is exactly
        // federal + provincial + the $900 Health Premium cap.
        const on = calculateIncomeTax(80_000, 'ON', 1.0);
        expect(on).toBeCloseTo(fedPortion(80_000) + onProvincialPortion(80_000) + 900, 0);
    });
});

// Hand-rebuilt federal/provincial pieces, used only to prove the abatement lands
// on the federal side and nothing else moved.
function tieredTax(income: number, brackets: { threshold: number; rate: number }[]): number {
    let t = 0;
    for (let i = 0; i < brackets.length; i++) {
        const lo = brackets[i].threshold;
        const hi = i < brackets.length - 1 ? brackets[i + 1].threshold : Infinity;
        if (income > lo) t += (Math.min(income, hi) - lo) * brackets[i].rate;
    }
    return t;
}
function fedPortion(income: number): number {
    return Math.max(0, tieredTax(income, TAX_CONSTANTS.federalBrackets) - TAX_CONSTANTS.basicPersonalAmount.federal * 0.14);
}
function qcProvincialPortion(income: number): number {
    const b = TAX_CONSTANTS.provincialBrackets['QC'];
    return Math.max(0, tieredTax(income, b) - TAX_CONSTANTS.basicPersonalAmount['QC'] * b[0].rate);
}
function onProvincialPortion(income: number): number {
    const b = TAX_CONSTANTS.provincialBrackets['ON'];
    return Math.max(0, tieredTax(income, b) - TAX_CONSTANTS.basicPersonalAmount['ON'] * b[0].rate);
}

describe('calculateTotalTax — OAS repayment is deducted before tax', () => {
    // CRA computes the recovery on net income before the repayment (line 23400),
    // then deducts it (line 23500) in arriving at net income. Taxing the full
    // amount AND adding the recovery double-taxes the clawed-back slice.
    it('taxes income net of the recovery, not gross of it', () => {
        const income = 150_000;
        const oas = 8_820;
        const { incomeTax, oasRecovery, total } = calculateTotalTax(income, oas, 'ON', 1.0, 70);

        expect(oasRecovery).toBeCloseTo(calculateOASClawback(income, oas, 1.0), 6);
        // The income-tax half is computed on income MINUS the repayment.
        expect(incomeTax).toBeCloseTo(calculateIncomeTax(income - oasRecovery, 'ON', 1.0, undefined, 70), 6);
        expect(total).toBeCloseTo(incomeTax + oasRecovery, 6);

        // ...and that is strictly less than the old double-taxing formula.
        const oldWay = calculateIncomeTax(income, 'ON', 1.0, undefined, 70) + oasRecovery;
        expect(total).toBeLessThan(oldWay);
    });

    it('is identical to plain income tax when there is no clawback', () => {
        const plain = calculateIncomeTax(60_000, 'ON', 1.0, undefined, 70);
        const { total, oasRecovery } = calculateTotalTax(60_000, 8_820, 'ON', 1.0, 70);
        expect(oasRecovery).toBe(0);
        expect(total).toBeCloseTo(plain, 6);
    });

    it('passes credits through to the income-tax half', () => {
        // Alberta: no surtax to multiply the provincial share of the credit, so the
        // saving is exactly the credit's face value — federal $2,000 at 14% plus
        // Alberta's own $1,719 pension amount at its own 8% lowest rate.
        const withCredit = calculateTotalTax(150_000, 8_820, 'AB', 1.0, 70, 2_000);
        const without = calculateTotalTax(150_000, 8_820, 'AB', 1.0, 70, 0);
        expect(without.total - withCredit.total).toBeCloseTo(2_000 * 0.14 + 1_719 * 0.08, 2);
    });
});

describe('calculatePayrollContributions', () => {
    it('is zero without employment income', () => {
        expect(calculatePayrollContributions(0, 'ON').total).toBe(0);
        expect(calculatePayrollContributions(-5_000, 'ON').total).toBe(0);
    });

    it('caps CPP at the first ceiling and EI at maximum insurable earnings', () => {
        const atCeiling = calculatePayrollContributions(200_000, 'ON');
        // CPP base (71,300−3,500)×5.95% = 4,034.10, CPP2 (81,300−71,300)×4% = 400,
        // EI 65,700×1.64% = 1,077.48
        expect(atCeiling.total).toBeCloseTo(4_034.10 + 400 + 1_077.48, 1);
    });

    it('scales with income below the ceilings', () => {
        const low = calculatePayrollContributions(30_000, 'ON');
        // (30,000−3,500)×5.95% + 30,000×1.64% = 1,576.75 + 492 = 2,068.75
        expect(low.total).toBeCloseTo(2_068.75, 1);
        expect(low.total).toBeLessThan(calculatePayrollContributions(60_000, 'ON').total);
    });

    it('uses QPP and the reduced Quebec EI rate in Quebec', () => {
        const qc = calculatePayrollContributions(200_000, 'QC');
        const rest = calculatePayrollContributions(200_000, 'ON');
        // Higher QPP rate, lower EI rate — QPP dominates, so QC pays more overall.
        expect(qc.total).toBeGreaterThan(rest.total);
        expect(qc.total).toBeCloseTo((71_300 - 3_500) * 0.064 + 400 + 65_700 * 0.0131, 1);
    });

    it('indexes its ceilings with inflation', () => {
        const base = calculatePayrollContributions(200_000, 'ON', 1.0);
        const doubled = calculatePayrollContributions(400_000, 'ON', 2.0);
        expect(doubled.total).toBeCloseTo(base.total * 2, 0);
    });

    // The enhanced slice is deductible; the base slice and EI are a credit. Getting
    // the split wrong silently misprices every working year.
    it('splits contributions into the deductible and creditable halves', () => {
        const at = calculatePayrollContributions(200_000, 'ON');
        const pensionable = 71_300 - 3_500;
        // Enhanced CPP is 1% of pensionable earnings; all of CPP2 is enhanced too.
        expect(at.deductible).toBeCloseTo(pensionable * 0.01 + 400, 1);
        // Base CPP 4.95% plus EI.
        expect(at.creditable).toBeCloseTo(pensionable * 0.0495 + 65_700 * 0.0164, 1);
        // The halves account for every dollar withheld.
        expect(at.deductible + at.creditable).toBeCloseTo(at.total, 6);
    });

    it("uses QPP's larger base share in Quebec", () => {
        const qc = calculatePayrollContributions(200_000, 'QC');
        const pensionable = 71_300 - 3_500;
        expect(qc.deductible).toBeCloseTo(pensionable * 0.01 + 400, 1);
        expect(qc.creditable).toBeCloseTo(pensionable * 0.054 + 65_700 * 0.0131, 1);
    });

    it('zero income yields a zero breakdown, not just a zero total', () => {
        expect(calculatePayrollContributions(0, 'ON')).toEqual({ total: 0, deductible: 0, creditable: 0 });
    });
});

describe('payroll contributions relieve tax', () => {
    it("the creditable half reduces tax at each jurisdiction's lowest rate", () => {
        const creditable = 5_000;
        const withCredit = calculateIncomeTax(80_000, 'AB', 1.0, undefined, 40, 0, 0, creditable);
        const without = calculateIncomeTax(80_000, 'AB', 1.0, undefined, 40, 0, 0, 0);
        // Alberta: federal 14% + provincial 8%, no surtax to complicate it.
        expect(without - withCredit).toBeCloseTo(creditable * (0.14 + 0.08), 1);
    });

    it('flows through calculateTotalTax', () => {
        const withCredit = calculateTotalTax(80_000, 0, 'AB', 1.0, 40, 0, 0, 5_000);
        const without = calculateTotalTax(80_000, 0, 'AB', 1.0, 40, 0, 0, 0);
        expect(without.total - withCredit.total).toBeCloseTo(5_000 * (0.14 + 0.08), 1);
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
