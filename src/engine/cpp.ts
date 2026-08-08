export function calculateEstimatedCPP(
    yearsContributed: number, // Max 40
    startAge: number,
    inflationFactor: number = 1.0
): number {
    // 2026 Max CPP at 65 is $1,507.65/month -> $18,092/year. Unlike the base-only
    // figure the detailed calculator derives (cppDetailed.ts), this is the total
    // maximum including the post-2019 enhancement.
    const maxAnnualCPP = 18092 * inflationFactor;

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

    // 2026 Base OAS at 65: ~$752/month -> $9,024/yr. Kept in step with
    // TAX_CONSTANTS.oas.maxAnnualBenefit (tax.ts) — the two must not drift.
    let baseOAS = 9024 * inflationFactor; // Index the base benefit

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
