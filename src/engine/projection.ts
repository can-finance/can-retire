
import type { Person, SimulationInputs, SimulationResult } from './types';
import { calculateIncomeTax, calculateOASClawback, TAX_CONSTANTS } from './tax';
import { calculateEstimatedCPP, calculateOAS } from './cpp';

// Helper function to simulate a single person's year
interface PersonYearResult {
    taxableIncome: number;
    baseIncomeForNetCash: number; // Income before tax (employment + CPP + OAS + RRIF + Meltdown + extra withdrawal + int + div + realized gains)
    tax: number;
    cppIncome: number;
    oasIncome: number;
    rrifWithdrawal: number;
    voluntaryRRSPWithdrawal: number;
    extraRRSPWithdrawal: number;
    realizedCapGains: number;
    interestIncome: number;
    divIncome: number;
    employmentIncome: number;
    nonRegWithdrawal: number; // Total cash pulled from non-reg (principal + gains)
    tfsaWithdrawal: number;
    investmentIncome: number; // Interest + Dividends Only (Net cash)
}

function simulatePersonYear(
    currentPerson: Person,
    personAge: number,
    targetSpendShare: number, // Share of household spending this person is responsible for
    employmentIncome: number,
    returnRates: { interest: number; dividend: number; capitalGrowth: number },
    province: string,
    inflationFactor: number = 1.0,
    performReactiveActions: boolean = true,
    allowVoluntaryMeltdown: boolean = true
): PersonYearResult {
    // 1. Automatic/Forced Income Sources
    const cppIncome = (personAge >= currentPerson.cppStartAge)
        ? calculateEstimatedCPP(1.0, currentPerson.cppStartAge, TAX_CONSTANTS)
        : 0;

    const oasIncome = calculateOAS(personAge, currentPerson.oasStartAge, inflationFactor);

    // Mandatory RRIF Minimums (starts after 71)
    let rrifWithdrawal = 0;
    if (personAge >= 72) {
        const minFactor = getRRIFMinFactor(personAge);
        rrifWithdrawal = currentPerson.rrsp.balance * minFactor;
        currentPerson.rrsp.balance -= rrifWithdrawal;
    }

    // 2. Voluntary RRSP Meltdown (Proactive Cash Flow)
    let voluntaryRRSPWithdrawal = 0;
    if (allowVoluntaryMeltdown && currentPerson.rrspMeltAmount && currentPerson.rrspMeltAmount > 0) {
        const meltStart = currentPerson.rrspMeltStartAge || currentPerson.retirementAge;
        if (personAge >= meltStart && personAge < 72) {
            voluntaryRRSPWithdrawal = Math.min(currentPerson.rrsp.balance, currentPerson.rrspMeltAmount);
            currentPerson.rrsp.balance -= voluntaryRRSPWithdrawal;
        }
    }

    // 3. Investment Cash Flow (Interest & Dividends)
    const nonRegBalance = currentPerson.nonRegistered.balance;
    const mix = currentPerson.nonRegistered.assetMix;
    const interestIncome = nonRegBalance * mix.interest * returnRates.interest;
    const divIncome = nonRegBalance * mix.dividend * returnRates.dividend;
    const divGrossUp = divIncome * 1.38;

    // 4. Calculate Initial Taxable Position & Net Cash Flow (Indexed)
    const baseTaxable = employmentIncome + cppIncome + oasIncome + rrifWithdrawal + voluntaryRRSPWithdrawal + interestIncome + divGrossUp;
    const baseRecoveryTax = calculateOASClawback(baseTaxable, oasIncome, inflationFactor);
    const baseTax = calculateIncomeTax(baseTaxable, province, inflationFactor) + baseRecoveryTax;

    // Cash from sources before taking from savings
    const baseCashSources = employmentIncome + cppIncome + oasIncome + rrifWithdrawal + voluntaryRRSPWithdrawal + interestIncome + divIncome;
    const baseNetCash = baseCashSources - baseTax;

    // 5. Determine Residual Deficit or Surplus
    let residualDeficit = Math.max(0, targetSpendShare - baseNetCash);
    let residualSurplus = Math.max(0, baseNetCash - targetSpendShare);

    let extraRRSPWithdrawal = 0;
    let realizedCapGains = 0;
    let tfsaWithdrawal = 0;
    let nonRegWithdrawalPrincipal = 0;

    // 6. Reactive Drawdown (if voluntary income wasn't enough)
    if (performReactiveActions && residualDeficit > 0) {
        let remaining = residualDeficit;

        // A. Non-Registered
        if (currentPerson.nonRegistered.balance > 0 && remaining > 0) {
            const available = currentPerson.nonRegistered.balance;
            const take = Math.min(available, remaining);
            const acb = currentPerson.nonRegistered.adjustedCostBase;
            const gainRatio = Math.max(0, 1 - (acb / available));

            realizedCapGains += take * gainRatio;
            nonRegWithdrawalPrincipal += take; // Total take from non-reg is principal + gains

            currentPerson.nonRegistered.adjustedCostBase *= (1 - take / available);
            currentPerson.nonRegistered.balance -= take;
            remaining -= take;
        }

        // B. TFSA
        if (remaining > 0 && currentPerson.tfsa.balance > 0) {
            const available = currentPerson.tfsa.balance;
            const take = Math.min(available, remaining);
            tfsaWithdrawal = take;
            currentPerson.tfsa.balance -= take;
            remaining -= take;
        }

        // C. RRSP
        if (remaining > 0 && currentPerson.rrsp.balance > 0) {
            const take = Math.min(currentPerson.rrsp.balance, remaining / 0.7);
            extraRRSPWithdrawal = take;
            currentPerson.rrsp.balance -= take;
        }
    }

    // 7. Reactive Saving
    if (performReactiveActions && residualSurplus > 0) {
        let remaining = residualSurplus;
        const tfsaLimit = 7000 * inflationFactor; // Index TFSA limit too
        const toTFSA = Math.min(remaining, tfsaLimit);
        currentPerson.tfsa.balance += toTFSA;
        remaining -= toTFSA;

        if (personAge < 71 && employmentIncome > 0) {
            const rrspLimit = Math.min(employmentIncome * 0.18, 31000 * inflationFactor); // Index RRSP limit cap
            const toRRSP = Math.min(remaining, rrspLimit);
            currentPerson.rrsp.balance += toRRSP;
            remaining -= toRRSP;
        }

        currentPerson.nonRegistered.adjustedCostBase += remaining;
        currentPerson.nonRegistered.balance += remaining;
    }

    // 8. Final Tax Recalculation (Indexed)
    const taxableCapGains = realizedCapGains * 0.50;
    const totalRRSPIncome = rrifWithdrawal + voluntaryRRSPWithdrawal + extraRRSPWithdrawal;
    const totalTaxable = employmentIncome + cppIncome + oasIncome + totalRRSPIncome + interestIncome + divGrossUp + taxableCapGains;

    const finalRecoveryTax = calculateOASClawback(totalTaxable, oasIncome, inflationFactor);
    const finalTax = calculateIncomeTax(totalTaxable, province, inflationFactor) + finalRecoveryTax;

    const baseIncomeForNetCash = (employmentIncome + cppIncome + oasIncome + totalRRSPIncome + interestIncome + divIncome + realizedCapGains);

    // 9. Asset Growth for Next Year
    currentPerson.rrsp.balance *= (1 + returnRates.capitalGrowth);
    currentPerson.tfsa.balance *= (1 + returnRates.capitalGrowth);
    currentPerson.nonRegistered.balance *= (1 + (mix.capitalGain * returnRates.capitalGrowth));

    return {
        taxableIncome: totalTaxable,
        baseIncomeForNetCash,
        tax: finalTax,
        cppIncome,
        oasIncome,
        rrifWithdrawal,
        voluntaryRRSPWithdrawal,
        extraRRSPWithdrawal,
        realizedCapGains,
        interestIncome,
        divIncome,
        employmentIncome,
        nonRegWithdrawal: nonRegWithdrawalPrincipal,
        tfsaWithdrawal,
        investmentIncome: interestIncome + divIncome
    };
}

export function runSimulation(inputs: SimulationInputs): SimulationResult[] {
    const results: SimulationResult[] = [];
    const { person, spouse, province, inflationRate, returnRates, preRetirementSpend, postRetirementSpend, useIncomeSplitting, withdrawalStrategy } = inputs;

    let currentPerson = JSON.parse(JSON.stringify(person)) as Person;
    let currentSpouse = spouse ? JSON.parse(JSON.stringify(spouse)) as Person : undefined;

    const startAge = person.age;
    const endAge = Math.max(
        person.lifeExpectancy,
        currentSpouse ? currentSpouse.lifeExpectancy + (currentSpouse.age - person.age) : 0
    );

    for (let yearOffset = 0; yearOffset <= (endAge - startAge); yearOffset++) {
        const personAge = startAge + yearOffset;
        const spouseAge = currentSpouse ? currentSpouse.age + yearOffset : undefined;

        const personAlive = personAge <= person.lifeExpectancy;
        const spouseAlive = currentSpouse && spouseAge && spouseAge <= currentSpouse.lifeExpectancy;

        if (!personAlive && !spouseAlive) break;

        const inflationFactor = Math.pow(1 + inflationRate, yearOffset);
        const isHouseholdRetired = (personAlive ? personAge >= person.retirementAge : true) &&
            (spouseAlive && currentSpouse ? spouseAge! >= currentSpouse.retirementAge : true);

        const householdSpend = isHouseholdRetired
            ? postRetirementSpend * inflationFactor
            : preRetirementSpend * inflationFactor;

        // Assets at START of year for sharing logic
        // (Variables removed as they were unused)

        // Perform individual preliminary income calculations (Taxes / Mandatory withdrawals)
        // Note: targetSpendShare is set to 0 here because we handle the drawdown/saving as a household cluster below
        let pRes = personAlive ? simulatePersonYear(
            currentPerson,
            personAge,
            0,
            personAge < currentPerson.retirementAge ? currentPerson.currentIncome : 0,
            returnRates,
            province,
            inflationFactor,
            false, // Do not perform individual reactive actions (handled by household)
            !(withdrawalStrategy === 'rrsp-first' && personAge >= person.retirementAge) // Disable meltdown if RRSP First & Retired
        ) : null;

        let sRes = (spouseAlive && currentSpouse) ? simulatePersonYear(
            currentSpouse,
            spouseAge!,
            0,
            spouseAge! < currentSpouse.retirementAge ? currentSpouse.currentIncome : 0,
            returnRates,
            province,
            inflationFactor,
            false, // Do not perform individual reactive actions
            !(withdrawalStrategy === 'rrsp-first' && spouseAge! >= currentSpouse.retirementAge) // Disable meltdown if RRSP First & Retired
        ) : null;

        // Household Cash flow after individual mandatory sources and estimated base taxes
        const totalBaseNetCash = (pRes?.baseIncomeForNetCash || 0) + (sRes?.baseIncomeForNetCash || 0) - ((pRes?.tax || 0) + (sRes?.tax || 0));
        let householdDeficit = Math.max(0, householdSpend - totalBaseNetCash);
        let householdSurplus = Math.max(0, totalBaseNetCash - householdSpend);

        // Track final values for result object
        let totalTFSAWithdrawal = 0;
        let totalNonRegWithdrawal = 0;
        let totalRRSPWithdrawal = 0;
        let totalRealizedCapGains = 0;

        // Split tracking for household actions
        let pHouseholdNonReg = 0;
        let sHouseholdNonReg = 0;
        let pHouseholdTFSA = 0;
        let sHouseholdTFSA = 0;

        // 6. Household-Aware Drawdown (Only if spending is not met)
        if (householdDeficit > 0) {
            let remaining = householdDeficit;

            const withdrawNonReg = () => {
                if (remaining <= 0) return;
                const pNonReg = currentPerson.nonRegistered.balance;
                const sNonReg = (spouseAlive && currentSpouse) ? currentSpouse.nonRegistered.balance : 0;
                const totalNonRegAvailable = pNonReg + sNonReg;

                if (totalNonRegAvailable > 0) {
                    const take = Math.min(totalNonRegAvailable, remaining);
                    const pTake = totalNonRegAvailable > 0 ? (pNonReg / totalNonRegAvailable) * take : 0;
                    const sTake = totalNonRegAvailable > 0 ? (sNonReg / totalNonRegAvailable) * take : 0;

                    if (pTake > 0) {
                        const gainRatio = pNonReg > 0 ? Math.max(0, 1 - (currentPerson.nonRegistered.adjustedCostBase / pNonReg)) : 0;
                        totalRealizedCapGains += pTake * gainRatio;
                        totalNonRegWithdrawal += pTake;
                        currentPerson.nonRegistered.adjustedCostBase *= (1 - pTake / pNonReg);
                        currentPerson.nonRegistered.balance -= pTake;
                        if (pRes) pRes.realizedCapGains += pTake * gainRatio;
                        pHouseholdNonReg += pTake;
                    }
                    if (sTake > 0 && currentSpouse) {
                        const gainRatio = sNonReg > 0 ? Math.max(0, 1 - (currentSpouse.nonRegistered.adjustedCostBase / sNonReg)) : 0;
                        totalRealizedCapGains += sTake * gainRatio;
                        totalNonRegWithdrawal += sTake;
                        currentSpouse.nonRegistered.adjustedCostBase *= (1 - sTake / sNonReg);
                        currentSpouse.nonRegistered.balance -= sTake;
                        if (sRes) sRes.realizedCapGains += sTake * gainRatio;
                        sHouseholdNonReg += sTake;
                    }
                    remaining -= take;
                }
            };

            const withdrawTFSA = () => {
                if (remaining <= 0) return;
                const pTFSA = personAlive ? currentPerson.tfsa.balance : 0;
                const sTFSA = (spouseAlive && currentSpouse) ? currentSpouse.tfsa.balance : 0;
                const totalTFSAAvailable = pTFSA + sTFSA;

                if (totalTFSAAvailable > 0) {
                    const take = Math.min(totalTFSAAvailable, remaining);
                    const pTake = totalTFSAAvailable > 0 ? (pTFSA / totalTFSAAvailable) * take : 0;
                    const sTake = totalTFSAAvailable > 0 ? (sTFSA / totalTFSAAvailable) * take : 0;

                    if (pTake > 0) {
                        currentPerson.tfsa.balance -= pTake;
                        totalTFSAWithdrawal += pTake;
                        pHouseholdTFSA += pTake;
                    }
                    if (sTake > 0 && currentSpouse) {
                        currentSpouse.tfsa.balance -= sTake;
                        totalTFSAWithdrawal += sTake;
                        sHouseholdTFSA += sTake;
                    }
                    remaining -= take;
                }
            };

            const withdrawRRSP = () => {
                if (remaining <= 0) return;
                const pRRSP = personAlive ? currentPerson.rrsp.balance : 0;
                const sRRSP = (spouseAlive && currentSpouse) ? currentSpouse.rrsp.balance : 0;
                const totalRRSPAvailable = pRRSP + sRRSP;

                if (totalRRSPAvailable > 0) {
                    const takeNet = Math.min(totalRRSPAvailable * 0.7, remaining);
                    const takeGross = takeNet / 0.7;
                    const pTake = totalRRSPAvailable > 0 ? (pRRSP / totalRRSPAvailable) * takeGross : 0;
                    const sTake = totalRRSPAvailable > 0 ? (sRRSP / totalRRSPAvailable) * takeGross : 0;

                    if (pTake > 0) {
                        currentPerson.rrsp.balance -= pTake;
                        totalRRSPWithdrawal += pTake;
                        if (pRes) pRes.extraRRSPWithdrawal = pTake;
                    }
                    if (sTake > 0 && currentSpouse) {
                        currentSpouse.rrsp.balance -= sTake;
                        totalRRSPWithdrawal += sTake;
                        if (sRes) sRes.extraRRSPWithdrawal = sTake;
                    }
                    remaining -= takeNet;
                }
            };

            if (withdrawalStrategy === 'rrsp-first') {
                withdrawRRSP();
                withdrawNonReg();
                withdrawTFSA();
            } else {
                // Default: Tax-Efficient (Non-Reg -> TFSA -> RRSP)
                withdrawNonReg();
                withdrawTFSA();
                withdrawRRSP();
            }
        }

        // 7. Household-Aware Saving (Only if surplus exists)
        if (householdSurplus > 0) {
            let remaining = householdSurplus;
            const tfsaLimit = 7000 * inflationFactor;

            if (personAlive) {
                const pToTFSA = Math.min(remaining, tfsaLimit);
                currentPerson.tfsa.balance += pToTFSA;
                remaining -= pToTFSA;
            }
            if (spouseAlive && currentSpouse && remaining > 0) {
                const sToTFSA = Math.min(remaining, tfsaLimit);
                currentSpouse.tfsa.balance += sToTFSA;
                remaining -= sToTFSA;
            }

            if (personAlive && remaining > 0 && personAge < 71) {
                const pEmpIncome = personAge < currentPerson.retirementAge ? currentPerson.currentIncome : 0;
                if (pEmpIncome > 0) {
                    const rrspLimit = Math.min(pEmpIncome * 0.18, 31000 * inflationFactor);
                    const toRRSP = Math.min(remaining, rrspLimit);
                    currentPerson.rrsp.balance += toRRSP;
                    remaining -= toRRSP;
                }
            }
            if (spouseAlive && currentSpouse && remaining > 0 && spouseAge! < 71) {
                const sEmpIncome = spouseAge! < currentSpouse.retirementAge ? currentSpouse.currentIncome : 0;
                if (sEmpIncome > 0) {
                    const rrspLimit = Math.min(sEmpIncome * 0.18, 31000 * inflationFactor);
                    const toRRSP = Math.min(remaining, rrspLimit);
                    currentSpouse.rrsp.balance += toRRSP;
                    remaining -= toRRSP;
                }
            }

            if (remaining > 0) {
                if (personAlive) {
                    currentPerson.nonRegistered.balance += remaining;
                    currentPerson.nonRegistered.adjustedCostBase += remaining;
                } else if (spouseAlive && currentSpouse) {
                    currentSpouse.nonRegistered.balance += remaining;
                    currentSpouse.nonRegistered.adjustedCostBase += remaining;
                }
            }
        }

        // 8. Final Tax Recalculation after Household Actions
        if (personAlive && pRes) {
            const totalRRSP = pRes.rrifWithdrawal + pRes.voluntaryRRSPWithdrawal + pRes.extraRRSPWithdrawal;
            const taxableGains = pRes.realizedCapGains * 0.5;
            pRes.taxableIncome = pRes.employmentIncome + pRes.cppIncome + pRes.oasIncome + totalRRSP + pRes.interestIncome + (pRes.divIncome * 1.38) + taxableGains;
            pRes.tax = calculateIncomeTax(pRes.taxableIncome, province, inflationFactor) + calculateOASClawback(pRes.taxableIncome, pRes.oasIncome, inflationFactor);
        }
        if (spouseAlive && sRes) {
            const totalRRSP = sRes.rrifWithdrawal + sRes.voluntaryRRSPWithdrawal + sRes.extraRRSPWithdrawal;
            const taxableGains = sRes.realizedCapGains * 0.5;
            sRes.taxableIncome = sRes.employmentIncome + sRes.cppIncome + sRes.oasIncome + totalRRSP + sRes.interestIncome + (sRes.divIncome * 1.38) + taxableGains;
            sRes.tax = calculateIncomeTax(sRes.taxableIncome, province, inflationFactor) + calculateOASClawback(sRes.taxableIncome, sRes.oasIncome, inflationFactor);
        }

        let totalTax = (pRes?.tax || 0) + (sRes?.tax || 0);

        // 9. Apply Income Splitting & Final Statistics
        if (useIncomeSplitting && personAlive && spouseAlive && pRes && sRes) {
            const pSplittable = pRes.rrifWithdrawal + pRes.voluntaryRRSPWithdrawal + pRes.extraRRSPWithdrawal + pRes.cppIncome;
            const sSplittable = sRes.rrifWithdrawal + sRes.voluntaryRRSPWithdrawal + sRes.extraRRSPWithdrawal + sRes.cppIncome;
            const totalSplittable = pSplittable + sSplittable;

            const pNonSplittable = pRes.taxableIncome - pSplittable;
            const sNonSplittable = sRes.taxableIncome - sSplittable;

            let idealX = (totalSplittable + sNonSplittable - pNonSplittable) / 2;
            const pIdealShift = pSplittable - idealX;
            const maxPToS = pSplittable * 0.5;
            const maxSToP = sSplittable * 0.5;
            const actualShift = Math.max(-maxSToP, Math.min(maxPToS, pIdealShift));

            const pAdjTaxable = pRes.taxableIncome - actualShift;
            const sAdjTaxable = sRes.taxableIncome + actualShift;

            const pNewTax = calculateIncomeTax(pAdjTaxable, province, inflationFactor) + calculateOASClawback(pAdjTaxable, pRes.oasIncome, inflationFactor);
            const sNewTax = calculateIncomeTax(sAdjTaxable, province, inflationFactor) + calculateOASClawback(sAdjTaxable, sRes.oasIncome, inflationFactor);

            totalTax = pNewTax + sNewTax;
        }

        // Final assets at END of year for record
        const finalPersonAssets = personAlive ? (currentPerson.rrsp.balance + currentPerson.tfsa.balance + currentPerson.nonRegistered.balance) : 0;
        const finalSpouseAssets = (spouseAlive && currentSpouse) ? (currentSpouse.rrsp.balance + currentSpouse.tfsa.balance + currentSpouse.nonRegistered.balance) : 0;

        results.push({
            year: new Date().getFullYear() + yearOffset,
            age: personAge,
            spouseAge: spouseAge,
            totalAssets: finalPersonAssets + finalSpouseAssets,
            grossIncome: (pRes?.taxableIncome || 0) + (sRes?.taxableIncome || 0),
            cppIncome: (pRes?.cppIncome || 0) + (sRes?.cppIncome || 0),
            oasIncome: (pRes?.oasIncome || 0) + (sRes?.oasIncome || 0),
            netIncome: ((pRes?.employmentIncome || 0) + (sRes?.employmentIncome || 0) +
                (pRes?.cppIncome || 0) + (sRes?.cppIncome || 0) +
                (pRes?.oasIncome || 0) + (sRes?.oasIncome || 0) +
                totalRRSPWithdrawal +
                (pRes?.investmentIncome || 0) + (sRes?.investmentIncome || 0) +
                totalNonRegWithdrawal +
                totalTFSAWithdrawal) - totalTax - householdSurplus,
            spending: householdSpend,
            taxPaid: totalTax,
            accounts: {
                rrsp: personAlive ? currentPerson.rrsp.balance : 0,
                tfsa: personAlive ? currentPerson.tfsa.balance : 0,
                nonRegistered: personAlive ? currentPerson.nonRegistered.balance : 0,
                nonRegisteredACB: personAlive ? currentPerson.nonRegistered.adjustedCostBase : 0
            },
            spouseAccounts: spouseAlive && currentSpouse ? {
                rrsp: currentSpouse.rrsp.balance,
                tfsa: currentSpouse.tfsa.balance,
                nonRegistered: currentSpouse.nonRegistered.balance,
                spouseNonRegisteredACB: currentSpouse.nonRegistered.adjustedCostBase
            } : undefined,
            totalTFSAWithdrawal,
            totalNonRegWithdrawal,
            totalRRSPWithdrawal: (pRes?.rrifWithdrawal || 0) + (pRes?.voluntaryRRSPWithdrawal || 0) + (pRes?.extraRRSPWithdrawal || 0) + (sRes?.rrifWithdrawal || 0) + (sRes?.voluntaryRRSPWithdrawal || 0) + (sRes?.extraRRSPWithdrawal || 0),

            // Split Sources
            personTFSAWithdrawal: (pRes?.tfsaWithdrawal || 0) + pHouseholdTFSA,
            spouseTFSAWithdrawal: (sRes?.tfsaWithdrawal || 0) + sHouseholdTFSA,
            personNonRegWithdrawal: (pRes?.nonRegWithdrawal || 0) + pHouseholdNonReg,
            spouseNonRegWithdrawal: (sRes?.nonRegWithdrawal || 0) + sHouseholdNonReg,
            personRRSPWithdrawal: (pRes?.rrifWithdrawal || 0) + (pRes?.voluntaryRRSPWithdrawal || 0) + (pRes?.extraRRSPWithdrawal || 0),
            spouseRRSPWithdrawal: (sRes?.rrifWithdrawal || 0) + (sRes?.voluntaryRRSPWithdrawal || 0) + (sRes?.extraRRSPWithdrawal || 0),

            employmentIncome: (pRes?.employmentIncome || 0) + (sRes?.employmentIncome || 0),
            investmentIncome: (pRes?.investmentIncome || 0) + (sRes?.investmentIncome || 0),
            totalRealizedCapGains,
            inflationFactor,
            householdSurplus
        });
    }

    return results;
}

// Federal RRIF Minimum Withdrawal Factors (Post-2015)
const RRIF_MINIMUMS: { [age: number]: number } = {
    71: 0.0528, 72: 0.0540, 73: 0.0553, 74: 0.0567, 75: 0.0582,
    76: 0.0598, 77: 0.0617, 78: 0.0636, 79: 0.0658, 80: 0.0682,
    81: 0.0708, 82: 0.0738, 83: 0.0771, 84: 0.0808, 85: 0.0851,
    86: 0.0899, 87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192,
    91: 0.1306, 92: 0.1449, 93: 0.1634, 94: 0.1879
};

function getRRIFMinFactor(age: number): number {
    if (age <= 70) return 0.05; // Simplified placeholder for early conversion
    if (age >= 95) return 0.20;
    return RRIF_MINIMUMS[age] || 0.06; // Fallback should unlikely be hit
}
