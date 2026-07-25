import type { TaxRates, TaxBracket } from './types';

// 2025 Tax Constants — Updated to confirmed 2025 CRA / provincial values
export const TAX_CONSTANTS: TaxRates = {
    federalBrackets: [
        { threshold: 0, rate: 0.14 },       // 14% from 2026 on (2025 was a blended 14.5% — see FEDERAL_LOWEST_RATE)
        { threshold: 57375, rate: 0.205 },
        { threshold: 114750, rate: 0.26 },
        { threshold: 177882, rate: 0.29 },
        { threshold: 253414, rate: 0.33 },
    ],
    provincialBrackets: {
        'AB': [
            { threshold: 0, rate: 0.08 },       // New 8% bracket effective Jan 1 2025
            { threshold: 60000, rate: 0.10 },
            { threshold: 151234, rate: 0.12 },
            { threshold: 181481, rate: 0.13 },
            { threshold: 241974, rate: 0.14 },
            { threshold: 362961, rate: 0.15 },
        ],
        'BC': [
            { threshold: 0, rate: 0.0506 },
            { threshold: 49279, rate: 0.077 },
            { threshold: 98560, rate: 0.105 },
            { threshold: 113158, rate: 0.1229 },
            { threshold: 137407, rate: 0.147 },
            { threshold: 186306, rate: 0.168 },
            { threshold: 259829, rate: 0.205 },
        ],
        'MB': [
            { threshold: 0, rate: 0.108 },
            { threshold: 47000, rate: 0.1275 },
            { threshold: 100000, rate: 0.174 },
        ],
        'NB': [
            { threshold: 0, rate: 0.094 },
            { threshold: 52333, rate: 0.14 },
            { threshold: 104666, rate: 0.16 },
            { threshold: 170000, rate: 0.175 },
            { threshold: 200000, rate: 0.195 },
        ],
        'NL': [
            { threshold: 0, rate: 0.087 },
            { threshold: 44192, rate: 0.145 },
            { threshold: 88382, rate: 0.158 },
            { threshold: 157792, rate: 0.178 },
            { threshold: 220910, rate: 0.198 },
            { threshold: 281160, rate: 0.208 },
            { threshold: 557250, rate: 0.213 },
            { threshold: 1109430, rate: 0.218 },
        ],
        'NS': [
            { threshold: 0, rate: 0.0879 },
            { threshold: 30507, rate: 0.1495 },
            { threshold: 61015, rate: 0.1667 },
            { threshold: 95883, rate: 0.175 },
            { threshold: 154650, rate: 0.21 },
        ],
        'NT': [
            { threshold: 0, rate: 0.059 },
            { threshold: 51964, rate: 0.086 },
            { threshold: 103930, rate: 0.122 },
            { threshold: 168967, rate: 0.1405 },
        ],
        'NU': [
            { threshold: 0, rate: 0.04 },
            { threshold: 54707, rate: 0.07 },
            { threshold: 109413, rate: 0.09 },
            { threshold: 177881, rate: 0.115 },
        ],
        'ON': [
            { threshold: 0, rate: 0.0505 },
            { threshold: 52886, rate: 0.0915 },
            { threshold: 105775, rate: 0.1116 },
            { threshold: 150000, rate: 0.1216 },
            { threshold: 220000, rate: 0.1316 },
        ],
        'PE': [
            { threshold: 0, rate: 0.095 },
            { threshold: 33328, rate: 0.1347 },
            { threshold: 64656, rate: 0.166 },
            { threshold: 105000, rate: 0.1762 },
            { threshold: 140000, rate: 0.19 },
        ],
        'QC': [
            { threshold: 0, rate: 0.14 },
            { threshold: 53255, rate: 0.19 },
            { threshold: 106495, rate: 0.24 },
            { threshold: 129590, rate: 0.2575 },
        ],
        'SK': [
            { threshold: 0, rate: 0.105 },
            { threshold: 53463, rate: 0.125 },
            { threshold: 152750, rate: 0.145 },
        ],
        'YT': [
            { threshold: 0, rate: 0.064 },
            { threshold: 57375, rate: 0.09 },
            { threshold: 114750, rate: 0.109 },
            { threshold: 177882, rate: 0.128 },
            { threshold: 500000, rate: 0.15 },
        ]
    },
    basicPersonalAmount: {
        federal: 16129, // 2025 full BPA, claimable up to the bottom of the 4th federal bracket
        // Floor of the federal BPA taper: the amount that remains once net income
        // reaches the bottom of the 5th (top) federal bracket. Between the two
        // bracket thresholds the BPA slides linearly from `federal` down to this.
        // Not a province — see federalBasicPersonalAmount().
        federalMinimum: 14538, // 2025
        'AB': 22323,
        'BC': 12932,
        // 2025 per CRA Form TD1MB. Manitoba resumed indexing for 2025 (the previous
        // 15,780 here was the frozen 2024 amount). Its own phase-out above $200k of
        // net income is NOT modelled.
        'MB': 15969,
        'NB': 13396,
        'NL': 11067,
        'NS': 11744,
        'NT': 17842,
        'NU': 19274,
        'ON': 12747,
        'PE': 14650,
        'QC': 18571,
        'SK': 19491,
        'YT': 16129,
    },
    cpp: {
        maxPensionableEarnings: 71300, // 2025 YMPE
        basicExemption: 3500,
        maxContribution: 4034  // 2025 employee max
    },
    oas: {
        maxAnnualBenefit: 8820, // ~$735/mo × 12 (2025 annualized)
        clawbackThreshold: 93454 // 2025
    }
};

// Lowest federal bracket rate. Non-refundable federal credits (BPA, pension
// amount, age amount) are valued at this same rate by statute, so the two must
// move together. 2025 was a blended 14.5% because of the mid-year cut from 15%;
// every projected year from 2026 on is 14%.
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
// Every figure below is a 2025 amount and is indexed by `inflationFactor` at the
// point of use. Provincial figures come from each jurisdiction's 2025 CRA Form
// TD1 (which carries the same amounts as the matching Form 428); Quebec's come
// from Revenu Québec Form TP-1015.3-V (2025-01) and the Ministère des Finances
// "Parameters of the personal income tax system for 2025", Table 3.
// ---------------------------------------------------------------------------

/** Federal pension income amount (T1 line 31400). */
export const FEDERAL_PENSION_INCOME_AMOUNT = 2000;

/**
 * Provincial/territorial pension income amount. Generally SMALLER than the
 * federal $2,000: most jurisdictions never indexed the $1,000 they started with,
 * while AB, NS and ON index theirs and NU/YT simply mirror the federal amount.
 * Quebec's equivalent is its "amount for retirement income", which is larger.
 */
export const PROVINCIAL_PENSION_INCOME_AMOUNT: Record<string, number> = {
    'AB': 1719,
    'BC': 1000,
    'MB': 1000,
    'NB': 1000,
    'NL': 1000,
    'NS': 1173,
    'NT': 1000,
    'NU': 2000,
    'ON': 1762,
    'PE': 1000,
    'QC': 3470, // "amount for retirement income" (Schedule B) — not a $2,000-style pension amount
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

/** Federal age amount (T1 line 30100): $9,028 reduced by 15% of income over $45,522. */
export const FEDERAL_AGE_AMOUNT: AgeAmount = { max: 9028, threshold: 45522 };

/**
 * Provincial/territorial age amount. Each jurisdiction sets its own maximum and
 * its own threshold; the 15% claw-back rate is the same everywhere (each TD1's
 * published partial-claim range is exactly threshold -> threshold + max/0.15,
 * which is what pins the rate down).
 */
export const PROVINCIAL_AGE_AMOUNT: Record<string, AgeAmount> = {
    'AB': { max: 6221, threshold: 46308 },
    'BC': { max: 5799, threshold: 43169 },
    'MB': { max: 3728, threshold: 27749 },
    'NB': { max: 6037, threshold: 44945 },
    'NL': { max: 7064, threshold: 38712 },
    'NS': { max: 5734, threshold: 30828 },
    'NT': { max: 8727, threshold: 45522 },
    'NU': { max: 12303, threshold: 45522 },
    'ON': { max: 6223, threshold: 46330 },
    'PE': { max: 6510, threshold: 36600 },
    // QC max and threshold are confirmed (TP-1015.3-V 2025-01 / MFQ parameters).
    // Two approximations remain, both in the taxpayer's favour: Quebec reduces on
    // net FAMILY income (we only have the individual's), and its claw-back RATE is
    // UNCONFIRMED, so AGE_AMOUNT_REDUCTION_RATE (the federal 15%) is used instead.
    'QC': { max: 3906, threshold: 42090 },
    'SK': { max: 5785, threshold: 43066 },
    'YT': { max: 9028, threshold: 45522 },
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
    const yampe = 81_300 * inflationFactor; // 2025 second earnings ceiling
    const mie = 65_700 * inflationFactor;   // 2025 EI maximum insurable earnings

    // CPP 5.95% = 4.95% base (credit) + 1.00% enhanced (deduction).
    // QPP 6.40% = 5.40% base (credit) + 1.00% enhanced (deduction).
    const baseRate = isQC ? 0.054 : 0.0495;
    const ENHANCED_RATE = 0.01;
    const pensionable = Math.max(0, Math.min(employmentIncome, ympe) - exemption);
    // The second tier is entirely enhanced, so all of it is deductible.
    const tier2 = Math.max(0, Math.min(employmentIncome, yampe) - ympe) * 0.04;

    // Quebec's EI rate is lower because QPIP covers parental benefits separately.
    const eiRate = isQC ? 0.0131 : 0.0164;
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
 * have been frozen since 2004 and are applied to nominal income.
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

    // 2025 thresholds — indexed to inflation annually (unlike the OHP bands above)
    const tier1Threshold = 5710 * inflationFactor;
    const tier2Threshold = 7307 * inflationFactor;

    let surtax = 0;

    // Tier 1: 20% of provincial tax > $5,710
    if (basicProvTax > tier1Threshold) {
        surtax += (basicProvTax - tier1Threshold) * 0.20;
    }

    // Tier 2: 36% of provincial tax > $7,307
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
