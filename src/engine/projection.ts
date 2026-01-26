
import type { Person, SimulationInputs, SimulationResult, MonteCarloResult, MonteCarloPercentile } from './types';
import { calculateIncomeTax, calculateOASClawback, TAX_CONSTANTS } from './tax';
import { calculateEstimatedCPP, calculateOAS } from './cpp';

// --- Helper Types for Internal engine calculation ---

// Standard Normal Distribution Generator (Mean 0, StdDev 1)
function boxMullerRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

interface PersonAnnualBase {
    taxableIncome: number;
    tax: number;
    cppIncome: number;
    oasIncome: number;
    rrifWithdrawal: number;
    voluntaryRRSPWithdrawal: number;
    interestIncome: number;
    divIncome: number;
    employmentIncome: number;
    investmentIncomeNet: number; // Interest + Dividends (After Tax share approx)
    baseNetCash: number; // Employment + CPP/OAS + RRIF/Melt + Invest (Net)
}

// --- Helper: Solve Gross Withdrawal from Net Needed ---
// Given a person's current taxable income, province, and a desired *NET* amount to extract,
// calculate the required Gross RRSP withdrawal (accounting for marginal tax and OAS clawback).
function solveGrossWithdrawal(
    targetNet: number,
    currentTaxable: number,
    baseOAS: number, // Need this to check clawback impact
    province: string,
    inflationFactor: number,
    age: number
): { gross: number, tax: number } {
    if (targetNet <= 0) return { gross: 0, tax: 0 };

    // Iterative Solver (Newton-Raphson-ish or Binary Search)
    // Since tax function is piecewise linear but complex, binary search is safer/easier.
    let low = targetNet; // Minimum gross is the net itself (0% tax)
    let high = targetNet * 3; // Upper bound guess (assumes < 66% tax rate)

    // Quick sanity check for huge amounts
    if (high > 10_000_000) high = 10_000_000;

    // Tolerance $1
    for (let i = 0; i < 20; i++) {
        const mid = (low + high) / 2;
        const addedTaxable = mid;

        // Calculate tax with this specific add-on
        const newTaxable = currentTaxable + addedTaxable;
        const newClawback = calculateOASClawback(newTaxable, baseOAS, inflationFactor);
        const newTax = calculateIncomeTax(newTaxable, province, inflationFactor, undefined, age) + newClawback;

        const originalClawback = calculateOASClawback(currentTaxable, baseOAS, inflationFactor);
        const originalTax = calculateIncomeTax(currentTaxable, province, inflationFactor, undefined, age) + originalClawback;

        const marginalTax = newTax - originalTax;
        const netResult = mid - marginalTax;

        if (Math.abs(netResult - targetNet) < 1) {
            return { gross: mid, tax: marginalTax };
        }

        if (netResult < targetNet) {
            low = mid;
        } else {
            high = mid;
        }
    }

    // Fallback if not perfectly converged
    const gross = (low + high) / 2;
    const newTaxable = currentTaxable + gross;
    const marginalTax = (calculateIncomeTax(newTaxable, province, inflationFactor, undefined, age) + calculateOASClawback(newTaxable, baseOAS, inflationFactor)) -
        (calculateIncomeTax(currentTaxable, province, inflationFactor, undefined, age) + calculateOASClawback(currentTaxable, baseOAS, inflationFactor));

    return { gross, tax: marginalTax };
}

// --- Simulation Logic ---

function simulatePersonBaseYear(
    person: Person,
    age: number,
    province: string,
    returnRates: { interest: number; dividend: number; capitalGrowth: number },
    inflationFactor: number
): PersonAnnualBase {
    // 1. Mandatory Income Sources
    const cppIncome = (age >= person.cppStartAge)
        ? calculateEstimatedCPP(person.cppContributedYears ?? 40, person.cppStartAge, TAX_CONSTANTS, inflationFactor)
        : 0;

    const oasIncome = calculateOAS(age, person.oasStartAge, inflationFactor);

    // RRIF Minimums
    let rrifWithdrawal = 0;
    if (age >= 72) {
        const minFactor = getRRIFMinFactor(age);
        rrifWithdrawal = person.rrsp.balance * minFactor;
        person.rrsp.balance -= rrifWithdrawal; // Deduct immediately
    }

    // Voluntary Meltdown (Pre-calculated fixed gross)
    let voluntaryRRSPWithdrawal = 0;
    const meltStart = person.rrspMeltStartAge || person.retirementAge;
    if (person.rrspMeltAmount && person.rrspMeltAmount > 0 && age >= meltStart && age < 72) {
        voluntaryRRSPWithdrawal = Math.min(person.rrsp.balance, person.rrspMeltAmount);
        person.rrsp.balance -= voluntaryRRSPWithdrawal;
    }

    // Investment Income (Interest & Divs)
    const nonRegBalance = person.nonRegistered.balance;
    const mix = person.nonRegistered.assetMix;
    const interestIncome = nonRegBalance * mix.interest * returnRates.interest;
    const divIncome = nonRegBalance * mix.dividend * returnRates.dividend;
    const divGrossUp = divIncome * 1.38;

    // Employment
    const employmentIncome = (age < person.retirementAge) ? person.currentIncome : 0;

    // Calculate Base Tax
    const baseTaxable = employmentIncome + cppIncome + oasIncome + rrifWithdrawal + voluntaryRRSPWithdrawal + interestIncome + divGrossUp;
    const oasRecovery = calculateOASClawback(baseTaxable, oasIncome, inflationFactor);
    const totalTax = calculateIncomeTax(baseTaxable, province, inflationFactor, undefined, age) + oasRecovery;

    // Net Cash Calculation
    // Total Cash In = Emp + CPP + OAS + RRIF + Melt + Int + Div
    // Note: Div is actual cash, not gross up.
    const totalCashIn = employmentIncome + cppIncome + oasIncome + rrifWithdrawal + voluntaryRRSPWithdrawal + interestIncome + divIncome;
    const baseNetCash = totalCashIn - totalTax;

    return {
        taxableIncome: baseTaxable,
        tax: totalTax,
        cppIncome,
        oasIncome,
        rrifWithdrawal,
        voluntaryRRSPWithdrawal,
        interestIncome,
        divIncome,
        employmentIncome,
        investmentIncomeNet: (interestIncome + divIncome), // This is gross investment cash, we deduct tax globally later
        baseNetCash
    };
}

export function runSimulation(inputs: SimulationInputs, stochastic: boolean = false): SimulationResult[] {
    const results: SimulationResult[] = [];
    const { person, spouse, province, inflationRate, returnRates, preRetirementSpend, postRetirementSpend, withdrawalStrategy } = inputs;

    // Guard: Return empty if invalid age configuration
    if (person.age >= person.lifeExpectancy) return results;
    if (person.age < 0 || person.lifeExpectancy < 0) return results;
    if (person.retirementAge > person.lifeExpectancy) return results;
    if (isNaN(person.age) || isNaN(person.lifeExpectancy)) return results;

    // Spouse guards
    if (spouse) {
        if (spouse.age >= spouse.lifeExpectancy) return results;
        if (spouse.age < 0 || spouse.lifeExpectancy < 0) return results;
        if (spouse.retirementAge > spouse.lifeExpectancy) return results;
        if (isNaN(spouse.age) || isNaN(spouse.lifeExpectancy)) return results;
    }

    // Deep copy to avoid mutating inputs
    const p = JSON.parse(JSON.stringify(person)) as Person;
    const s = spouse ? JSON.parse(JSON.stringify(spouse)) as Person : undefined;

    const startAge = p.age;
    const endAge = Math.max(
        p.lifeExpectancy,
        s ? s.lifeExpectancy + (s.age - p.age) : 0
    );

    // Guard: Prevent infinite loops
    if (endAge - startAge > 120) return results;

    for (let yearOffset = 0; yearOffset <= (endAge - startAge); yearOffset++) {
        const pAge = startAge + yearOffset;
        const sAge = s ? s.age + yearOffset : undefined;

        const pAlive = pAge <= p.lifeExpectancy;
        const sAlive = s && sAge && sAge <= s.lifeExpectancy;

        if (!pAlive && !sAlive) break;

        const inflationFactor = Math.pow(1 + inflationRate, yearOffset);


        const isRetired = (pAlive ? pAge >= p.retirementAge : true) &&
            (sAlive && sAge ? sAge >= s.retirementAge : true);

        // One-time expenses for this year
        const annualOneTimeExpenses = (inputs.oneTimeExpenses || [])
            .filter(e => e.age === pAge)
            .reduce((sum, e) => sum + e.amount, 0);

        const targetSpend = ((isRetired ? postRetirementSpend : preRetirementSpend) * inflationFactor) + annualOneTimeExpenses;

        // --- Determine Returns for this Year ---
        let currentYearRates = returnRates;
        if (stochastic && returnRates.volatility) {
            // Apply volatility to Capital Growth
            // Simple model: Return = Mean + (Vol * Z)
            const z = boxMullerRandom();
            currentYearRates = {
                ...returnRates,
                capitalGrowth: returnRates.capitalGrowth + (returnRates.volatility * z)
            };
        }

        // --- Step 1: Base Income & Mandatory Flows ---
        const pBase = pAlive ? simulatePersonBaseYear(p, pAge, province, currentYearRates, inflationFactor) : null;
        const sBase = sAlive && s ? simulatePersonBaseYear(s, sAge!, province, currentYearRates, inflationFactor) : null;

        const householdBaseNet = (pBase?.baseNetCash || 0) + (sBase?.baseNetCash || 0);

        // --- Step 2: Gap Analysis ---
        let surplus = 0;
        let deficit = 0;

        if (householdBaseNet >= targetSpend) {
            surplus = householdBaseNet - targetSpend;
        } else {
            deficit = targetSpend - householdBaseNet;
        }

        // Tracking Drawdowns
        let pExtraRRSPGross = 0; let sExtraRRSPGross = 0;
        let pTFSAWithdrawal = 0; let sTFSAWithdrawal = 0;
        let pNonRegWithdrawal = 0; let sNonRegWithdrawal = 0;
        let pRealizedGains = 0; let sRealizedGains = 0;

        // Tracking Reinvestment
        let reinvestedTFSA = 0;
        let reinvestedRRSP = 0;
        let reinvestedNonReg = 0;

        // --- Step 3: Deficit Resolution (Filling the Gap) ---
        if (deficit > 0) {
            let remainingDeficit = deficit;

            // Strategy Helper
            const withdrawNonReg = () => {
                if (remainingDeficit <= 0) return;
                // Household Non-Reg Pool
                const pBal = pAlive ? p.nonRegistered.balance : 0;
                const sBal = sAlive && s ? s.nonRegistered.balance : 0;
                const total = pBal + sBal;

                if (total > 0) {
                    const take = Math.min(total, remainingDeficit);
                    // Pro-rate based on balance
                    const pShare = pBal > 0 ? (pBal / total) * take : 0;
                    const sShare = sBal > 0 ? (sBal / total) * take : 0;

                    if (pShare > 0) {
                        const gainRatio = Math.max(0, 1 - (p.nonRegistered.adjustedCostBase / pBal));
                        pRealizedGains += pShare * gainRatio;
                        p.nonRegistered.adjustedCostBase *= (1 - pShare / pBal);
                        p.nonRegistered.balance -= pShare;
                        pNonRegWithdrawal += pShare;
                    }
                    if (sShare > 0 && s) {
                        const gainRatio = Math.max(0, 1 - (s.nonRegistered.adjustedCostBase / sBal));
                        sRealizedGains += sShare * gainRatio;
                        s.nonRegistered.adjustedCostBase *= (1 - sShare / sBal);
                        s.nonRegistered.balance -= sShare;
                        sNonRegWithdrawal += sShare;
                    }

                    // Note: Cap Gains Tax is paid NEXT year effectively (or end of this year), 
                    // but for "filling the gap" we treat Non-Reg Capital withdrawals as Net Cash 
                    // and assume the tax bill is covered by the gross withdrawal or next year's planning.
                    // To be strictly simpler: We just assume Non-Reg draws are AFTER tax money availability.
                    // The tax on gains calculates into the FINAL tax bill for the year, reducing the "Effective Net"
                    // checking later. But for filling the gap, $1 sold is $1 cash in hand.

                    remainingDeficit -= take;
                }
            };

            const withdrawTFSA = () => {
                if (remainingDeficit <= 0) return;
                const pBal = pAlive ? p.tfsa.balance : 0;
                const sBal = sAlive && s ? s.tfsa.balance : 0;
                const total = pBal + sBal;

                if (total > 0) {
                    const take = Math.min(total, remainingDeficit);
                    const pShare = pBal > 0 ? (pBal / total) * take : 0;
                    const sShare = sBal > 0 ? (sBal / total) * take : 0;

                    if (pShare > 0) { p.tfsa.balance -= pShare; pTFSAWithdrawal += pShare; }
                    if (sShare > 0 && s) { s.tfsa.balance -= sShare; sTFSAWithdrawal += sShare; }

                    remainingDeficit -= take;
                }
            };

            const withdrawRRSP = () => {
                if (remainingDeficit <= 0) return;

                // We need to request GROSS amounts to satisfy the Remaining NET Deficit.
                // We split the request 50/50 between spouses if both have room, or pro-rata?
                // Simple approach: Split Net requirement 50/50

                let pNetReq = (pAlive && sAlive && s) ? remainingDeficit / 2 : (pAlive ? remainingDeficit : 0);
                let sNetReq = (pAlive && sAlive && s) ? remainingDeficit / 2 : (sAlive && s ? remainingDeficit : 0);

                // function to execute withdrawal for one person
                const doWithdraw = (personObj: Person, base: PersonAnnualBase, netReq: number): { gross: number, netObtained: number } => {
                    if (netReq <= 0 || personObj.rrsp.balance <= 0) return { gross: 0, netObtained: 0 };

                    // Solve for Gross
                    // Current Taxable = Base Taxable + (RealizedGains * 0.5) <--- We add gains from NonReg sale here
                    // Note: We haven't finalized gains yet if order is mixed, but typically NonReg is done.
                    // IMPORTANT: The definition of 'Base' above didn't include Cap Gains yet.

                    const currentTaxable = base.taxableIncome + (personObj === p ? pRealizedGains * 0.5 : sRealizedGains * 0.5);

                    const { gross } = solveGrossWithdrawal(netReq, currentTaxable, base.oasIncome, province, inflationFactor, personObj.age);

                    // Check balance
                    const actualGross = Math.min(gross, personObj.rrsp.balance);
                    personObj.rrsp.balance -= actualGross;

                    let actualNet = netReq;

                    // If we hit the balance cap, we didn't get the full Net we wanted.
                    // We must calculate exactly how much Net we DID get so the Deficit tracks correctly.
                    if (actualGross < gross) {
                        const newTaxable = currentTaxable + actualGross;

                        // Calculate marginal tax on the *actual* gross we extracted
                        const originalClawback = calculateOASClawback(currentTaxable, base.oasIncome, inflationFactor);
                        const originalTax = calculateIncomeTax(currentTaxable, province, inflationFactor) + originalClawback;

                        const newClawback = calculateOASClawback(newTaxable, base.oasIncome, inflationFactor);
                        const newTax = calculateIncomeTax(newTaxable, province, inflationFactor, undefined, personObj.age) + newClawback;

                        const actualTax = newTax - originalTax;
                        actualNet = actualGross - actualTax;
                    }

                    return { gross: actualGross, netObtained: actualNet };
                };

                if (pAlive && pBase) {
                    const res = doWithdraw(p, pBase, pNetReq);
                    pExtraRRSPGross += res.gross;
                    remainingDeficit -= res.netObtained; // Assuming we got it
                }
                if (sAlive && s && sBase) {
                    const res = doWithdraw(s, sBase, sNetReq);
                    sExtraRRSPGross += res.gross;
                    remainingDeficit -= res.netObtained;
                }

                // If one couldn't cover their half, the other tries? (skipped for simplicity in v1)
            };

            if (withdrawalStrategy === 'rrsp-first') {
                withdrawRRSP();
                withdrawNonReg();
                withdrawTFSA();
            } else {
                withdrawNonReg();
                withdrawTFSA();
                withdrawRRSP();
            }
        }

        // --- Step 4: Surplus Allocation (Reinvestment) ---
        if (surplus > 0) {
            let remaining = surplus;
            // TFSA Limit rounded to nearest $500
            const tfsaLimitRaw = 7000 * inflationFactor;
            const tfsaLimit = Math.round(tfsaLimitRaw / 500) * 500;

            // 1. TFSA
            if (pAlive) {
                const add = Math.min(remaining, tfsaLimit);
                p.tfsa.balance += add;
                remaining -= add;
                reinvestedTFSA += add; // Total tracking
            }
            if (sAlive && s && remaining > 0) {
                const add = Math.min(remaining, tfsaLimit);
                s.tfsa.balance += add;
                remaining -= add;
                reinvestedTFSA += add;
            }

            // 2. RRSP (if room and < 71)
            // Modification: Skip if in Pre-Retirement Melt Period
            const pIsMelting = p.rrspMeltAmount && p.rrspMeltAmount > 0 && pAge >= (p.rrspMeltStartAge || p.retirementAge);

            if (pAlive && pAge < 71 && remaining > 0 && p.currentIncome > 0 && pAge < p.retirementAge && !pIsMelting) {
                const limit = Math.min(p.currentIncome * 0.18, 31000 * inflationFactor); // Approx room gen
                const add = Math.min(remaining, limit);
                p.rrsp.balance += add;
                remaining -= add;
                reinvestedRRSP += add;
            }

            const sIsMelting = s && s.rrspMeltAmount && s.rrspMeltAmount > 0 && sAge! >= (s.rrspMeltStartAge || s.retirementAge);

            if (sAlive && s && sAge! < 71 && remaining > 0 && s.currentIncome > 0 && sAge! < s.retirementAge && !sIsMelting) {
                const limit = Math.min(s.currentIncome * 0.18, 31000 * inflationFactor);
                const add = Math.min(remaining, limit);
                s.rrsp.balance += add;
                remaining -= add;
                reinvestedRRSP += add;
            }

            // 3. Non-Reg
            if (remaining > 0) {
                reinvestedNonReg += remaining;
                // Split remaining 50/50 or to owner?
                if (pAlive && sAlive && s) {
                    p.nonRegistered.balance += remaining / 2;
                    p.nonRegistered.adjustedCostBase += remaining / 2;
                    s.nonRegistered.balance += remaining / 2;
                    s.nonRegistered.adjustedCostBase += remaining / 2;
                } else if (pAlive) {
                    p.nonRegistered.balance += remaining;
                    p.nonRegistered.adjustedCostBase += remaining;
                } else if (sAlive && s) {
                    s.nonRegistered.balance += remaining;
                    s.nonRegistered.adjustedCostBase += remaining;
                }
            }
        }

        // --- Step 5: Final Tax & Net Recalculation ---
        // Now we know exact Gross Income components.

        const getFinalStats = (base: PersonAnnualBase, extraRRSP: number, realizedGains: number, age: number) => {
            const totalRRSP = base.rrifWithdrawal + base.voluntaryRRSPWithdrawal + extraRRSP;
            const taxableGains = realizedGains * 0.5;
            const finalTaxable = base.employmentIncome + base.cppIncome + base.oasIncome + totalRRSP + base.interestIncome + (base.divIncome * 1.38) + taxableGains;

            const oasRecovery = calculateOASClawback(finalTaxable, base.oasIncome, inflationFactor);
            const finalTax = calculateIncomeTax(finalTaxable, province, inflationFactor, undefined, age) + oasRecovery;

            // Net Cash "In Hand" from this person (excluding shared withdrawals which were tracked separately? No, include all sourced from them)
            // Wait, "Net Cash" for the Spending Chart needs to be pure.
            // Net = (Gross Sources - Tax).

            // Let's apportion Tax to sources pro-rata for the chart?
            // Or just return Gross and Tax, and let the Chart handle "Net" Visualization by subtracting?
            // The Task asked for "Accurate" Spending chart.


            /* 
               Actually, to be perfect for the chart:
               Net Salary = Salary - (Salary / TotalGross) * TotalTax
            */

            return {
                finalTaxable,
                finalTax,
                totalRRSP,
                taxableGains
            };
        };

        const pFinal = pAlive && pBase ? getFinalStats(pBase, pExtraRRSPGross, pRealizedGains, pAge) : null;
        const sFinal = sAlive && s && sBase ? getFinalStats(sBase, sExtraRRSPGross, sRealizedGains, sAge!) : null;

        const totalTaxPaid = (pFinal?.finalTax || 0) + (sFinal?.finalTax || 0);

        // --- Step 6: Asset Growth (End of Year) ---

        // Non-Reg growth (already handled interest/divs as cash flow, so only grow Capital)
        // Note: The 'interest' and 'div' portions were paid out. The 'capital' portion grows.
        // Actually, in the simple model, we assume the whole balance grows by the 'Capital Growth' rate assigned to the equity portion?
        // Or do we assume price appreciation on the whole bag?
        // Let's stick to previous logic: mix.capitalGain * returnRates.capitalGrowth
        // Let's stick to previous logic: mix.capitalGain * returnRates.capitalGrowth
        if (pAlive) {
            p.rrsp.balance *= (1 + currentYearRates.capitalGrowth);
            p.tfsa.balance *= (1 + currentYearRates.capitalGrowth);
            p.nonRegistered.balance *= (1 + (p.nonRegistered.assetMix.capitalGain * currentYearRates.capitalGrowth));
        }
        if (sAlive && s) {
            s.rrsp.balance *= (1 + currentYearRates.capitalGrowth);
            s.tfsa.balance *= (1 + currentYearRates.capitalGrowth);
            s.nonRegistered.balance *= (1 + (s.nonRegistered.assetMix.capitalGain * currentYearRates.capitalGrowth));
        }


        // --- Result Construction ---

        // Calculate Granular Net Cash for Charts (Pro-rata Tax allocation)
        // Net Source = Gross Source - AllocatableTax

        const calcNet = (gross: number, totalGross: number, totalTax: number) => {
            if (totalGross <= 0) return 0;
            const share = gross / totalGross;
            return gross - (share * totalTax);
        };

        const pGrossTotal = pFinal?.finalTaxable || 0;
        const sGrossTotal = sFinal?.finalTaxable || 0;

        // Person Nets
        const pNetEmp = calcNet(pBase?.employmentIncome || 0, pGrossTotal, pFinal?.finalTax || 0);
        const pNetCPP = calcNet(pBase?.cppIncome || 0, pGrossTotal, pFinal?.finalTax || 0);
        const pNetOAS = calcNet(pBase?.oasIncome || 0, pGrossTotal, pFinal?.finalTax || 0);
        const pNetRRSP = calcNet(pFinal?.totalRRSP || 0, pGrossTotal, pFinal?.finalTax || 0);
        // Investment income (Interest + Divs) counts as taxable for tax allocation
        // But actual cash was purely Int + Div. We subtract the allocated tax from the CASH amount.
        // Tax allocated to investment was: (InvTaxable / Gross) * Tax.
        const pInvTax = (pGrossTotal > 0) ? (((pBase?.interestIncome || 0) + (pBase?.divIncome || 0) * 1.38) / pGrossTotal) * (pFinal?.finalTax || 0) : 0;
        const pNetInvCash = ((pBase?.interestIncome || 0) + (pBase?.divIncome || 0)) - pInvTax;

        // Spouse Nets
        const sNetEmp = calcNet(sBase?.employmentIncome || 0, sGrossTotal, sFinal?.finalTax || 0);
        const sNetCPP = calcNet(sBase?.cppIncome || 0, sGrossTotal, sFinal?.finalTax || 0);
        const sNetOAS = calcNet(sBase?.oasIncome || 0, sGrossTotal, sFinal?.finalTax || 0);
        const sNetRRSP = calcNet(sFinal?.totalRRSP || 0, sGrossTotal, sFinal?.finalTax || 0);
        // Spouse Inv
        const sInvTax = (sGrossTotal > 0) ? (((sBase?.interestIncome || 0) + (sBase?.divIncome || 0) * 1.38) / sGrossTotal) * (sFinal?.finalTax || 0) : 0;
        const sNetInvCash = ((sBase?.interestIncome || 0) + (sBase?.divIncome || 0)) - sInvTax;

        // TFSA / Non-Reg Withdrawals are already Net (Tax Free / Tax Paid on Prev Year or handling)
        // (Technically realized gains invoke tax, but we treated them as accessible cash for deficit. 
        // The tax bill generated by them reduces the 'Net Analysis' of next year or is absorbed by the gap filler.)

        results.push({
            year: new Date().getFullYear() + yearOffset,
            age: pAge,
            spouseAge: sAge,
            totalAssets: (pAlive ? p.rrsp.balance + p.tfsa.balance + p.nonRegistered.balance : 0) +
                (sAlive && s ? s.rrsp.balance + s.tfsa.balance + s.nonRegistered.balance : 0),
            grossIncome: pGrossTotal + sGrossTotal,
            cppIncome: (pBase?.cppIncome || 0) + (sBase?.cppIncome || 0),
            oasIncome: (pBase?.oasIncome || 0) + (sBase?.oasIncome || 0),
            netIncome: (pGrossTotal + sGrossTotal) - totalTaxPaid + pTFSAWithdrawal + sTFSAWithdrawal + pNonRegWithdrawal + sNonRegWithdrawal, // Total Cash In Hand
            spending: targetSpend,
            taxPaid: totalTaxPaid,
            accounts: {
                rrsp: pAlive ? p.rrsp.balance : 0,
                tfsa: pAlive ? p.tfsa.balance : 0,
                nonRegistered: pAlive ? p.nonRegistered.balance : 0,
                nonRegisteredACB: pAlive ? p.nonRegistered.adjustedCostBase : 0
            },
            spouseAccounts: sAlive && s ? {
                rrsp: s.rrsp.balance,
                tfsa: s.tfsa.balance,
                nonRegistered: s.nonRegistered.balance,
                spouseNonRegisteredACB: s.nonRegistered.adjustedCostBase
            } : undefined,

            // New Visualization Fields
            netEmploymentIncome: pNetEmp + sNetEmp,
            netCPPIncome: pNetCPP + sNetCPP,
            netOASIncome: pNetOAS + sNetOAS,
            netInvestmentIncome: pNetInvCash + sNetInvCash,

            // Reinvestments
            reinvestedTFSA,
            reinvestedRRSP,
            reinvestedNonReg,

            // Split Nets
            personNetRRSP: pNetRRSP,
            spouseNetRRSP: sNetRRSP,
            personNetTFSA: pTFSAWithdrawal,
            spouseNetTFSA: sTFSAWithdrawal,
            personNetNonReg: pNonRegWithdrawal,
            spouseNetNonReg: sNonRegWithdrawal,

            // Raw
            totalTFSAWithdrawal: pTFSAWithdrawal + sTFSAWithdrawal,
            totalNonRegWithdrawal: pNonRegWithdrawal + sNonRegWithdrawal,
            totalRRSPWithdrawal: (pFinal?.totalRRSP || 0) + (sFinal?.totalRRSP || 0),

            // Just for checking
            netRRSPWithdrawal: pNetRRSP + sNetRRSP,
            netTFSAWithdrawal: pTFSAWithdrawal + sTFSAWithdrawal,
            netNonRegWithdrawal: pNonRegWithdrawal + sNonRegWithdrawal,

            employmentIncome: (pBase?.employmentIncome || 0) + (sBase?.employmentIncome || 0),
            investmentIncome: (pBase?.interestIncome || 0) + (pBase?.divIncome || 0) + (sBase?.interestIncome || 0) + (sBase?.divIncome || 0),
            totalRealizedCapGains: pRealizedGains + sRealizedGains,
            inflationFactor,
            householdSurplus: surplus // The initial surplus before reinvestment
        });
    }

    return results;
}

// Federal RRIF Minimum Withdrawal Factors (Post-2015) - unchanged
const RRIF_MINIMUMS: { [age: number]: number } = {
    71: 0.0528, 72: 0.0540, 73: 0.0553, 74: 0.0567, 75: 0.0582,
    76: 0.0598, 77: 0.0617, 78: 0.0636, 79: 0.0658, 80: 0.0682,
    81: 0.0708, 82: 0.0738, 83: 0.0771, 84: 0.0808, 85: 0.0851,
    86: 0.0899, 87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192,
    91: 0.1306, 92: 0.1449, 93: 0.1634, 94: 0.1879
};

function getRRIFMinFactor(age: number): number {
    if (age <= 70) return 0.05;
    if (age >= 95) return 0.20;
    return RRIF_MINIMUMS[age] || 0.06;
}

export function runMonteCarlo(inputs: SimulationInputs, iterations: number = 200): MonteCarloResult {
    const rawRuns: SimulationResult[][] = [];

    // Run N simulations
    for (let i = 0; i < iterations; i++) {
        rawRuns.push(runSimulation(inputs, true));
    }

    // Process Results
    // We assume all runs have same length (same life expectancy inputs)
    const years = rawRuns[0].length;
    const percentiles: MonteCarloPercentile[] = [];


    for (let i = 0; i < years; i++) {
        // Extract total assets for this specific year across all runs
        const assetsAtYear = rawRuns.map(run => run[i].totalAssets);
        const refRun = rawRuns[0][i];

        // Sort to find percentiles
        assetsAtYear.sort((a, b) => a - b);

        const getP = (p: number) => assetsAtYear[Math.floor(p * iterations)];

        // At end of plan (last year), count runs where assets < 0 (or close to 0)
        // Actually, our engine might not allow negative assets (it stops at 0?), 
        // let's check. Engine allows balance -= withdrawal. If balance < 0, it stays negative?
        // Let's check: "person.rrsp.balance -= rrifWithdrawal".
        // If balance is 0, withdrawal is 0?
        // Ah, in "Step 3" withdraw function checks: "Math.min(total, remainingDeficit)". 
        // So balance shouldn't go negative, it just hits 0.
        // But for success rate, we check if they ran out of money BEFORE life expectancy.
        // Or simply: check if assets at end are > 0.

        percentiles.push({
            year: refRun.year,
            age: refRun.age,
            p5: getP(0.05),
            p25: getP(0.25),
            p50: getP(0.50),
            p75: getP(0.75),
            p95: getP(0.95)
        });
    }

    // Success Rate Calculation
    // A run is a "failure" if at any point in the retired phase assets hit 0 while deficit exists?
    // Or simpler: Is the Final Asset Value > 0?
    // Using final value is easiest Proxy.
    const lastYearAssets = rawRuns.map(run => run[run.length - 1].totalAssets);
    const successes = lastYearAssets.filter(val => val > 1000).length; // Tolerance $1000

    return {
        percentiles,
        successRate: (successes / iterations) * 100,
        medianEndOfPlanAssets: percentiles[percentiles.length - 1].p50
    };
}
