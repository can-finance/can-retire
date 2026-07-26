import { totalNonRegBalance } from '../engine/projection';
import type { SimulationInputs, SimulationResult } from '../engine/types';

export interface SummaryMetrics {
    estate: number;
    estateTax: number;
    annualTaxRetirement: number;
    effectiveTaxRateRetirement: number;
    effectiveTaxRateEstate: number;
    totalEffectiveTaxRate: number;
    totalTaxPlusEstate: number;
    totalRetirementIncome: number;
    netRetirementIncome: number;
    netEstateValue: number;
    totalNetValue: number;
    initialWithdrawalRate: number;
    outOfMoneyAge: number | null;
    totalShortfall: number;
    totalSpending: number; // Lifetime spending actually funded (desired minus shortfall)
    lifetimeTaxPaid: number;
    lifetimeOASClawback: number; // Lifetime OAS recovery tax (already inside lifetimeTaxPaid)
    // Household RRSP/RRIF balance at the END of the year the PRIMARY person turns 71.
    // Age 71 is the last voluntary-melt year (the engine melts while `age < 72`), so this
    // is the balance entering the mandatory-RRIF regime. `r.age` is the primary person's
    // age, so for a couple the spouse's own 71 may land in a different calendar year —
    // this is a household total sampled on the primary's clock, not a per-person figure.
    // null when no result row has age 71 (already past 71 at plan start, or dies first).
    rrspBalanceAt71: number | null;
    lifetimeNetCPP: number;
    lifetimeNetOAS: number;
    lifetimeNetPension: number;
    lifetimeNetInvestment: number;
    lifetimeNetEmployment: number;
    lifetimeRealizedGainsNet: number; // Living non-reg gains realized minus their cap-gains tax
    deemedGainsAtDeath: number;       // Gross gains deemed disposed at death (tax counted in estateTax)
}

export function computeSummaryMetrics(results: SimulationResult[], inputs: SimulationInputs, isInflationAdjusted: boolean): SummaryMetrics {
    // Guard: Return default metrics if no simulation results
    if (results.length === 0) {
        return {
            estate: 0,
            estateTax: 0,
            annualTaxRetirement: 0,
            effectiveTaxRateRetirement: 0,
            effectiveTaxRateEstate: 0,
            totalEffectiveTaxRate: 0,
            totalTaxPlusEstate: 0,
            totalRetirementIncome: 0,
            netRetirementIncome: 0,
            netEstateValue: 0,
            totalNetValue: 0,
            initialWithdrawalRate: 0,
            outOfMoneyAge: null as number | null,
            totalShortfall: 0,
            totalSpending: 0,
            lifetimeTaxPaid: 0,
            lifetimeOASClawback: 0,
            rrspBalanceAt71: null as number | null,
            lifetimeNetCPP: 0,
            lifetimeNetOAS: 0,
            lifetimeNetPension: 0,
            lifetimeNetInvestment: 0,
            lifetimeNetEmployment: 0,
            lifetimeRealizedGainsNet: 0,
            deemedGainsAtDeath: 0
        };
    }

    const lastYear = results[results.length - 1];
    const retirementResults = results.filter(r => r.age >= inputs.person.retirementAge);

    // Inflation adjustment helper
    const adj = (val: number, factor: number) => isInflationAdjusted ? val / factor : val;

    const annualTaxRetirement = retirementResults.reduce((acc, curr) => acc + adj(curr.taxPaid, curr.inflationFactor), 0);
    const totalRetirementIncome = retirementResults.reduce((acc, curr) => acc + adj(curr.grossIncome, curr.inflationFactor), 0);

    // Terminal tax is now calculated by the engine and includes:
    // - Deemed disposition of RRSP/RRIF at death (if no surviving spouse)
    // - Capital gains on unrealized Non-Reg gains at death
    // - Proper spouse rollover logic (tax-free transfer if spouse survives)
    const estateTax = lastYear.totalTerminalTax || 0;

    // Convert final estate values to real dollars if needed.
    // The engine reports both halves already reconciled: `grossEstateValue` is the
    // estate BEFORE terminal tax and `netEstateValue` is what is left after it, so
    // read each straight through rather than subtracting the tax a second time.
    const estateValue = adj(lastYear.grossEstateValue || lastYear.totalAssets, lastYear.inflationFactor);
    const adjustedEstateTax = adj(estateTax, lastYear.inflationFactor);

    const totalTaxPlusEstate = annualTaxRetirement + adjustedEstateTax;

    const effectiveTaxRateRetirement = totalRetirementIncome > 0 ? (annualTaxRetirement / totalRetirementIncome) * 100 : 0;
    // A shortfall year is one where the engine could not fund target spending
    const firstShortfallYear = results.find(r => r.shortfall > 1);
    const outOfMoneyAge = firstShortfallYear ? firstShortfallYear.age : null;
    const totalShortfall = results.reduce((acc, curr) => acc + adj(curr.shortfall, curr.inflationFactor), 0);
    const totalSpending = results.reduce((acc, curr) => acc + adj(curr.spending - curr.shortfall, curr.inflationFactor), 0);

    const effectiveTaxRateEstate = estateValue > 0 ? (adjustedEstateTax / estateValue) * 100 : 0;
    const totalEffectiveTaxRate = (totalRetirementIncome + estateValue) > 0 ? (totalTaxPlusEstate / (totalRetirementIncome + estateValue)) * 100 : 0;

    // Withdrawal Rate Calculation
    let initialWithdrawalRate = 0;
    const retirementIndex = results.findIndex(r => r.age === inputs.person.retirementAge);

    // If retirementIndex > 0, use that year for withdrawals with previous year's assets as base.
    // Otherwise (already retired), use input balances as starting assets.
    if (retirementIndex > 0) {
        const firstRetYear = results[retirementIndex];
        const prevYear = results[retirementIndex - 1];
        const totalWithdrawal = firstRetYear.totalRRSPWithdrawal + firstRetYear.totalTFSAWithdrawal + firstRetYear.totalNonRegWithdrawal;
        if (prevYear.totalAssets > 0) {
            initialWithdrawalRate = (totalWithdrawal / prevYear.totalAssets) * 100;
        }
    } else {
        const firstRetYear = results[0];
        const personNonReg = totalNonRegBalance(inputs.person);
        const spouseNonReg = inputs.spouse ? totalNonRegBalance(inputs.spouse) : 0;
        const startAssets =
            inputs.person.rrsp.balance +
            inputs.person.tfsa.balance +
            personNonReg +
            (inputs.spouse ? (inputs.spouse.rrsp.balance + inputs.spouse.tfsa.balance + spouseNonReg) : 0);

        if (firstRetYear && startAssets > 0) {
            const totalWithdrawal = firstRetYear.totalRRSPWithdrawal + firstRetYear.totalTFSAWithdrawal + firstRetYear.totalNonRegWithdrawal;
            initialWithdrawalRate = (totalWithdrawal / startAssets) * 100;
        }
    }

    const netRetirementIncome = totalRetirementIncome - annualTaxRetirement;
    // Straight from the engine (see the estate comment above) — NOT estateValue minus
    // the tax again. The fallback mirrors the `estateValue` fallback: with no engine
    // figure there is no terminal tax to net off either.
    const netEstateValue = adj(lastYear.netEstateValue ?? lastYear.totalAssets, lastYear.inflationFactor);
    const totalNetValue = netRetirementIncome + netEstateValue;

    const lifetimeTaxPaid = results.reduce((acc, curr) => acc + adj(curr.taxPaid, curr.inflationFactor), 0) + adjustedEstateTax;
    const lifetimeOASClawback = results.reduce((acc, curr) => acc + adj(curr.oasClawbackPaid, curr.inflationFactor), 0);
    // See the interface comment: age 71 is the last voluntary-melt year (`age < 72`),
    // and `r.age` tracks the primary person only.
    const rowAt71 = results.find(r => r.age === 71);
    const rrspBalanceAt71 = rowAt71
        ? adj(rowAt71.accounts.rrsp + (rowAt71.spouseAccounts?.rrsp ?? 0), rowAt71.inflationFactor)
        : null;
    const lifetimeNetCPP = results.reduce((acc, curr) => acc + adj(curr.netCPPIncome, curr.inflationFactor), 0);
    const lifetimeNetOAS = results.reduce((acc, curr) => acc + adj(curr.netOASIncome, curr.inflationFactor), 0);
    const lifetimeNetPension = results.reduce((acc, curr) => acc + adj(curr.netPensionIncome, curr.inflationFactor), 0);
    const lifetimeNetInvestment = results.reduce((acc, curr) => acc + adj(curr.netInvestmentIncome, curr.inflationFactor), 0);
    const lifetimeNetEmployment = results.reduce((acc, curr) => acc + adj(curr.netEmploymentIncome, curr.inflationFactor), 0);
    // Living realized gains net of the cap-gains tax attributed to them. capGainsTaxPaid
    // is living-only (terminal cap-gains tax lives in totalTerminalTax/estateTax), so the
    // per-year difference is the net gain; sum the raw differences without per-year clamping.
    const lifetimeRealizedGainsNet = results.reduce((acc, curr) => acc + adj(curr.totalRealizedCapGains - curr.capGainsTaxPaid, curr.inflationFactor), 0);
    // Gross gains deemed disposed at death (their tax is already inside estateTax).
    const deemedGainsAtDeath = results.reduce((acc, curr) => acc + adj(curr.terminalRealizedGains, curr.inflationFactor), 0);

    return {
        estate: estateValue,
        annualTaxRetirement,
        estateTax: adjustedEstateTax,
        totalTaxPlusEstate,
        effectiveTaxRateRetirement,
        effectiveTaxRateEstate,
        totalEffectiveTaxRate,
        totalRetirementIncome,
        netRetirementIncome,
        netEstateValue,
        totalNetValue,
        outOfMoneyAge,
        initialWithdrawalRate,
        totalShortfall,
        totalSpending,
        lifetimeTaxPaid,
        lifetimeOASClawback,
        rrspBalanceAt71,
        lifetimeNetCPP,
        lifetimeNetOAS,
        lifetimeNetPension,
        lifetimeNetInvestment,
        lifetimeNetEmployment,
        lifetimeRealizedGainsNet,
        deemedGainsAtDeath
    };
}
