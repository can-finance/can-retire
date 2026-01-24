import type { TaxRates, TaxBracket } from './types';

// Approximate 2025 constants (using 2024 for baseline stability where 25 not fully confirmed)
export const TAX_CONSTANTS: TaxRates = {
    federalBrackets: [
        { threshold: 0, rate: 0.15 },
        { threshold: 55867, rate: 0.205 },
        { threshold: 111733, rate: 0.26 },
        { threshold: 173205, rate: 0.29 },
        { threshold: 246752, rate: 0.33 },
    ],
    provincialBrackets: {
        'AB': [
            { threshold: 0, rate: 0.10 },
            { threshold: 157978, rate: 0.12 },
            { threshold: 189574, rate: 0.13 },
            { threshold: 252765, rate: 0.14 },
            { threshold: 379148, rate: 0.15 },
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
            { threshold: 47000, rate: 0.1275 }, // Approx 2024/25
            { threshold: 100000, rate: 0.174 },
        ],
        'NB': [
            { threshold: 0, rate: 0.094 },
            { threshold: 51306, rate: 0.14 },
            { threshold: 102614, rate: 0.16 },
            { threshold: 190060, rate: 0.195 },
        ],
        'NL': [
            { threshold: 0, rate: 0.087 },
            { threshold: 44192, rate: 0.145 },
            { threshold: 88382, rate: 0.158 },
            { threshold: 157792, rate: 0.178 },
            { threshold: 220910, rate: 0.198 },
            { threshold: 282214, rate: 0.208 },
            { threshold: 564429, rate: 0.213 },
            { threshold: 1128858, rate: 0.218 },
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
        federal: 15705, // 2024
        'AB': 21885,
        'BC': 12588,
        'MB': 15780,
        'NB': 13044,
        'NL': 10818,
        'NS': 11481, // Simplified (varies by income)
        'NT': 17373,
        'NU': 18767,
        'ON': 12399,
        'PE': 13500,
        'QC': 18056,
        'SK': 18491,
        'YT': 15705,
    },
    cpp: {
        maxPensionableEarnings: 68500, // 2024
        basicExemption: 3500,
        maxContribution: 3867
    },
    oas: {
        maxAnnualBenefit: 8560, // Approx 2024 annualized
        clawbackThreshold: 90997 // 2024
    }
};

export function calculateIncomeTax(
    taxableIncome: number,
    province: string,
    inflationFactor: number = 1.0,
    taxRates: TaxRates = TAX_CONSTANTS
): number {
    const fedTax = calculateTieredTax(taxableIncome, taxRates.federalBrackets, inflationFactor);
    const provTax = calculateTieredTax(taxableIncome, taxRates.provincialBrackets[province] || taxRates.provincialBrackets['ON'], inflationFactor);

    // Indexed Credits
    const fedCredits = (taxRates.basicPersonalAmount.federal * inflationFactor) * 0.15;
    const provRate = (taxRates.provincialBrackets[province] || taxRates.provincialBrackets['ON'])[0].rate;
    const provCredits = (taxRates.basicPersonalAmount[province] || taxRates.basicPersonalAmount['ON']) * inflationFactor * provRate;

    let totalTax = (fedTax - fedCredits) + (provTax - provCredits);

    // Age and Pension Credits (Approximation)
    // Most Canadian tax software/models use these.
    // If taxable income is significantly high, we assume some RRSP is pension income.
    if (taxableIncome > 2000 * inflationFactor) {
        totalTax -= 2000 * inflationFactor * 0.20; // $2k pension credit at ~20% combined rate
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

    // 2024 Thresholds
    const tier1Threshold = 5315 * inflationFactor;
    const tier2Threshold = 6802 * inflationFactor;

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
