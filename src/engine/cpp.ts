// import type { TaxRates } from './types'; // Unused

export function calculateEstimatedCPP(
    percentOfMax: number, // 0 to 1
    startAge: number,
    _taxConstants: any, // TaxRates unused for now as we hardcoded max
    inflationFactor: number = 1.0
): number {
    // 2024 Max CPP at 65 is roughly $1364.60/month -> ~$16,375/year
    const maxAnnualCPP = 16375 * inflationFactor;

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

    // Cap adjustment? -36% (at 60) to +42% (at 70)
    // Formula handles this naturally if ages constrained 60-70.

    return maxAnnualCPP * percentOfMax * adjustmentFactor;
}

export function calculateOAS(age: number, startAge: number, inflationFactor: number = 1.0): number {
    if (age < startAge) return 0;

    // 2024 Base OAS at 65: ~$713.34/month -> $8560/yr
    // Plus 10% boost at 75
    let baseOAS = 8560 * inflationFactor; // Index the base benefit

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
