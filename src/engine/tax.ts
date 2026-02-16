import type { TaxRates, TaxBracket } from './types';

// 2025 Tax Constants — Updated to confirmed 2025 CRA / provincial values
export const TAX_CONSTANTS: TaxRates = {
    federalBrackets: [
        { threshold: 0, rate: 0.145 },      // Effective 14.5% for 2025 (mid-year cut from 15% to 14%)
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
        federal: 16129, // 2025
        'AB': 22323,
        'BC': 12932,
        'MB': 15780, // Frozen (not indexed), phases out above $200k income
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

export function calculateIncomeTax(
    taxableIncome: number,
    province: string,
    inflationFactor: number = 1.0,
    taxRates: TaxRates = TAX_CONSTANTS,
    age: number = 0,
    eligiblePensionIncome: number = 0, // RRIF, company pension, annuity income
    grossedUpDividends: number = 0 // Dividend income after 38% gross-up
): number {
    const fedTax = calculateTieredTax(taxableIncome, taxRates.federalBrackets, inflationFactor);
    const provTax = calculateTieredTax(taxableIncome, taxRates.provincialBrackets[province] || taxRates.provincialBrackets['ON'], inflationFactor);

    // Indexed Credits
    const fedCredits = (taxRates.basicPersonalAmount.federal * inflationFactor) * 0.15;
    const provRate = (taxRates.provincialBrackets[province] || taxRates.provincialBrackets['ON'])[0].rate;
    const provCredits = (taxRates.basicPersonalAmount[province] || taxRates.basicPersonalAmount['ON']) * inflationFactor * provRate;

    let totalTax = (fedTax - fedCredits) + (provTax - provCredits);

    // --- Pension Income Credit (Federal non-refundable) ---
    // Only applies to eligible pension income: RRIF, company pension, annuity
    // NOT employment income, CPP, OAS, or investment income
    if (eligiblePensionIncome > 0) {
        const maxPensionCredit = 2000 * inflationFactor;
        const eligibleAmount = Math.min(eligiblePensionIncome, maxPensionCredit);
        // Federal: 15% of eligible amount
        totalTax -= eligibleAmount * 0.15;
        // Provincial: ~5% approximation (varies by province)
        totalTax -= eligibleAmount * 0.05;
    }

    // --- Dividend Tax Credit ---
    // For eligible Canadian dividends grossed up by 38%
    // Federal DTC: ~15.02% of grossed-up amount
    // Provincial DTC: varies by province (using simplified rates)
    if (grossedUpDividends > 0) {
        const federalDTC = grossedUpDividends * 0.1502;
        const provincialDTCRates: Record<string, number> = {
            'AB': 0.0812, 'BC': 0.12, 'MB': 0.08, 'NB': 0.14,
            'NL': 0.0635, 'NS': 0.0885, 'NT': 0.1155, 'NU': 0.0551,
            'ON': 0.10, 'PE': 0.1063, 'QC': 0.117, 'SK': 0.11, 'YT': 0.1502
        };
        const provincialDTC = grossedUpDividends * (provincialDTCRates[province] || 0.10);
        totalTax -= (federalDTC + provincialDTC);
    }

    // Age Amount (Federal) — 2025: Max $9,028, reduced by 15% of income > $45,522
    if (age >= 65) {
        const maxClaim = 9028 * inflationFactor;
        const threshold = 45522 * inflationFactor;

        // Reduction is 15% of net income exceeding threshold
        const reduction = Math.max(0, (taxableIncome - threshold) * 0.15);
        const claimable = Math.max(0, maxClaim - reduction);

        // Federal credit value
        totalTax -= claimable * 0.15;

        // Provincial Age Amount (Simplified Approx)
        // Adding ~5% impact for province
        totalTax -= claimable * 0.05;
    }

    // Ontario Health Premium (Simplified table approximation, indexed)
    if (province === 'ON') {
        totalTax += calculateOHP(taxableIncome, inflationFactor);
        totalTax += calculateOntarioSurtax(provTax - provCredits, inflationFactor);
    }

    return Math.max(0, totalTax);
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

function calculateOHP(income: number, inflationFactor: number = 1.0): number {
    // Indexing the bands for OHP
    if (income <= 20000 * inflationFactor) return 0;
    if (income <= 36000 * inflationFactor) return 300;
    if (income <= 48000 * inflationFactor) return 450;
    if (income <= 72000 * inflationFactor) return 600;
    if (income <= 200000 * inflationFactor) return 750;
    return 900;
}

function calculateOntarioSurtax(basicProvTax: number, inflationFactor: number = 1.0): number {
    if (basicProvTax <= 0) return 0;

    // 2025 Thresholds
    const tier1Threshold = 5710 * inflationFactor;
    const tier2Threshold = 7307 * inflationFactor;

    let surtax = 0;

    // Tier 1: 20% of tax > $5,315
    if (basicProvTax > tier1Threshold) {
        surtax += (basicProvTax - tier1Threshold) * 0.20;
    }

    // Tier 2: 36% of tax > $6,802
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
 * Eligible income: RRIF withdrawals, company pension, annuities (NOT CPP/OAS/employment)
 * Requirement: Transferor must be 65+ years old.
 */
export interface SplitPerson {
    taxableIncome: number;
    eligiblePensionIncome: number;
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
    // Calculate baseline taxes (no splitting)
    const p1BaseTax = calculateIncomeTax(
        person1.taxableIncome, province, inflationFactor, undefined,
        person1.age, person1.eligiblePensionIncome, person1.grossedUpDividends
    ) + calculateOASClawback(person1.taxableIncome, person1.oasIncome, inflationFactor);

    const p2BaseTax = calculateIncomeTax(
        person2.taxableIncome, province, inflationFactor, undefined,
        person2.age, person2.eligiblePensionIncome, person2.grossedUpDividends
    ) + calculateOASClawback(person2.taxableIncome, person2.oasIncome, inflationFactor);

    const baselineCombinedTax = p1BaseTax + p2BaseTax;

    // Helper to calculate combined tax after splitting 'amount' from person A to person B
    const calcTaxWithSplit = (fromPerson: SplitPerson, toPerson: SplitPerson, amount: number): number => {
        // Transferor: reduces taxable income and eligible pension income by amount
        const fromNewTaxable = fromPerson.taxableIncome - amount;
        const fromNewPension = fromPerson.eligiblePensionIncome - amount;

        // Recipient: increases taxable income (and gains pension credit eligibility)
        const toNewTaxable = toPerson.taxableIncome + amount;
        const toNewPension = toPerson.eligiblePensionIncome + amount;

        const fromTax = calculateIncomeTax(
            fromNewTaxable, province, inflationFactor, undefined,
            fromPerson.age, fromNewPension, fromPerson.grossedUpDividends
        ) + calculateOASClawback(fromNewTaxable, fromPerson.oasIncome, inflationFactor);

        const toTax = calculateIncomeTax(
            toNewTaxable, province, inflationFactor, undefined,
            toPerson.age, toNewPension, toPerson.grossedUpDividends
        ) + calculateOASClawback(toNewTaxable, toPerson.oasIncome, inflationFactor);

        return fromTax + toTax;
    };

    // Determine who can split (must be 65+ and have eligible pension income)
    const p1CanSplit = person1.age >= 65 && person1.eligiblePensionIncome > 0;
    const p2CanSplit = person2.age >= 65 && person2.eligiblePensionIncome > 0;

    let bestResult: SplitResult = {
        splitAmount: 0,
        fromPerson: 1,
        taxSavings: 0,
        person1NewTax: p1BaseTax,
        person2NewTax: p2BaseTax
    };

    // Try splitting from Person 1 to Person 2
    if (p1CanSplit) {
        const maxSplit = person1.eligiblePensionIncome * 0.5;

        // Binary search for optimal split amount
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

        const optimalAmount = (low + high) / 2;
        const combinedTax = calcTaxWithSplit(person1, person2, optimalAmount);
        const savings = baselineCombinedTax - combinedTax;

        if (savings > bestResult.taxSavings) {
            // Calculate individual new taxes
            const fromNewTaxable = person1.taxableIncome - optimalAmount;
            const fromNewPension = person1.eligiblePensionIncome - optimalAmount;
            const toNewTaxable = person2.taxableIncome + optimalAmount;
            const toNewPension = person2.eligiblePensionIncome + optimalAmount;

            bestResult = {
                splitAmount: optimalAmount,
                fromPerson: 1,
                taxSavings: savings,
                person1NewTax: calculateIncomeTax(fromNewTaxable, province, inflationFactor, undefined, person1.age, fromNewPension, person1.grossedUpDividends) + calculateOASClawback(fromNewTaxable, person1.oasIncome, inflationFactor),
                person2NewTax: calculateIncomeTax(toNewTaxable, province, inflationFactor, undefined, person2.age, toNewPension, person2.grossedUpDividends) + calculateOASClawback(toNewTaxable, person2.oasIncome, inflationFactor)
            };
        }
    }

    // Try splitting from Person 2 to Person 1
    if (p2CanSplit) {
        const maxSplit = person2.eligiblePensionIncome * 0.5;

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

        const optimalAmount = (low + high) / 2;
        const combinedTax = calcTaxWithSplit(person2, person1, optimalAmount);
        const savings = baselineCombinedTax - combinedTax;

        if (savings > bestResult.taxSavings) {
            const fromNewTaxable = person2.taxableIncome - optimalAmount;
            const fromNewPension = person2.eligiblePensionIncome - optimalAmount;
            const toNewTaxable = person1.taxableIncome + optimalAmount;
            const toNewPension = person1.eligiblePensionIncome + optimalAmount;

            bestResult = {
                splitAmount: optimalAmount,
                fromPerson: 2,
                taxSavings: savings,
                person1NewTax: calculateIncomeTax(toNewTaxable, province, inflationFactor, undefined, person1.age, toNewPension, person1.grossedUpDividends) + calculateOASClawback(toNewTaxable, person1.oasIncome, inflationFactor),
                person2NewTax: calculateIncomeTax(fromNewTaxable, province, inflationFactor, undefined, person2.age, fromNewPension, person2.grossedUpDividends) + calculateOASClawback(fromNewTaxable, person2.oasIncome, inflationFactor)
            };
        }
    }

    return bestResult;
}
