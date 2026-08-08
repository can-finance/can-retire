import type { TaxRates, TaxBracket } from './types';

// 2026 Tax Constants — confirmed 2026 CRA / provincial values
// (federal indexation factor for 2026 is 2.0%)
export const TAX_CONSTANTS: TaxRates = {
    federalBrackets: [
        { threshold: 0, rate: 0.14 },       // 2026 is a full-year 14% rate (2025 was a blended 14.5% after the mid-2025 cut)
        { threshold: 58523, rate: 0.205 },
        { threshold: 117045, rate: 0.26 },
        { threshold: 181440, rate: 0.29 },
        { threshold: 258482, rate: 0.33 },
    ],
    provincialBrackets: {
        'AB': [
            { threshold: 0, rate: 0.08 },       // 8% bottom bracket, effective Jan 1 2025
            { threshold: 61200, rate: 0.10 },
            { threshold: 154259, rate: 0.12 },
            { threshold: 185111, rate: 0.13 },
            { threshold: 246813, rate: 0.14 },
            { threshold: 370220, rate: 0.15 },
        ],
        // Bottom rate rose 5.06% -> 5.60% for 2026 (BC Budget, announced 2026-02-17).
        // BC has PAUSED bracket and credit indexation for 2027-2030, resuming 2031.
        'BC': [
            { threshold: 0, rate: 0.056 },
            { threshold: 50363, rate: 0.077 },
            { threshold: 100728, rate: 0.105 },
            { threshold: 115648, rate: 0.1229 },
            { threshold: 140430, rate: 0.147 },
            { threshold: 190405, rate: 0.168 },
            { threshold: 265545, rate: 0.205 },
        ],
        // Manitoba froze both its brackets and its BPA starting 2025 (Budget 2025-03-20),
        // so these do not index. NOTE the conflict: CRA's "current year tax rates" web
        // page shows 47,564 / 101,200 for MB, but T4127 and the printed MB428 both show
        // 47,000 / 100,000 — the frozen figures are correct and the web page is in error.
        'MB': [
            { threshold: 0, rate: 0.108 },
            { threshold: 47000, rate: 0.1275 },
            { threshold: 100000, rate: 0.174 },
        ],
        // Four brackets. The previous five-bracket table with a 17.5% tier at
        // 170,000 / 200,000 corresponded to no actual tax year and was a data defect;
        // NB has had four brackets since 2023.
        'NB': [
            { threshold: 0, rate: 0.094 },
            { threshold: 52333, rate: 0.14 },
            { threshold: 104666, rate: 0.16 },
            { threshold: 193861, rate: 0.195 },
        ],
        'NL': [
            { threshold: 0, rate: 0.087 },
            { threshold: 44678, rate: 0.145 },
            { threshold: 89354, rate: 0.158 },
            { threshold: 159528, rate: 0.178 },
            { threshold: 223340, rate: 0.198 },
            { threshold: 285319, rate: 0.208 },
            { threshold: 570638, rate: 0.213 },
            { threshold: 1141275, rate: 0.218 },
        ],
        'NS': [
            { threshold: 0, rate: 0.0879 },
            { threshold: 30995, rate: 0.1495 },
            { threshold: 61991, rate: 0.1667 },
            { threshold: 97417, rate: 0.175 },
            { threshold: 157124, rate: 0.21 },
        ],
        'NT': [
            { threshold: 0, rate: 0.059 },
            { threshold: 53003, rate: 0.086 },
            { threshold: 106009, rate: 0.122 },
            { threshold: 172346, rate: 0.1405 },
        ],
        'NU': [
            { threshold: 0, rate: 0.04 },
            { threshold: 55801, rate: 0.07 },
            { threshold: 111602, rate: 0.09 },
            { threshold: 181439, rate: 0.115 },
        ],
        // The top two thresholds (150,000 / 220,000) are legislated flat amounts, not indexed.
        'ON': [
            { threshold: 0, rate: 0.0505 },
            { threshold: 53891, rate: 0.0915 },
            { threshold: 107785, rate: 0.1116 },
            { threshold: 150000, rate: 0.1216 },
            { threshold: 220000, rate: 0.1316 },
        ],
        // New sixth bracket: 20% over $200,000, introduced 2026-04-14.
        // PE does not index its system.
        'PE': [
            { threshold: 0, rate: 0.095 },
            { threshold: 33928, rate: 0.1347 },
            { threshold: 65820, rate: 0.166 },
            { threshold: 106890, rate: 0.1762 },
            { threshold: 142520, rate: 0.19 },
            { threshold: 200000, rate: 0.20 },
        ],
        'QC': [
            { threshold: 0, rate: 0.14 },
            { threshold: 54345, rate: 0.19 },
            { threshold: 108680, rate: 0.24 },
            { threshold: 132245, rate: 0.2575 },
        ],
        'SK': [
            { threshold: 0, rate: 0.105 },
            { threshold: 54532, rate: 0.125 },
            { threshold: 155805, rate: 0.145 },
        ],
        // YT's lower thresholds mirror the federal ones exactly; the $500,000 top
        // bracket is Yukon-specific.
        'YT': [
            { threshold: 0, rate: 0.064 },
            { threshold: 58523, rate: 0.09 },
            { threshold: 117045, rate: 0.109 },
            { threshold: 181440, rate: 0.128 },
            { threshold: 500000, rate: 0.15 },
        ]
    },
    basicPersonalAmount: {
        federal: 16452, // 2026 full BPA, claimable up to the bottom of the 4th federal bracket
        // Floor of the federal BPA taper: the amount that remains once net income
        // reaches the bottom of the 5th (top) federal bracket. Between the two
        // bracket thresholds the BPA slides linearly from `federal` down to this.
        // Not a province — see federalBasicPersonalAmount().
        federalMinimum: 14829, // 2026
        'AB': 22769,
        'BC': 13216,
        // Frozen (see the MB bracket note above). The previous 15,969 was a transient
        // mid-2025 payroll proration, never the filed-return amount. Manitoba's own
        // phase-out above $200k of net income is NOT modelled.
        'MB': 15780,
        'NB': 13664,
        // Large jump from 11,188, announced 2026-04-29 (retroactive for 2026).
        'NL': 13094,
        // The 2025 income-tested BPA proration was removed for 2026 — it is now a
        // flat 11,932 regardless of income.
        'NS': 11932,
        'NT': 18198,
        'NU': 19659,
        'ON': 12989,
        'PE': 15000,
        'QC': 18952,
        // Rises faster than indexation because of the Saskatchewan Affordability Act's
        // $500/yr top-up, which stacks on ordinary indexing.
        'SK': 20381,
        'YT': 16452, // mirrors the federal BPA
    },
    cpp: {
        maxPensionableEarnings: 74600, // 2026 YMPE
        basicExemption: 3500,
        maxContribution: 4230.45  // 2026 employee max
    },
    oas: {
        // ≈$751.97/mo × 12 for ages 65-74 (July–Sept 2026 quarter). OAS is re-indexed
        // QUARTERLY, so this annualization is approximate; the 10% enhancement for
        // ages 75+ is still NOT modelled.
        maxAnnualBenefit: 9024,
        // 2026 INCOME-year threshold. Do not confuse it with the 93,454 still shown on
        // some canada.ca pages, which governs current-period withholding based on 2025 income.
        clawbackThreshold: 95323
    }
};

// Lowest federal bracket rate. Non-refundable federal credits (BPA, pension
// amount, age amount) are valued at this same rate by statute, so the two must
// move together. 14% is now the actual base-year (2026) rate rather than a forward
// projection — 2025 was a blended 14.5% because of the mid-year cut from 15%.
const FEDERAL_LOWEST_RATE = 0.14;

// Quebec residents pay 16.5% less basic federal tax (the Quebec abatement), in
// exchange for Quebec administering programs Ottawa runs elsewhere. Without it a
// Quebec projection overstates total tax by roughly 8% every year.
const QC_FEDERAL_ABATEMENT = 0.165;

// ---------------------------------------------------------------------------
// Age and pension-income credit amounts.
//
// `TaxRates` (src/engine/types.ts) has no slot for these, so they live here as
// module tables rather than inside TAX_CONSTANTS — same file, same review
// surface, still tax DATA kept out of the calculation bodies.
//
// Every figure below is a 2026 amount and is indexed by `inflationFactor` at the
// point of use. Provincial figures come from each jurisdiction's 2026 CRA Form
// TD1 / T4127 (the TD1 carries the same amounts as the matching Form 428);
// Quebec's come from Revenu Québec Form TP-1015.3-V (2026-01) and the Ministère
// des Finances "Parameters of the personal income tax system for 2026", Table 3.
// ---------------------------------------------------------------------------

/** Federal pension income amount (T1 line 31400) — confirmed still unindexed for 2026. */
export const FEDERAL_PENSION_INCOME_AMOUNT = 2000;

/**
 * Provincial/territorial pension income amount. Generally SMALLER than the
 * federal $2,000: most jurisdictions never indexed the $1,000 they started with,
 * while AB, NS and ON index theirs and NU/YT simply mirror the federal amount.
 * Quebec's equivalent is its "amount for retirement income", which is larger.
 */
export const PROVINCIAL_PENSION_INCOME_AMOUNT: Record<string, number> = {
    'AB': 1753,
    'BC': 1000,
    'MB': 1000,
    'NB': 1000,
    'NL': 1000,
    'NS': 1173, // re-confirmed for 2026: genuinely unchanged from 2025, not a stale copy
    'NT': 1000,
    'NU': 2000,
    'ON': 1796,
    'PE': 1000,
    'QC': 3541, // "amount for retirement income" (Schedule B) — not a $2,000-style pension amount
    'SK': 1000,
    'YT': 2000,
};

/** A max claim plus the net income above which it is clawed back. */
export interface AgeAmount {
    /** Maximum claim, before the income test. */
    max: number;
    /** Net income above which the claim is reduced. */
    threshold: number;
}

/** Rate at which the age amount is clawed back above its threshold. */
export const AGE_AMOUNT_REDUCTION_RATE = 0.15;

/** Federal age amount (T1 line 30100): $9,208 reduced by 15% of income over $46,432. */
export const FEDERAL_AGE_AMOUNT: AgeAmount = { max: 9208, threshold: 46432 };

/**
 * Provincial/territorial age amount. Each jurisdiction sets its own maximum and
 * its own threshold; the 15% claw-back rate is the same everywhere (each TD1's
 * published partial-claim range is exactly threshold -> threshold + max/0.15,
 * which is what pins the rate down).
 */
export const PROVINCIAL_AGE_AMOUNT: Record<string, AgeAmount> = {
    'AB': { max: 6345, threshold: 47234 },
    'BC': { max: 5927, threshold: 44119 },
    'MB': { max: 3728, threshold: 27749 }, // genuinely unchanged — MB froze this credit
    'NB': { max: 6158, threshold: 45844 },
    'NL': { max: 7142, threshold: 39138 },
    // NS threshold verified unchanged for 2026 even though its max rose — not a stale copy.
    'NS': { max: 5826, threshold: 30828 },
    'NT': { max: 8902, threshold: 46432 },
    'NU': { max: 12550, threshold: 46432 },
    'ON': { max: 6342, threshold: 47210 },
    'PE': { max: 6510, threshold: 36600 }, // genuinely unchanged — PE does not index this credit
    // Quebec combines the age, living-alone and retirement-income amounts into ONE
    // credit, reduced at 18.75% of net FAMILY income above 42,955 (TP-1015.3-V 2026-01).
    // KNOWN APPROXIMATION: the engine still applies AGE_AMOUNT_REDUCTION_RATE (15%) to
    // the INDIVIDUAL's net income. That behaviour is deliberately retained here —
    // switching to the 18.75% family-income mechanism is a behaviour change, not a
    // constants refresh. TODO: model Quebec's combined credit properly (family net
    // income base + 18.75% reduction rate) as its own change.
    'QC': { max: 3986, threshold: 42955 },
    'SK': { max: 5901, threshold: 43927 },
    'YT': { max: 9208, threshold: 46432 },
};

/**
 * Federal basic personal amount at a given income.
 *
 * The BPA is not flat: it is the full amount up to the bottom of the 4th federal
 * bracket, slides linearly down to `federalMinimum` at the bottom of the 5th, and
 * stays there above that. Treating it as flat over-credits high earners by up to
 * `(federal - federalMinimum) x FEDERAL_LOWEST_RATE` a year.
 *
 * The taper endpoints ARE the 4th and 5th bracket thresholds by statute, so they
 * are read straight off the bracket table rather than restated — that also means
 * they index with inflation exactly as the brackets do.
 */
export function federalBasicPersonalAmount(
    taxableIncome: number,
    inflationFactor: number = 1.0,
    taxRates: TaxRates = TAX_CONSTANTS
): number {
    const max = taxRates.basicPersonalAmount.federal * inflationFactor;
    if (taxRates.federalBrackets.length < 5) return max;

    const min = (taxRates.basicPersonalAmount.federalMinimum ?? taxRates.basicPersonalAmount.federal)
        * inflationFactor;
    const taperStart = taxRates.federalBrackets[3].threshold * inflationFactor;
    const taperEnd = taxRates.federalBrackets[4].threshold * inflationFactor;

    if (taxableIncome <= taperStart || taperEnd <= taperStart) return max;
    if (taxableIncome >= taperEnd) return min;
    return max - (max - min) * ((taxableIncome - taperStart) / (taperEnd - taperStart));
}

/** Age amount actually claimable at `income`, after the 15% income test. */
function ageAmountClaim(income: number, amount: AgeAmount, inflationFactor: number): number {
    const max = amount.max * inflationFactor;
    const threshold = amount.threshold * inflationFactor;
    return Math.max(0, max - Math.max(0, income - threshold) * AGE_AMOUNT_REDUCTION_RATE);
}

const PROVINCIAL_DTC_RATES: Record<string, number> = {
    'AB': 0.0812, 'BC': 0.12, 'MB': 0.08, 'NB': 0.14,
    'NL': 0.0635, 'NS': 0.0885, 'NT': 0.1155, 'NU': 0.0551,
    'ON': 0.10, 'PE': 0.1063, 'QC': 0.117, 'SK': 0.11, 'YT': 0.1502
};

/**
 * Federal + provincial income tax on an already-final taxable income.
 *
 * Federal and provincial tax are tracked SEPARATELY rather than as one running
 * total, because non-refundable credits can't cross jurisdictions: excess
 * federal credits don't reduce provincial tax, and each side floors at zero
 * independently. Keeping them apart is also what makes the Quebec abatement
 * expressible at all, since it applies to basic federal tax only.
 *
 * NOTE: this takes taxable income AFTER any OAS repayment deduction. Callers
 * that need the OAS recovery tax should use `calculateTotalTax`, which handles
 * the deduction and the recovery together.
 */
export function calculateIncomeTax(
    taxableIncome: number,
    province: string,
    inflationFactor: number = 1.0,
    taxRates: TaxRates = TAX_CONSTANTS,
    age: number = 0,
    eligiblePensionIncome: number = 0, // ALREADY-QUALIFIED pension income; the CALLER applies the age rules
    grossedUpDividends: number = 0, // Dividend income after 38% gross-up
    creditablePayroll: number = 0 // Base CPP/QPP + EI contributions (credit, not deduction)
): number {
    const provBrackets = taxRates.provincialBrackets[province] || taxRates.provincialBrackets['ON'];

    let fed = calculateTieredTax(taxableIncome, taxRates.federalBrackets, inflationFactor);
    let prov = calculateTieredTax(taxableIncome, provBrackets, inflationFactor);

    // --- Basic personal amounts ---
    fed -= federalBasicPersonalAmount(taxableIncome, inflationFactor, taxRates) * FEDERAL_LOWEST_RATE;
    prov -= (taxRates.basicPersonalAmount[province] || taxRates.basicPersonalAmount['ON'])
        * inflationFactor * provBrackets[0].rate;

    // --- Pension Income Credit ---
    // Applies to whatever qualifying pension income the caller passes in. The CALLER is
    // responsible for the age rules: DB lifetime-pension income (incl. bridge) qualifies at
    // ANY age; RRIF/annuity income qualifies only at 65+. So this function does NOT re-gate on
    // age — a caller passing eligiblePensionIncome for a person under 65 is asserting that
    // amount has already qualified (e.g. DB pension, or split DB income in a recipient's hands).
    // Never includes ordinary RRSP withdrawals, employment income, CPP, OAS, or investment income.
    // Federal and provincial pension amounts are capped SEPARATELY: the provincial
    // cap is its own (usually smaller) figure, and each side is credited at its own
    // lowest bracket rate.
    if (eligiblePensionIncome > 0) {
        const fedClaim = Math.min(eligiblePensionIncome, FEDERAL_PENSION_INCOME_AMOUNT * inflationFactor);
        fed -= fedClaim * FEDERAL_LOWEST_RATE;

        const provMax = (PROVINCIAL_PENSION_INCOME_AMOUNT[province] ?? FEDERAL_PENSION_INCOME_AMOUNT)
            * inflationFactor;
        prov -= Math.min(eligiblePensionIncome, provMax) * provBrackets[0].rate;
    }

    // --- Dividend Tax Credit ---
    // Eligible Canadian dividends, grossed up by 38%. The federal 15.0198% is a fixed
    // statutory fraction of the grossed-up amount — it does NOT track the lowest bracket
    // rate, so it stays put when FEDERAL_LOWEST_RATE moves.
    if (grossedUpDividends > 0) {
        fed -= grossedUpDividends * 0.1502;
        prov -= grossedUpDividends * (PROVINCIAL_DTC_RATES[province] ?? 0.10);
    }

    // --- Age Amount ---
    // Each jurisdiction runs its OWN income test on its OWN maximum, so the federal
    // and provincial claimable amounts differ at the same income — they cannot share
    // one `claimable` figure.
    if (age >= 65) {
        fed -= ageAmountClaim(taxableIncome, FEDERAL_AGE_AMOUNT, inflationFactor) * FEDERAL_LOWEST_RATE;

        const provAge = PROVINCIAL_AGE_AMOUNT[province] ?? FEDERAL_AGE_AMOUNT;
        prov -= ageAmountClaim(taxableIncome, provAge, inflationFactor) * provBrackets[0].rate;
    }

    // --- CPP/QPP base + EI contributions ---
    // A non-refundable credit at each jurisdiction's lowest rate. The enhanced
    // slice is handled as a deduction by the caller, not here.
    if (creditablePayroll > 0) {
        fed -= creditablePayroll * FEDERAL_LOWEST_RATE;
        prov -= creditablePayroll * provBrackets[0].rate;
    }

    // --- Quebec abatement --- 16.5% of basic federal tax, after federal credits.
    if (province === 'QC') {
        fed -= Math.max(0, fed) * QC_FEDERAL_ABATEMENT;
    }

    // Credits are non-refundable per jurisdiction: neither side can go below zero,
    // and neither can spill into the other.
    const provPayable = Math.max(0, prov);
    let total = Math.max(0, fed) + provPayable;

    if (province === 'ON') {
        // Surtax applies to Ontario tax remaining AFTER non-refundable credits, so a
        // filer whose credits wipe out provincial tax owes no surtax.
        total += calculateOntarioSurtax(provPayable, inflationFactor);
        // The Health Premium is a separate levy, not reduced by tax credits, so it is
        // added after the zero floor rather than before it.
        total += calculateOHP(taxableIncome);
    }

    return total;
}

export interface TaxBreakdown {
    /** Federal + provincial income tax, after the OAS repayment deduction. */
    incomeTax: number;
    /** OAS recovery tax (the clawback itself). */
    oasRecovery: number;
    total: number;
}

/**
 * The full tax bill for a year: income tax plus OAS recovery tax, computed the
 * way CRA stacks them.
 *
 * The OAS recovery is calculated on net income BEFORE the repayment (line
 * 23400), then DEDUCTED in arriving at net income (line 23500 -> 23600), so the
 * clawed-back OAS is not also taxed as ordinary income. Computing tax on the
 * undeducted figure and adding the recovery on top — which is what every call
 * site used to do by hand — double-taxes that slice, by up to ~$4,200/yr for a
 * retiree deep in the clawback range.
 *
 * Use this anywhere both pieces are needed; `calculateIncomeTax` alone is only
 * correct when there is no OAS in the picture.
 */
export function calculateTotalTax(
    netIncomeBeforeRepayment: number,
    oasReceived: number,
    province: string,
    inflationFactor: number = 1.0,
    age: number = 0,
    eligiblePensionIncome: number = 0,
    grossedUpDividends: number = 0,
    creditablePayroll: number = 0
): TaxBreakdown {
    const oasRecovery = calculateOASClawback(netIncomeBeforeRepayment, oasReceived, inflationFactor);
    const taxableIncome = Math.max(0, netIncomeBeforeRepayment - oasRecovery);
    const incomeTax = calculateIncomeTax(
        taxableIncome, province, inflationFactor, undefined,
        age, eligiblePensionIncome, grossedUpDividends, creditablePayroll
    );
    return { incomeTax, oasRecovery, total: incomeTax + oasRecovery };
}

export interface PayrollContributions {
    /** Total cash withheld — never reaches the household's pocket. */
    total: number;
    /**
     * Portion deductible from income: the ENHANCED slice of CPP/QPP (1%) plus the
     * whole second-tier CPP2/QPP2 band. Comes off taxable income outright.
     */
    deductible: number;
    /**
     * Portion relieved by a non-refundable credit at each jurisdiction's lowest
     * rate: the BASE slice of CPP/QPP plus EI. Not a deduction — worth only the
     * bottom-bracket rate however much the filer earns.
     */
    creditable: number;
}

/**
 * Mandatory employee payroll contributions on employment income: CPP (or QPP in
 * Quebec) including the second-tier CPP2/QPP2 band, plus EI at the Quebec-reduced
 * rate where applicable. These are real cash out the door before anything can be
 * spent or saved.
 *
 * The split matters because the two halves get different tax treatment. When CPP
 * was enhanced starting 2019, the extra contributions were made DEDUCTIBLE while
 * the original base contributions kept their non-refundable credit — so the same
 * paycheque deduction is relieved two different ways.
 *
 * NOT modelled: Quebec's QPIP premium.
 */
export function calculatePayrollContributions(
    employmentIncome: number,
    province: string,
    inflationFactor: number = 1.0,
    taxRates: TaxRates = TAX_CONSTANTS
): PayrollContributions {
    if (employmentIncome <= 0) return { total: 0, deductible: 0, creditable: 0 };

    const isQC = province === 'QC';
    const ympe = taxRates.cpp.maxPensionableEarnings * inflationFactor;
    const exemption = taxRates.cpp.basicExemption * inflationFactor;
    const yampe = 85_000 * inflationFactor; // 2026 second earnings ceiling
    const mie = 68_900 * inflationFactor;   // 2026 EI maximum insurable earnings

    // CPP 5.95% = 4.95% base (credit) + 1.00% enhanced (deduction).
    // QPP's total rate fell to 6.30% for 2026 (from 6.40%): 5.30% base (credit)
    // + 1.00% enhanced (deduction). CPP's stayed at 5.95%.
    const baseRate = isQC ? 0.053 : 0.0495;
    const ENHANCED_RATE = 0.01;
    const pensionable = Math.max(0, Math.min(employmentIncome, ympe) - exemption);
    // The second tier is entirely enhanced, so all of it is deductible.
    const tier2 = Math.max(0, Math.min(employmentIncome, yampe) - ympe) * 0.04;

    // Quebec's EI rate is lower because QPIP covers parental benefits separately.
    const eiRate = isQC ? 0.0130 : 0.0163;
    const ei = Math.min(employmentIncome, mie) * eiRate;

    const deductible = pensionable * ENHANCED_RATE + tier2;
    const creditable = pensionable * baseRate + ei;
    return { total: deductible + creditable, deductible, creditable };
}

function calculateTieredTax(income: number, brackets: TaxBracket[], inflationFactor: number = 1.0): number {
    let accumulatedTax = 0;

    for (let i = 0; i < brackets.length; i++) {
        const currentStart = brackets[i].threshold * inflationFactor;
        const nextStart = (i < brackets.length - 1) ? brackets[i + 1].threshold * inflationFactor : Infinity;
        const rate = brackets[i].rate;

        if (income > currentStart) {
            const incomeInBracket = Math.min(income, nextStart) - currentStart;
            accumulatedTax += incomeInBracket * rate;
        }
    }

    return accumulatedTax;
}

/**
 * Ontario Health Premium — thresholds and amounts are NOT indexed. These bands
 * have been frozen since 2004 (re-verified unchanged for 2026) and are applied to
 * nominal income.
 *
 * The premium PHASES IN within each band rather than jumping to the band maximum
 * at its floor: inside a band you pay the previous band's ceiling plus a marginal
 * rate on income above the band floor, until that band's own ceiling is reached.
 * Charging the maximum from the floor overstated the premium by up to $294 at the
 * $20,000 edge (CRA charges $6 at $20,100, not $300).
 */
export function calculateOHP(income: number): number {
    if (income <= 20_000) return 0;
    if (income <= 25_000) return Math.min(300, 0.06 * (income - 20_000));
    if (income <= 36_000) return Math.min(450, 300 + 0.06 * (income - 25_000));
    if (income <= 48_000) return Math.min(600, 450 + 0.25 * (income - 36_000));
    if (income <= 72_000) return Math.min(750, 600 + 0.25 * (income - 48_000));
    if (income <= 200_000) return Math.min(900, 750 + 0.25 * (income - 72_000));
    return 900;
}

function calculateOntarioSurtax(basicProvTax: number, inflationFactor: number = 1.0): number {
    if (basicProvTax <= 0) return 0;

    // 2026 thresholds — indexed to inflation annually (unlike the OHP bands above)
    const tier1Threshold = 5818 * inflationFactor;
    const tier2Threshold = 7446 * inflationFactor;

    let surtax = 0;

    // Tier 1: 20% of provincial tax > $5,818
    if (basicProvTax > tier1Threshold) {
        surtax += (basicProvTax - tier1Threshold) * 0.20;
    }

    // Tier 2: 36% of provincial tax > $7,446
    if (basicProvTax > tier2Threshold) {
        surtax += (basicProvTax - tier2Threshold) * 0.36;
    }

    return surtax;
}

export function calculateOASClawback(
    netIncome: number,
    maxClawback: number, // The amount of OAS received is the max that can be repaid
    inflationFactor: number = 1.0,
    threshold: number = TAX_CONSTANTS.oas.clawbackThreshold
): number {
    const indexedThreshold = threshold * inflationFactor;
    if (netIncome <= indexedThreshold) return 0;

    const repayment = (netIncome - indexedThreshold) * 0.15;
    return Math.min(repayment, maxClawback);
}

/**
 * Calculate optimal pension income split between two spouses.
 * Under Canadian tax law, up to 50% of eligible pension income can be split to a spouse.
 *
 * Eligibility depends on the income type AND the transferor's age:
 *   - DB lifetime-pension income (incl. bridge): splittable at ANY age.
 *   - RRIF withdrawals / annuities: splittable only when the transferor is 65+.
 * (Never CPP/OAS/employment, and never ordinary RRSP withdrawals.)
 *
 * The same age rules govern the CREDIT qualification of the split income in the
 * recipient's hands: split DB income stays creditable at any recipient age; split
 * RRIF income is creditable only if the recipient is 65+. We assume the split is
 * drawn DB-first (the taxpayer-favorable election — it keeps the transferred amount
 * creditable regardless of the recipient's age for as long as possible).
 */
export interface SplitPerson {
    taxableIncome: number;
    dbPensionIncome: number; // splittable & creditable at any age
    rrifIncome: number;      // splittable & creditable only at 65+
    oasIncome: number;
    grossedUpDividends: number;
    age: number;
}

export interface SplitResult {
    splitAmount: number;         // Amount of pension income transferred
    fromPerson: 1 | 2;           // Who is transferring (1 or 2)
    taxSavings: number;          // Reduction in combined tax
    person1NewTax: number;
    person2NewTax: number;
}

export function calculateOptimalSplit(
    person1: SplitPerson,
    person2: SplitPerson,
    province: string,
    inflationFactor: number
): SplitResult {
    // A person's own qualifying pension income: DB at any age, RRIF only at 65+.
    // This is both the credit-qualifying amount at baseline AND the splittable base.
    const ownQualified = (per: SplitPerson): number =>
        per.dbPensionIncome + (per.age >= 65 ? per.rrifIncome : 0);

    // Calculate baseline taxes (no splitting). `taxableIncome` here is net income
    // BEFORE any OAS repayment — calculateTotalTax applies that deduction itself.
    const p1BaseTax = calculateTotalTax(
        person1.taxableIncome, person1.oasIncome, province, inflationFactor,
        person1.age, ownQualified(person1), person1.grossedUpDividends
    ).total;

    const p2BaseTax = calculateTotalTax(
        person2.taxableIncome, person2.oasIncome, province, inflationFactor,
        person2.age, ownQualified(person2), person2.grossedUpDividends
    ).total;

    const baselineCombinedTax = p1BaseTax + p2BaseTax;

    // Per-person taxes after splitting `amount` from A to B. The split is drawn
    // DB-first (taxpayer-favorable), so we track how much of the transferred amount
    // is DB vs RRIF to qualify each side's credit correctly.
    const splitTaxes = (fromPerson: SplitPerson, toPerson: SplitPerson, amount: number): { fromTax: number, toTax: number } => {
        const dbPortion = Math.min(amount, fromPerson.dbPensionIncome);
        const rrifPortion = amount - dbPortion; // only > 0 once DB is exhausted (needs age 65+ headroom)

        // Transferor: taxable income and qualifying pension both shrink by the split
        const fromNewTaxable = fromPerson.taxableIncome - amount;
        const fromRemainingDb = fromPerson.dbPensionIncome - dbPortion;
        const fromRemainingRrif = fromPerson.rrifIncome - rrifPortion;
        const fromNewQualified = fromRemainingDb + (fromPerson.age >= 65 ? fromRemainingRrif : 0);

        // Recipient: taxable income rises; the split's DB portion is creditable at any
        // recipient age, its RRIF portion only if the recipient is 65+.
        const toNewTaxable = toPerson.taxableIncome + amount;
        const toNewQualified = ownQualified(toPerson) + dbPortion + (toPerson.age >= 65 ? rrifPortion : 0);

        const fromTax = calculateTotalTax(
            fromNewTaxable, fromPerson.oasIncome, province, inflationFactor,
            fromPerson.age, fromNewQualified, fromPerson.grossedUpDividends
        ).total;

        const toTax = calculateTotalTax(
            toNewTaxable, toPerson.oasIncome, province, inflationFactor,
            toPerson.age, toNewQualified, toPerson.grossedUpDividends
        ).total;

        return { fromTax, toTax };
    };

    const calcTaxWithSplit = (fromPerson: SplitPerson, toPerson: SplitPerson, amount: number): number => {
        const { fromTax, toTax } = splitTaxes(fromPerson, toPerson, amount);
        return fromTax + toTax;
    };

    // Splittable base = own qualifying pension income. A person UNDER 65 with DB
    // pension can now split (RRIF-only under-65 still can't — ownQualified excludes it).
    const p1SplitBase = ownQualified(person1);
    const p2SplitBase = ownQualified(person2);
    const p1CanSplit = p1SplitBase > 0;
    const p2CanSplit = p2SplitBase > 0;

    let bestResult: SplitResult = {
        splitAmount: 0,
        fromPerson: 1,
        taxSavings: 0,
        person1NewTax: p1BaseTax,
        person2NewTax: p2BaseTax
    };

    /**
     * Ternary search narrows an interval and returns its midpoint, so it can
     * approach an endpoint but never reach it. That matters here because the
     * optimum is very often EXACTLY at maxSplit — when one spouse's income
     * dwarfs the other's, transferring everything the rules allow is simply
     * best. The search would stop ~$60-90 short of the boundary and quietly
     * leave a few dollars of tax on the table every year.
     *
     * So evaluate the boundary explicitly and keep whichever is actually better.
     */
    const bestSplitAmount = (from: SplitPerson, to: SplitPerson, searched: number, maxSplit: number): number => {
        const searchedTax = calcTaxWithSplit(from, to, searched);
        const boundaryTax = calcTaxWithSplit(from, to, maxSplit);
        return boundaryTax < searchedTax ? maxSplit : searched;
    };

    // Try splitting from Person 1 to Person 2
    if (p1CanSplit) {
        const maxSplit = p1SplitBase * 0.5;

        // Ternary search for optimal split amount
        let low = 0, high = maxSplit;
        for (let i = 0; i < 15; i++) {
            const mid1 = low + (high - low) / 3;
            const mid2 = high - (high - low) / 3;

            const tax1 = calcTaxWithSplit(person1, person2, mid1);
            const tax2 = calcTaxWithSplit(person1, person2, mid2);

            if (tax1 < tax2) {
                high = mid2;
            } else {
                low = mid1;
            }
        }

        const optimalAmount = bestSplitAmount(person1, person2, (low + high) / 2, maxSplit);
        const combinedTax = calcTaxWithSplit(person1, person2, optimalAmount);
        const savings = baselineCombinedTax - combinedTax;

        if (savings > bestResult.taxSavings) {
            const { fromTax, toTax } = splitTaxes(person1, person2, optimalAmount);
            bestResult = {
                splitAmount: optimalAmount,
                fromPerson: 1,
                taxSavings: savings,
                person1NewTax: fromTax,
                person2NewTax: toTax
            };
        }
    }

    // Try splitting from Person 2 to Person 1
    if (p2CanSplit) {
        const maxSplit = p2SplitBase * 0.5;

        let low = 0, high = maxSplit;
        for (let i = 0; i < 15; i++) {
            const mid1 = low + (high - low) / 3;
            const mid2 = high - (high - low) / 3;

            const tax1 = calcTaxWithSplit(person2, person1, mid1);
            const tax2 = calcTaxWithSplit(person2, person1, mid2);

            if (tax1 < tax2) {
                high = mid2;
            } else {
                low = mid1;
            }
        }

        const optimalAmount = bestSplitAmount(person2, person1, (low + high) / 2, maxSplit);
        const combinedTax = calcTaxWithSplit(person2, person1, optimalAmount);
        const savings = baselineCombinedTax - combinedTax;

        if (savings > bestResult.taxSavings) {
            const { fromTax, toTax } = splitTaxes(person2, person1, optimalAmount);
            bestResult = {
                splitAmount: optimalAmount,
                fromPerson: 2,
                taxSavings: savings,
                person1NewTax: toTax,   // person1 is the recipient here
                person2NewTax: fromTax  // person2 is the transferor here
            };
        }
    }

    return bestResult;
}
