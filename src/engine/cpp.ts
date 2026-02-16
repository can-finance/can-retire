// import type { TaxRates } from './types'; // Unused

export function calculateEstimatedCPP(
    yearsContributed: number, // Max 40
    startAge: number,
    _taxConstants: any, // TaxRates unused for now as we hardcoded max
    inflationFactor: number = 1.0
): number {
    // 2025 Max CPP at 65 is $1,433/month -> $17,196/year
    const maxAnnualCPP = 17196 * inflationFactor;

    // Calculate Percent of Max based on contribution years (approximate drop-out provision logic is complex, simple linear here)
    // Max roughly 40 years needed for full pension
    const percentOfMax = Math.min(1.0, Math.max(0, yearsContributed / 40));

    // Adjust for age
    // 65 is standard
    // < 65: -0.6% per month (-7.2% per year)
    // > 65: +0.7% per month (+8.4% per year)

    const monthsDiff = (startAge - 65) * 12;
    let adjustmentFactor = 1.0;

    if (monthsDiff < 0) {
        // Early
        adjustmentFactor = 1.0 - (Math.abs(monthsDiff) * 0.006);
    } else if (monthsDiff > 0) {
        // Late
        adjustmentFactor = 1.0 + (monthsDiff * 0.007);
    }

    return maxAnnualCPP * percentOfMax * adjustmentFactor;
}

export function calculateOAS(age: number, startAge: number, inflationFactor: number = 1.0): number {
    if (age < startAge) return 0;

    // 2025 Base OAS at 65: ~$735/month -> $8,820/yr
    let baseOAS = 8820 * inflationFactor; // Index the base benefit

    // Deferral bonus: 0.6% per month after 65, up to 70.
    // (startAge - 65) * 12 * 0.006
    if (startAge > 65) {
        const monthsDelayed = Math.min((startAge - 65) * 12, 60); // Max 60 months
        baseOAS = baseOAS * (1 + (monthsDelayed * 0.006));
    }

    if (age >= 75) {
        return baseOAS * 1.10;
    }

    return baseOAS;
}
