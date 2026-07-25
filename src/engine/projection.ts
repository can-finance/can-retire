
import type { Person, NonRegisteredAccount, NonRegMix, SimulationInputs, SimulationResult, MonteCarloResult, MonteCarloPercentile } from './types';
import { calculateTotalTax, calculatePayrollContributions, calculateOptimalSplit } from './tax';
import type { SplitPerson } from './tax';
import { calculateEstimatedCPP, calculateOAS } from './cpp';

// --- Helper Types for Internal engine calculation ---

// Standard Normal Distribution Generator (Mean 0, StdDev 1)
function boxMullerRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Lognormal yearly return: preserves the arithmetic mean `meanRate`,
// bounds the outcome below by −100%. z is a standard-normal draw.
// meanRate <= −100% is nonsensical and would make ln() undefined, so it passes
// through unshocked.
export function lognormalReturn(meanRate: number, sigma: number, z: number): number {
    const gross = 1 + meanRate;
    if (gross <= 0) return meanRate;
    const mu = Math.log(gross) - (sigma * sigma) / 2;
    return Math.exp(mu + sigma * z) - 1;
}

function calculateTaxableCapitalGains(totalGains: number): number {
    // Flat 50% inclusion rate. The June 2024 proposal to raise the rate to 2/3
    // above $250,000 was deferred and then cancelled (March 2025) — never enacted.
    return totalGains * 0.5;
}

export const totalNonRegBalance = (person: Person): number =>
    person.nonRegisteredAccounts.reduce((sum, a) => sum + a.balance, 0);

const totalNonRegACB = (person: Person): number =>
    person.nonRegisteredAccounts.reduce((sum, a) => sum + a.adjustedCostBase, 0);

const surplusAccount = (person: Person): NonRegisteredAccount | undefined =>
    person.nonRegisteredAccounts.find(a => a.receivesSurplus) ?? person.nonRegisteredAccounts[0];

// Balance-weighted mix across a set of accounts. Undefined for an empty list
// (person dead or accounts rolled over); falls back to the first account's mix
// when everything is drained, so the drift readout stays sane.
export function blendedNonRegMix(accounts: NonRegisteredAccount[]): NonRegMix | undefined {
    const first = accounts[0];
    if (!first) return undefined;
    const total = accounts.reduce((sum, a) => sum + a.balance, 0);
    if (total <= 0) {
        return {
            bonds: first.assetMix.bonds,
            cash: first.assetMix.cash,
            dividend: first.assetMix.dividend,
            foreignDividend: first.assetMix.foreignDividend ?? 0,
            capitalGain: first.assetMix.capitalGain
        };
    }
    const mix = { bonds: 0, cash: 0, dividend: 0, foreignDividend: 0, capitalGain: 0 };
    for (const a of accounts) {
        const w = a.balance / total;
        mix.bonds += w * a.assetMix.bonds;
        mix.cash += w * a.assetMix.cash;
        mix.dividend += w * a.assetMix.dividend;
        mix.foreignDividend += w * (a.assetMix.foreignDividend || 0);
        mix.capitalGain += w * a.assetMix.capitalGain;
    }
    return mix;
}

// Weights of the accounts that can actually drift (annual rebalancing off)
const driftingNonRegMix = (person: Person): NonRegMix | undefined =>
    blendedNonRegMix(person.nonRegisteredAccounts.filter(a => a.rebalanceAnnually === false));

// Death with a surviving spouse: non-reg accounts roll over at ACB (no tax
// triggered) — the survivor inherits them as-is, keeping each account's ACB and
// mix. The survivor's own surplus target stays in effect.
function rolloverNonRegTo(survivor: Person, deceased: Person): void {
    survivor.nonRegisteredAccounts.push(...deceased.nonRegisteredAccounts
        .map(a => ({ ...a, assetMix: { ...a.assetMix }, receivesSurplus: false })));
    // Zero out the deceased's list to avoid double counting
    deceased.nonRegisteredAccounts = [];
}

// Deduct terminal tax from a deceased person's non-reg balances, pro-rata
// across accounts, so the row's estate values reflect the after-tax amounts
function scaleNonRegBalances(person: Person, afterTax: number, before: number): void {
    if (before <= 0) return;
    const factor = afterTax / before;
    for (const a of person.nonRegisteredAccounts) a.balance *= factor;
}

interface PersonAnnualBase {
    taxableIncome: number; // Excludes taxable capital gains (tracked via realized-gains totals)
    tax: number;
    cppIncome: number;
    oasIncome: number;
    pensionIncome: number; // DB lifetime pension incl. bridge (qualifying pension income at any age)
    rrifWithdrawal: number;
    voluntaryRRSPWithdrawal: number;
    interestIncome: number;
    divIncome: number; // Canadian eligible dividends (cash, before gross-up)
    foreignDivIncome: number; // Foreign dividends: fully taxable, no gross-up or credit
    employmentIncome: number;
    investmentIncomeNet: number; // Interest + Dividends (After Tax share approx)
    payrollContributions: number; // Employee CPP/QPP + EI withheld from employment income
    payrollCreditable: number;    // Base CPP/QPP + EI — relieved by a credit, not a deduction
    payrollDeductible: number;    // Enhanced CPP/QPP + CPP2 — comes off taxable income
    baseNetCash: number; // Employment + CPP/OAS + RRIF/Melt + Invest (Net)
    turnoverRealizedGains: number; // Gains realized by fund turnover this year (no cash; ACB bumped)
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
        const newTax = calculateTotalTax(newTaxable, baseOAS, province, inflationFactor, age).total;
        const originalTax = calculateTotalTax(currentTaxable, baseOAS, province, inflationFactor, age).total;

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
    const marginalTax = calculateTotalTax(newTaxable, baseOAS, province, inflationFactor, age).total
        - calculateTotalTax(currentTaxable, baseOAS, province, inflationFactor, age).total;

    return { gross, tax: marginalTax };
}

// --- DB Pension Income ---
// `annualAmount` is the pension's purchasing-power value at its START age. To turn
// that into nominal dollars we escalate by inflation over the years between the
// simulation start age and the pension start age:
//     factorAtStart = (1 + inflationRate)^max(0, startAge - person.age)
// `person.age` on the deep-copied Person is the simulation start age and is never
// mutated; the loop passes the current `age` separately. If the pension is already
// in pay at simulation start (startAge <= person.age), factorAtStart = 1 and
// `annualAmount` is treated as today's-dollar value at that point.
//   - indexedToInflation true  → pays annualAmount * inflationFactor (current year's
//     factor — fully indexed, same treatment as CPP; constant real value).
//   - indexedToInflation false → pays annualAmount * factorAtStart, frozen nominal
//     thereafter (loses real value each year — the point of modeling non-indexed pensions).
// The bridge benefit gets the same indexation treatment and is paid for
// startAge <= age < (bridgeEndAge ?? 65).
function calculatePensionIncome(
    person: Person,
    age: number,
    inflationRate: number,
    inflationFactor: number
): number {
    const pension = person.pension;
    if (!pension || age < pension.startAge) return 0;

    const factorAtStart = Math.pow(1 + inflationRate, Math.max(0, pension.startAge - person.age));
    const escalation = pension.indexedToInflation ? inflationFactor : factorAtStart;

    let amount = pension.annualAmount * escalation;

    const bridgeEnd = pension.bridgeEndAge ?? 65;
    if (pension.bridgeAmount && pension.bridgeAmount > 0 && age < bridgeEnd) {
        amount += pension.bridgeAmount * escalation;
    }

    return amount;
}

// --- Simulation Logic ---

/**
 * Calculate base-year income, mandatory withdrawals, and tax for a single person.
 *
 * ⚠️  SIDE EFFECT: This function MUTATES `person.rrsp.balance` in place to deduct
 * RRIF minimums and voluntary meltdown withdrawals. Callers MUST pass a deep copy
 * of the Person object (see `runSimulation` which does `JSON.parse(JSON.stringify(...))`)
 * to avoid corrupting the original input data.
 */
function simulatePersonBaseYear(
    person: Person,
    age: number,
    province: string,
    returnRates: { bondReturn: number; cashInterest: number; dividend: number; foreignYield?: number; capitalGrowth: number },
    inflationFactor: number,
    inflationRate: number
): PersonAnnualBase {
    // 1. Mandatory Income Sources
    const cppIncome = (age >= person.cppStartAge)
        ? (person.cppAnnualOverride != null
            ? person.cppAnnualOverride * inflationFactor
            : calculateEstimatedCPP(person.cppContributedYears ?? 40, person.cppStartAge, inflationFactor))
        : 0;

    const oasIncome = calculateOAS(age, person.oasStartAge, inflationFactor);

    // DB lifetime pension (incl. bridge). Qualifying pension income at any age.
    const pensionIncome = calculatePensionIncome(person, age, inflationRate, inflationFactor);

    // RRIF Minimums
    // RRSP must convert to RRIF by Dec 31 of the year you turn 71.
    // First mandatory minimum withdrawal is in the calendar year you turn 72,
    // but the RRIF factor is based on your age on Jan 1 of that year (i.e., 71).
    // So: age >= 72 means "year you turn 72" → factor uses (age - 1) = 71.
    let rrifWithdrawal = 0;
    if (age >= 72) {
        const factorAge = age - 1; // Age on Jan 1 of this calendar year
        const minFactor = getRRIFMinFactor(factorAge);
        rrifWithdrawal = person.rrsp.balance * minFactor;
        person.rrsp.balance -= rrifWithdrawal; // Deduct immediately
    }

    // Voluntary Meltdown (Pre-calculated fixed gross)
    // Stops at age 71 (last year before mandatory RRIF conversion)
    let voluntaryRRSPWithdrawal = 0;
    const meltStart = person.rrspMeltStartAge || person.retirementAge;
    if (person.rrspMeltAmount && person.rrspMeltAmount > 0 && age >= meltStart && age < 72) {
        voluntaryRRSPWithdrawal = Math.min(person.rrsp.balance, person.rrspMeltAmount);
        person.rrsp.balance -= voluntaryRRSPWithdrawal;
    }

    // Investment Income (Interest & Divs) — summed across all non-reg accounts,
    // each using its own asset mix
    let interestIncome = 0;
    let divIncome = 0;
    let foreignDivIncome = 0;
    let turnoverRealizedGains = 0;
    for (const acct of person.nonRegisteredAccounts) {
        const mix = acct.assetMix;
        interestIncome += acct.balance * (mix.bonds * returnRates.bondReturn + mix.cash * returnRates.cashInterest);
        divIncome += acct.balance * mix.dividend * returnRates.dividend;
        // Foreign dividends: fully taxable at marginal rates, no gross-up or dividend
        // tax credit. (The ~15% foreign withholding is creditable against Canadian tax,
        // so marginal-rate treatment approximates the all-in result.)
        foreignDivIncome += acct.balance * (mix.foreignDividend || 0) * (returnRates.foreignYield ?? returnRates.dividend);

        // Fund turnover: a slice of unrealized gains is realized (and its distribution
        // reinvested) each year even without withdrawals — the annual tax drag of
        // non-index funds. No cash changes hands; ACB rises by the realized amount.
        const turnoverRate = Math.min(1, Math.max(0, acct.equityTurnoverRate ?? 0));
        const unrealizedGains = Math.max(0, acct.balance - acct.adjustedCostBase);
        const realized = turnoverRate * unrealizedGains;
        acct.adjustedCostBase += realized;
        turnoverRealizedGains += realized;
    }
    const divGrossUp = divIncome * 1.38;

    // Employment
    const employmentIncome = (age < person.retirementAge) ? person.currentIncome : 0;

    // Mandatory CPP/QPP + EI withheld on employment income.
    const payrollForTax = calculatePayrollContributions(employmentIncome, province, inflationFactor);

    // Calculate Base Tax
    // Qualifying pension income for the $2,000 credit: DB pension at any age, plus RRIF
    // withdrawals only at 65+. The voluntary RRSP melt is an ordinary RRSP withdrawal and
    // does NOT qualify. (calculateIncomeTax no longer age-gates; the caller applies the rules.)
    const eligiblePensionIncome = pensionIncome + (age >= 65 ? rrifWithdrawal : 0);
    // The enhanced CPP/QPP slice (and all of CPP2) is deductible, so it never enters
    // taxable income in the first place.
    const baseTaxable = Math.max(0, employmentIncome + cppIncome + oasIncome + pensionIncome + rrifWithdrawal + voluntaryRRSPWithdrawal + interestIncome + divGrossUp + foreignDivIncome - payrollForTax.deductible);
    // Turnover gains are taxed in the base year (so the deficit funds their tax) but
    // kept OUT of the returned taxableIncome — downstream withdrawal solvers add
    // calculateTaxableCapitalGains(realizedGains) themselves, seeded with these gains.
    const baseTaxableWithTurnover = baseTaxable + calculateTaxableCapitalGains(turnoverRealizedGains);
    const totalTax = calculateTotalTax(
        baseTaxableWithTurnover, oasIncome, province, inflationFactor, age,
        eligiblePensionIncome, divGrossUp, payrollForTax.creditable
    ).total;

    // Mandatory CPP/QPP + EI on employment income — cash out the door before any of
    // it can be spent or saved. The enhanced slice is deducted from income above;
    // the base slice comes back as a credit inside the tax call.
    const payrollContributions = payrollForTax.total;

    // Net Cash Calculation
    // Total Cash In = Emp + CPP + OAS + Pension + RRIF + Melt + Int + Div
    // Note: Div is actual cash, not gross up. Turnover distributions are reinvested (no cash).
    const totalCashIn = employmentIncome + cppIncome + oasIncome + pensionIncome + rrifWithdrawal + voluntaryRRSPWithdrawal + interestIncome + divIncome + foreignDivIncome;
    const baseNetCash = totalCashIn - totalTax - payrollContributions;

    return {
        taxableIncome: baseTaxable,
        tax: totalTax,
        cppIncome,
        oasIncome,
        pensionIncome,
        rrifWithdrawal,
        voluntaryRRSPWithdrawal,
        interestIncome,
        divIncome,
        foreignDivIncome,
        employmentIncome,
        payrollContributions,
        payrollCreditable: payrollForTax.creditable,
        payrollDeductible: payrollForTax.deductible,
        investmentIncomeNet: (interestIncome + divIncome + foreignDivIncome), // This is gross investment cash, we deduct tax globally later
        baseNetCash,
        turnoverRealizedGains
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
        s ? s.lifeExpectancy + (p.age - s.age) : 0
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
        const annualOneTimeEvents = (inputs.oneTimeExpenses || [])
            .filter(e => e.age === pAge);

        const annualOneTimeExpenses = annualOneTimeEvents
            .filter(e => e.type !== 'inflow')
            .reduce((sum, e) => sum + e.amount, 0);

        const annualOneTimeInflows = annualOneTimeEvents
            .filter(e => e.type === 'inflow')
            .reduce((sum, e) => sum + e.amount, 0);

        const targetSpend = ((isRetired ? postRetirementSpend : preRetirementSpend) * inflationFactor) + annualOneTimeExpenses;

        // --- Determine Returns for this Year ---
        let currentYearRates = returnRates;
        if (stochastic && returnRates.volatility) {
            // One correlated market draw per year across RRSP, TFSA, and
            // non-reg equity. Returns are lognormal: the entered rate stays the
            // arithmetic mean while the median carries volatility drag, and no
            // draw can push a year's return below −100%.
            const z = boxMullerRandom();
            const vol = returnRates.volatility;
            currentYearRates = {
                ...returnRates,
                capitalGrowth: lognormalReturn(returnRates.capitalGrowth, vol, z),
                rrspGrowth: returnRates.rrspGrowth != null ? lognormalReturn(returnRates.rrspGrowth, vol, z) : undefined,
                tfsaGrowth: returnRates.tfsaGrowth != null ? lognormalReturn(returnRates.tfsaGrowth, vol, z) : undefined
            };
        }

        // --- Step 1: Base Income & Mandatory Flows ---
        const pBase = pAlive ? simulatePersonBaseYear(p, pAge, province, currentYearRates, inflationFactor, inflationRate) : null;
        const sBase = sAlive && s ? simulatePersonBaseYear(s, sAge!, province, currentYearRates, inflationFactor, inflationRate) : null;

        const householdBaseNet = (pBase?.baseNetCash || 0) + (sBase?.baseNetCash || 0) + annualOneTimeInflows;

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
        let pNonRegWithdrawal = 0; let sNonRegWithdrawal = 0; // Gross sale amounts (principal + gains)
        let pNonRegNet = 0; let sNonRegNet = 0; // Net cash to spending after the sale's own tax
        // Seeded with turnover-realized gains: their tax is in baseNetCash, and the
        // withdrawal solvers stack sale gains on top of them at the right brackets
        let pRealizedGains = pBase?.turnoverRealizedGains || 0;
        let sRealizedGains = sBase?.turnoverRealizedGains || 0;

        // Tracking Reinvestment
        let reinvestedTFSA = 0;
        let reinvestedRRSP = 0;
        let reinvestedNonReg = 0;
        // Per-person share of reinvestedRRSP. An RRSP contribution is deductible, so
        // each person's own contribution has to reduce their own taxable income —
        // the household total can't do that.
        let pRrspContribution = 0;
        let sRrspContribution = 0;

        // Spending the household could not fund this year (all accounts drained)
        let shortfall = 0;

        // --- Step 3: Deficit Resolution (Filling the Gap) ---
        if (deficit > 0) {
            let remainingDeficit = deficit;

            // Strategy Helpers

            // Sell enough Non-Reg to net `netTarget` AFTER the incremental tax the sale
            // itself triggers (capital gains + any extra OAS clawback), so the tax bill
            // is funded by the withdrawal instead of silently vanishing. Accounts are
            // drained in tax-efficient order: least embedded gain per dollar first.
            const sellNonReg = (personObj: Person, base: PersonAnnualBase, netTarget: number, age: number): { gross: number, net: number, gains: number } => {
                if (netTarget <= 0) return { gross: 0, net: 0, gains: 0 };

                const isPrimary = personObj === p;
                // Taxable income so far this year: base sources + any extra RRSP already drawn
                const taxableBase = base.taxableIncome + (isPrimary ? pExtraRRSPGross : sExtraRRSPGross);

                let totalGross = 0, totalNet = 0, totalGains = 0;

                const accounts = personObj.nonRegisteredAccounts
                    .filter(a => a.balance > 0)
                    .sort((a, b) => (b.adjustedCostBase / b.balance) - (a.adjustedCostBase / a.balance));

                for (const acct of accounts) {
                    const remainingTarget = netTarget - totalNet;
                    if (remainingTarget <= 0) break;

                    const bal = acct.balance;
                    // Pro-rata sale realizes a constant share of gains per dollar sold
                    const gainRatio = Math.max(0, 1 - (acct.adjustedCostBase / bal));

                    let gross: number, net: number;
                    if (gainRatio === 0) {
                        // ACB ≥ balance: the sale realizes no gain and triggers no
                        // tax, so net equals gross exactly — no search needed. The
                        // tax-efficient order sells these accounts first, so this
                        // is the common case.
                        gross = Math.min(bal, remainingTarget);
                        net = gross;
                    } else {
                        // Gains realized earlier this year, including earlier accounts in this sale
                        const priorGains = (isPrimary ? pRealizedGains : sRealizedGains) + totalGains;

                        const totalTaxAt = (realizedGains: number) => {
                            const taxable = taxableBase + calculateTaxableCapitalGains(realizedGains);
                            return calculateTotalTax(taxable, base.oasIncome, province, inflationFactor, age).total;
                        };
                        const baselineTax = totalTaxAt(priorGains);
                        const netFor = (gross: number) => gross - (totalTaxAt(priorGains + gross * gainRatio) - baselineTax);

                        // If even a full liquidation can't net the target, sell everything
                        if (netFor(bal) <= remainingTarget) {
                            gross = bal;
                        } else {
                            // Binary search; netFor is monotonic and tax drag is well under 50%,
                            // so gross is bracketed by [remainingTarget, 2 * remainingTarget]
                            let low = remainingTarget;
                            let high = Math.min(bal, remainingTarget * 2);
                            gross = high;
                            for (let i = 0; i < 20; i++) {
                                const mid = (low + high) / 2;
                                const net = netFor(mid);
                                gross = mid;
                                if (Math.abs(net - remainingTarget) < 1) break;
                                if (net < remainingTarget) low = mid; else high = mid;
                            }
                        }
                        net = netFor(gross);
                    }

                    acct.adjustedCostBase *= (1 - gross / bal);
                    acct.balance -= gross;
                    totalGross += gross;
                    totalNet += net;
                    totalGains += gross * gainRatio;
                }

                return { gross: totalGross, net: totalNet, gains: totalGains };
            };

            const withdrawNonReg = () => {
                // Two passes: if one spouse's account caps out, the other covers the remainder
                for (let pass = 0; pass < 2 && remainingDeficit > 1; pass++) {
                    const pBal = pAlive ? totalNonRegBalance(p) : 0;
                    const sBal = sAlive && s ? totalNonRegBalance(s) : 0;
                    const total = pBal + sBal;
                    if (total <= 0) return;

                    // Split the NET requirement pro-rata by balance
                    const need = remainingDeficit;
                    if (pBal > 0 && pAlive && pBase) {
                        const res = sellNonReg(p, pBase, (pBal / total) * need, pAge);
                        pRealizedGains += res.gains;
                        pNonRegWithdrawal += res.gross;
                        pNonRegNet += res.net;
                        remainingDeficit -= res.net;
                    }
                    if (sBal > 0 && sAlive && s && sBase) {
                        const res = sellNonReg(s, sBase, (sBal / total) * need, sAge!);
                        sRealizedGains += res.gains;
                        sNonRegWithdrawal += res.gross;
                        sNonRegNet += res.net;
                        remainingDeficit -= res.net;
                    }
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

                const pNetReq = (pAlive && sAlive && s) ? remainingDeficit / 2 : (pAlive ? remainingDeficit : 0);
                const sNetReq = (pAlive && sAlive && s) ? remainingDeficit / 2 : (sAlive && s ? remainingDeficit : 0);

                // function to execute withdrawal for one person.
                // `age` MUST be the person's age in the year being simulated (pAge/sAge).
                // `personObj.age` is the age at simulation START and never advances, so
                // using it would price the age amount (65+) against the wrong year.
                const doWithdraw = (personObj: Person, base: PersonAnnualBase, netReq: number, age: number): { gross: number, netObtained: number } => {
                    if (netReq <= 0 || personObj.rrsp.balance <= 0) return { gross: 0, netObtained: 0 };

                    // Solve for Gross on top of everything already taxable this year:
                    // base sources + taxable share of realized Non-Reg gains + any extra
                    // RRSP gross already withdrawn (matters for the fallback round below)
                    const currentTaxable = base.taxableIncome + (personObj === p
                        ? calculateTaxableCapitalGains(pRealizedGains) + pExtraRRSPGross
                        : calculateTaxableCapitalGains(sRealizedGains) + sExtraRRSPGross);

                    // Current-year age, not the Person's start age — the solver has to see
                    // the same age amount the year is finally assessed at.
                    const { gross } = solveGrossWithdrawal(netReq, currentTaxable, base.oasIncome, province, inflationFactor, age);

                    // Check balance
                    const actualGross = Math.min(gross, personObj.rrsp.balance);
                    personObj.rrsp.balance -= actualGross;

                    let actualNet = netReq;

                    // If we hit the balance cap, we didn't get the full Net we wanted.
                    // We must calculate exactly how much Net we DID get so the Deficit tracks correctly.
                    if (actualGross < gross) {
                        const newTaxable = currentTaxable + actualGross;

                        // Calculate marginal tax on the *actual* gross we extracted
                        // (current-year age, not the Person's start age)
                        const originalTax = calculateTotalTax(currentTaxable, base.oasIncome, province, inflationFactor, age).total;
                        const newTax = calculateTotalTax(newTaxable, base.oasIncome, province, inflationFactor, age).total;

                        const actualTax = newTax - originalTax;
                        actualNet = actualGross - actualTax;
                    }

                    return { gross: actualGross, netObtained: actualNet };
                };

                if (pAlive && pBase) {
                    const res = doWithdraw(p, pBase, pNetReq, pAge);
                    pExtraRRSPGross += res.gross;
                    remainingDeficit -= res.netObtained;
                }
                if (sAlive && s && sBase) {
                    const res = doWithdraw(s, sBase, sNetReq, sAge!);
                    sExtraRRSPGross += res.gross;
                    remainingDeficit -= res.netObtained;
                }

                // Fallback: if one spouse's RRSP couldn't cover their half, the other tops up
                if (remainingDeficit > 1 && pAlive && pBase && p.rrsp.balance > 0) {
                    const res = doWithdraw(p, pBase, remainingDeficit, pAge);
                    pExtraRRSPGross += res.gross;
                    remainingDeficit -= res.netObtained;
                }
                if (remainingDeficit > 1 && sAlive && s && sBase && s.rrsp.balance > 0) {
                    const res = doWithdraw(s, sBase, remainingDeficit, sAge!);
                    sExtraRRSPGross += res.gross;
                    remainingDeficit -= res.netObtained;
                }
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

            // Whatever deficit survives all withdrawal sources is unfunded spending.
            // Do NOT drop it silently — report it so the UI can flag plan failure.
            shortfall = Math.max(0, remainingDeficit);
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
                pRrspContribution += add;
            }

            const sIsMelting = s && s.rrspMeltAmount && s.rrspMeltAmount > 0 && sAge! >= (s.rrspMeltStartAge || s.retirementAge);

            if (sAlive && s && sAge! < 71 && remaining > 0 && s.currentIncome > 0 && sAge! < s.retirementAge && !sIsMelting) {
                const limit = Math.min(s.currentIncome * 0.18, 31000 * inflationFactor);
                const add = Math.min(remaining, limit);
                s.rrsp.balance += add;
                remaining -= add;
                reinvestedRRSP += add;
                sRrspContribution += add;
            }

            // 3. Non-Reg: swept into each person's designated surplus account
            // (new contributions land at cost, so ACB rises by the same amount)
            if (remaining > 0) {
                const targets: NonRegisteredAccount[] = [];
                if (pAlive) {
                    const t = surplusAccount(p);
                    if (t) targets.push(t);
                }
                if (sAlive && s) {
                    const t = surplusAccount(s);
                    if (t) targets.push(t);
                }
                if (targets.length > 0) {
                    reinvestedNonReg += remaining;
                    const share = remaining / targets.length;
                    for (const t of targets) {
                        t.balance += share;
                        t.adjustedCostBase += share;
                    }
                }
            }
        }

        // --- Step 5: Final Tax & Net Recalculation ---
        // Now we know exact Gross Income components.

        const getFinalStats = (base: PersonAnnualBase, extraRRSP: number, realizedGains: number, age: number, rrspContribution = 0) => {
            const totalRRSP = base.rrifWithdrawal + base.voluntaryRRSPWithdrawal + extraRRSP;
            // Qualifying pension income for the $2,000 credit AND for income splitting:
            // DB pension qualifies at any age; RRIF withdrawals qualify only at 65+. The
            // voluntary melt and extra RRSP draws are ordinary withdrawals — never qualifying.
            // dbPensionIncome / rrifIncome are surfaced separately so Step 5.5 can build the
            // SplitPerson buckets (DB splittable at any age, RRIF only at 65+).
            const dbPensionIncome = base.pensionIncome;
            const rrifIncome = base.rrifWithdrawal;
            const qualifiedPension = dbPensionIncome + (age >= 65 ? rrifIncome : 0);
            const taxableGains = calculateTaxableCapitalGains(realizedGains);
            const grossedUpDivs = base.divIncome * 1.38;
            // An RRSP contribution made out of this year's surplus is deductible, so it
            // comes off taxable income (and off the OAS-clawback base with it).
            const grossTaxable = Math.max(0, base.employmentIncome + base.cppIncome + base.oasIncome + base.pensionIncome + totalRRSP + base.interestIncome + grossedUpDivs + base.foreignDivIncome + taxableGains - base.payrollDeductible);
            const finalTaxable = Math.max(0, grossTaxable - rrspContribution);

            // Pass qualifiedPension (age rules already applied) and grossedUpDivs for the
            // dividend tax credit. calculateTotalTax applies the OAS repayment deduction
            // before taxing, then adds the recovery back.
            const { total: finalTax, oasRecovery } = calculateTotalTax(
                finalTaxable, base.oasIncome, province, inflationFactor, age,
                qualifiedPension, grossedUpDivs, base.payrollCreditable
            );

            // Marginal attribution of investment tax by source: the extra tax each
            // source adds on top of all other income (tax with it minus tax without
            // it, including its OAS-clawback effect). Dividend tax can be negative —
            // at low income the dividend tax credit shelters other income too.
            const taxWithout = (excludedTaxable: number, excludeDivCredit = false) =>
                calculateTotalTax(
                    finalTaxable - excludedTaxable, base.oasIncome, province, inflationFactor,
                    age, qualifiedPension, excludeDivCredit ? 0 : grossedUpDivs, base.payrollCreditable
                ).total;
            // The deduction is worth this much cash. Step 4 sized the surplus using the
            // undeducted tax, so this refund is money the household has but hasn't
            // allocated yet — it gets swept below rather than silently inflating spend.
            const rrspDeductionRefund = rrspContribution > 0
                ? Math.max(0, calculateTotalTax(
                    grossTaxable, base.oasIncome, province, inflationFactor, age,
                    qualifiedPension, grossedUpDivs, base.payrollCreditable
                  ).total - finalTax)
                : 0;

            const capGainsTax = taxableGains > 0 ? Math.max(0, finalTax - taxWithout(taxableGains)) : 0;
            const dividendTax = grossedUpDivs > 0 ? finalTax - taxWithout(grossedUpDivs, true) : 0;
            const interestTax = (base.interestIncome + base.foreignDivIncome) > 0
                ? Math.max(0, finalTax - taxWithout(base.interestIncome + base.foreignDivIncome)) : 0;

            // Net cash per source for the charts is derived later by apportioning
            // the total tax pro-rata: Net Salary = Salary - (Salary / TotalGross) * TotalTax.
            return {
                finalTaxable,
                finalTax,
                totalRRSP,
                dbPensionIncome,
                rrifIncome,
                qualifiedPension,
                rrspDeductionRefund,
                grossedUpDivs,
                taxableGains,
                oasRecovery,
                capGainsTax,
                dividendTax,
                interestTax
            };
        };

        const pFinal = pAlive && pBase ? getFinalStats(pBase, pExtraRRSPGross, pRealizedGains, pAge, pRrspContribution) : null;
        const sFinal = sAlive && s && sBase ? getFinalStats(sBase, sExtraRRSPGross, sRealizedGains, sAge!, sRrspContribution) : null;

        // Sweep each person's RRSP-deduction refund into their non-registered account.
        // Without this the lower tax bill would surface as netIncome exceeding the
        // spending target — the cash is real, so it belongs in an account, not in
        // "money spent". Contributions only happen in surplus years, so this never
        // competes with a deficit withdrawal.
        for (const [who, refund] of [[p, pFinal?.rrspDeductionRefund || 0], [s, sFinal?.rrspDeductionRefund || 0]] as const) {
            if (!who || refund <= 0) continue;
            const target = surplusAccount(who);
            if (!target) continue;
            target.balance += refund;
            target.adjustedCostBase += refund; // contributed at cost
            reinvestedNonReg += refund;
        }

        let totalTaxPaid = (pFinal?.finalTax || 0) + (sFinal?.finalTax || 0);
        // Per-person tax for the table breakdown (replaced by post-split amounts below)
        let pTaxPaid = pFinal?.finalTax || 0;
        let sTaxPaid = sFinal?.finalTax || 0;
        let pensionSplitAmount = 0;
        let taxSavingsFromSplit = 0;

        // --- Step 5.5: Income Splitting Optimization ---
        // Apply pension income splitting if enabled and both spouses are alive
        if (inputs.useIncomeSplitting && pAlive && sAlive && pFinal && sFinal && pBase && sBase) {
            const pSplitInfo: SplitPerson = {
                taxableIncome: pFinal.finalTaxable,
                dbPensionIncome: pFinal.dbPensionIncome,
                rrifIncome: pFinal.rrifIncome,
                oasIncome: pBase.oasIncome,
                grossedUpDividends: pBase.divIncome * 1.38,
                age: pAge
            };
            const sSplitInfo: SplitPerson = {
                taxableIncome: sFinal.finalTaxable,
                dbPensionIncome: sFinal.dbPensionIncome,
                rrifIncome: sFinal.rrifIncome,
                oasIncome: sBase.oasIncome,
                grossedUpDividends: sBase.divIncome * 1.38,
                age: sAge!
            };

            const splitResult = calculateOptimalSplit(pSplitInfo, sSplitInfo, province, inflationFactor);

            if (splitResult.taxSavings > 0) {
                pensionSplitAmount = splitResult.splitAmount;
                taxSavingsFromSplit = splitResult.taxSavings;
                // Apply the new optimized tax amounts
                totalTaxPaid = splitResult.person1NewTax + splitResult.person2NewTax;
                pTaxPaid = splitResult.person1NewTax;
                sTaxPaid = splitResult.person2NewTax;
            }
        }

        // --- Step 6: Asset Growth (End of Year) ---

        // Non-Reg: interest/dividends were already paid out as cash above, so only the
        // capital-gain share of the balance appreciates: mix.capitalGain * capitalGrowth.
        // RRSP/TFSA grow at their own whole-account rates (default: capitalGrowth).
        const rrspRate = currentYearRates.rrspGrowth ?? currentYearRates.capitalGrowth;
        const tfsaRate = currentYearRates.tfsaGrowth ?? currentYearRates.capitalGrowth;

        // Without annual rebalancing, the weights are state: the equity slice's growth
        // shifts the composition each year (sales and reinvestment are pro-rata, so
        // only growth moves the weights). With rebalancing (the per-account default),
        // weights are reset to the inputs every year — the historical behavior.
        const growNonReg = (acct: NonRegisteredAccount) => {
            const w = acct.assetMix;
            const g = currentYearRates.capitalGrowth;
            const factor = 1 + (w.capitalGain * g);
            acct.balance *= factor;
            if (acct.rebalanceAnnually === false && factor > 0) {
                w.capitalGain = (w.capitalGain * (1 + g)) / factor;
                w.bonds /= factor;
                w.cash /= factor;
                w.dividend /= factor;
                w.foreignDividend = (w.foreignDividend || 0) / factor;
            }
        };

        if (pAlive) {
            p.rrsp.balance *= (1 + rrspRate);
            p.tfsa.balance *= (1 + tfsaRate);
            p.nonRegisteredAccounts.forEach(growNonReg);
        }
        if (sAlive && s) {
            s.rrsp.balance *= (1 + rrspRate);
            s.tfsa.balance *= (1 + tfsaRate);
            s.nonRegisteredAccounts.forEach(growNonReg);
        }


        // --- Result Construction ---

        // Calculate Granular Net Cash for Charts (Pro-rata Tax allocation)
        // Net Source = Gross Source - AllocatableTax

        const calcNet = (gross: number, totalGross: number, totalTax: number) => {
            if (totalGross <= 0) return 0;
            const share = gross / totalGross;
            return gross - (share * totalTax);
        };

        // The same pro-rata weight, reported rather than netted off a cash figure.
        // Taxable income has three components with no net-cash line of their own —
        // the taxable half of realized gains, and the two deductions that shrink the
        // base — so without these the per-source nets cannot partition the bill.
        const calcTaxShare = (amount: number, totalGross: number, totalTax: number) =>
            totalGross > 0 ? (amount / totalGross) * totalTax : 0;

        const pGrossTotal = pFinal?.finalTaxable || 0;
        const sGrossTotal = sFinal?.finalTaxable || 0;

        // Person Nets
        // Salary shown net of BOTH income tax and payroll withholding — CPP/EI never
        // reach the household's pocket.
        const pNetEmp = calcNet(pBase?.employmentIncome || 0, pGrossTotal, pFinal?.finalTax || 0)
            - (pBase?.payrollContributions || 0);
        const pNetCPP = calcNet(pBase?.cppIncome || 0, pGrossTotal, pFinal?.finalTax || 0);
        const pNetOAS = calcNet(pBase?.oasIncome || 0, pGrossTotal, pFinal?.finalTax || 0);
        const pNetPension = calcNet(pBase?.pensionIncome || 0, pGrossTotal, pFinal?.finalTax || 0);
        const pNetRRSP = calcNet(pFinal?.totalRRSP || 0, pGrossTotal, pFinal?.finalTax || 0);
        // Investment income (Interest + Divs) counts as taxable for tax allocation
        // But actual cash was purely Int + Div. We subtract the allocated tax from the CASH amount.
        // Tax allocated to investment was: (InvTaxable / Gross) * Tax.
        const pInvTax = (pGrossTotal > 0) ? (((pBase?.interestIncome || 0) + (pBase?.divIncome || 0) * 1.38 + (pBase?.foreignDivIncome || 0)) / pGrossTotal) * (pFinal?.finalTax || 0) : 0;
        const pNetInvCash = ((pBase?.interestIncome || 0) + (pBase?.divIncome || 0) + (pBase?.foreignDivIncome || 0)) - pInvTax;

        // Spouse Nets
        const sNetEmp = calcNet(sBase?.employmentIncome || 0, sGrossTotal, sFinal?.finalTax || 0)
            - (sBase?.payrollContributions || 0);
        const sNetCPP = calcNet(sBase?.cppIncome || 0, sGrossTotal, sFinal?.finalTax || 0);
        const sNetOAS = calcNet(sBase?.oasIncome || 0, sGrossTotal, sFinal?.finalTax || 0);
        const sNetPension = calcNet(sBase?.pensionIncome || 0, sGrossTotal, sFinal?.finalTax || 0);
        const sNetRRSP = calcNet(sFinal?.totalRRSP || 0, sGrossTotal, sFinal?.finalTax || 0);
        // Spouse Inv
        const sInvTax = (sGrossTotal > 0) ? (((sBase?.interestIncome || 0) + (sBase?.divIncome || 0) * 1.38 + (sBase?.foreignDivIncome || 0)) / sGrossTotal) * (sFinal?.finalTax || 0) : 0;
        const sNetInvCash = ((sBase?.interestIncome || 0) + (sBase?.divIncome || 0) + (sBase?.foreignDivIncome || 0)) - sInvTax;

        // TFSA withdrawals are tax-free (net = gross). Non-Reg sales are grossed-up by
        // sellNonReg so the sale's own tax is funded: pNonRegWithdrawal is the gross
        // debit from the account, pNonRegNet is the cash that went to spending — a
        // marginal solver estimate, NOT the pro-rata share, which is why the gains
        // share below is reported separately instead of being read off that gap.

        // Pro-rata shares of the remaining taxable-income components. Together with
        // the net* fields these exhaust finalTaxable, so the per-source shares add up
        // to finalTax exactly (see the year-audit Taxes partition).
        const taxShareOnCapGains =
            calcTaxShare(pFinal?.taxableGains || 0, pGrossTotal, pFinal?.finalTax || 0)
            + calcTaxShare(sFinal?.taxableGains || 0, sGrossTotal, sFinal?.finalTax || 0);
        const taxReliefFromPayrollDeduction =
            calcTaxShare(pBase?.payrollDeductible || 0, pGrossTotal, pFinal?.finalTax || 0)
            + calcTaxShare(sBase?.payrollDeductible || 0, sGrossTotal, sFinal?.finalTax || 0);
        const taxReliefFromRRSPDeduction =
            calcTaxShare(pRrspContribution, pGrossTotal, pFinal?.finalTax || 0)
            + calcTaxShare(sRrspContribution, sGrossTotal, sFinal?.finalTax || 0);

        // --- Step 7: Terminal Tax (Death Year Calculations) ---
        // Detect if this is the death year for either person
        const pDiedThisYear = pAge === p.lifeExpectancy;
        const sDiedThisYear = s && sAge === s.lifeExpectancy;
        const bothDiedThisYear = pDiedThisYear && sDiedThisYear;
        const isDeathYear = pDiedThisYear || sDiedThisYear;

        let terminalTaxOnRRSP = 0;
        let terminalTaxOnCapGains = 0;
        let rrspRolledToSpouse = 0;
        // Gross gains deemed realized at death this year. Accumulated only in the
        // no-rollover (deemed disposition) branches below; rollover branches keep
        // it 0 because ACB transfers to the survivor and the gains surface later.
        let terminalRealizedGains = 0;

        // Calculate terminal taxes when someone dies
        if (pDiedThisYear) {
            const pRRSPBalance = p.rrsp.balance;
            const pNonRegBalance = totalNonRegBalance(p);
            const pTFSABalance = p.tfsa.balance;
            const pACB = totalNonRegACB(p);
            const pUnrealizedGains = Math.max(0, pNonRegBalance - pACB);

            // Only rollover if spouse survives (not dying this year too)
            if (sAlive && s && !bothDiedThisYear) {
                // Rollover: Transfer RRSP to spouse's RRSP
                s.rrsp.balance += pRRSPBalance;
                rrspRolledToSpouse += pRRSPBalance;
                rolloverNonRegTo(s, p);
                // TFSA rolls over to spouse tax-free
                s.tfsa.balance += pTFSABalance;

                // CRITICAL: Zero out deceased balances to avoid double counting and accurately reflect estate
                p.rrsp.balance = 0;
                p.tfsa.balance = 0;
            } else {
                // No surviving spouse: Full deemed disposition
                terminalRealizedGains += pUnrealizedGains;
                // Combine RRSP + capital gains for single tax calculation (proper marginal rates)
                const taxableGains = calculateTaxableCapitalGains(pUnrealizedGains);
                const totalDeemedIncome = pRRSPBalance + taxableGains;

                if (totalDeemedIncome > 0) {
                    // Fix: Terminal tax must be calculated INCREMENTALLY on top of regular income this year
                    // to ensure it hits the correct marginal tax brackets.
                    const pRegularTaxable = pFinal?.finalTaxable || 0;
                    const pRegularTax = pFinal?.finalTax || 0;

                    // The two terms must be symmetric or the subtraction stops isolating the
                    // deemed disposition's marginal cost. These tax arguments must mirror
                    // getFinalStats exactly: same credits (qualified pension, grossed-up
                    // dividends) and the same OAS-clawback term, just on the higher income.
                    const deemedTaxable = pRegularTaxable + totalDeemedIncome;
                    const totalTaxWithDeemed = calculateTotalTax(
                        deemedTaxable, pBase?.oasIncome || 0, province, inflationFactor, pAge,
                        pFinal?.qualifiedPension || 0, pFinal?.grossedUpDivs || 0
                    ).total;
                    const incrementalTerminalTax = Math.max(0, totalTaxWithDeemed - pRegularTax);

                    terminalTaxOnRRSP += incrementalTerminalTax * (pRRSPBalance / totalDeemedIncome);
                    terminalTaxOnCapGains += incrementalTerminalTax * (taxableGains / totalDeemedIncome);

                    // Deduct tax from balances for net estate accurate reporting
                    const afterTaxRRSP = pRRSPBalance - (incrementalTerminalTax * (pRRSPBalance / totalDeemedIncome));
                    const afterTaxNonReg = pNonRegBalance - (incrementalTerminalTax * (taxableGains / totalDeemedIncome));

                    p.rrsp.balance = afterTaxRRSP;
                    scaleNonRegBalances(p, afterTaxNonReg, pNonRegBalance);
                }
            }
        }

        if (sDiedThisYear && s) {
            const sRRSPBalance = s.rrsp.balance;
            const sNonRegBalance = totalNonRegBalance(s);
            const sTFSABalance = s.tfsa.balance;
            const sACB = totalNonRegACB(s);
            const sUnrealizedGains = Math.max(0, sNonRegBalance - sACB);

            // Only rollover if person survives (not dying this year too)
            if (pAlive && !bothDiedThisYear) {
                // Rollover: Transfer RRSP to person's RRSP
                p.rrsp.balance += sRRSPBalance;
                rrspRolledToSpouse += sRRSPBalance;
                rolloverNonRegTo(p, s);
                // TFSA rolls over to person
                p.tfsa.balance += sTFSABalance;

                // CRITICAL: Zero out deceased balances
                s.rrsp.balance = 0;
                s.tfsa.balance = 0;
            } else {
                // No surviving spouse: Full deemed disposition
                terminalRealizedGains += sUnrealizedGains;
                const taxableGains = calculateTaxableCapitalGains(sUnrealizedGains);
                const totalDeemedIncome = sRRSPBalance + taxableGains;

                if (totalDeemedIncome > 0) {
                    // Fix: Incremental terminal tax
                    const sRegularTaxable = sFinal?.finalTaxable || 0;
                    const sRegularTax = sFinal?.finalTax || 0;

                    // Symmetry with the baseline is what makes this subtraction meaningful:
                    // these tax arguments must mirror getFinalStats exactly (same credits and
                    // OAS-clawback term), applied to the deemed-inclusive income.
                    const deemedTaxable = sRegularTaxable + totalDeemedIncome;
                    const totalTaxWithDeemed = calculateTotalTax(
                        deemedTaxable, sBase?.oasIncome || 0, province, inflationFactor, sAge!,
                        sFinal?.qualifiedPension || 0, sFinal?.grossedUpDivs || 0
                    ).total;
                    const incrementalTerminalTax = Math.max(0, totalTaxWithDeemed - sRegularTax);

                    terminalTaxOnRRSP += incrementalTerminalTax * (sRRSPBalance / totalDeemedIncome);
                    terminalTaxOnCapGains += incrementalTerminalTax * (taxableGains / totalDeemedIncome);

                    // Deduct tax from balances
                    const afterTaxRRSP = sRRSPBalance - (incrementalTerminalTax * (sRRSPBalance / totalDeemedIncome));
                    const afterTaxNonReg = sNonRegBalance - (incrementalTerminalTax * (taxableGains / totalDeemedIncome));

                    s.rrsp.balance = afterTaxRRSP;
                    scaleNonRegBalances(s, afterTaxNonReg, sNonRegBalance);
                }
            }
        }

        const totalTerminalTax = terminalTaxOnRRSP + terminalTaxOnCapGains;

        // Calculate estate values (only meaningful in death year or final year).
        //
        // The deemed-disposition branches above ALREADY deducted the terminal tax from
        // the deceased's RRSP and non-registered balances (so `totalAssets` — and the
        // balances shown in the year-by-year table — are post-tax). These balances are
        // therefore the NET estate, and the gross has to be reconstructed by adding the
        // tax back. Subtracting the tax from them again would double-count it.
        const postTaxBalances = (pAlive ? p.rrsp.balance + p.tfsa.balance + totalNonRegBalance(p) : 0) +
            (sAlive && s ? s.rrsp.balance + s.tfsa.balance + totalNonRegBalance(s) : 0);

        // Assets before terminal tax
        const grossEstateValue = postTaxBalances + totalTerminalTax;

        // What heirs actually receive = gross - terminal tax, deducted exactly once
        const netEstateValue = postTaxBalances;


        // Cash-basis gross income: actual dollars received, unlike finalTaxable which
        // includes the 38% dividend gross-up and the taxable share of realized gains
        // (the gains cash arrives via the gross Non-Reg sale added below).
        const pCashGross = (pBase?.employmentIncome || 0) + (pBase?.cppIncome || 0) + (pBase?.oasIncome || 0) +
            (pBase?.pensionIncome || 0) +
            (pFinal?.totalRRSP || 0) + (pBase?.interestIncome || 0) + (pBase?.divIncome || 0) + (pBase?.foreignDivIncome || 0);
        const sCashGross = (sBase?.employmentIncome || 0) + (sBase?.cppIncome || 0) + (sBase?.oasIncome || 0) +
            (sBase?.pensionIncome || 0) +
            (sFinal?.totalRRSP || 0) + (sBase?.interestIncome || 0) + (sBase?.divIncome || 0) + (sBase?.foreignDivIncome || 0);

        results.push({
            year: new Date().getFullYear() + yearOffset,
            age: pAge,
            spouseAge: sAge,
            totalAssets: (pAlive ? p.rrsp.balance + p.tfsa.balance + totalNonRegBalance(p) : 0) +
                (sAlive && s ? s.rrsp.balance + s.tfsa.balance + totalNonRegBalance(s) : 0),
            grossIncome: pGrossTotal + sGrossTotal,
            cppIncome: (pBase?.cppIncome || 0) + (sBase?.cppIncome || 0),
            oasIncome: (pBase?.oasIncome || 0) + (sBase?.oasIncome || 0),
            pensionIncome: (pBase?.pensionIncome || 0) + (sBase?.pensionIncome || 0),
            netPensionIncome: pNetPension + sNetPension,
            // Actual spending funded this year: after-tax cash minus the surplus that was
            // reinvested rather than spent (RRIF minimums / CPP can force income past the
            // target). Equals targetSpend when funded, targetSpend - shortfall when not.
            netIncome: pCashGross + sCashGross + annualOneTimeInflows - totalTaxPaid
                - ((pBase?.payrollContributions || 0) + (sBase?.payrollContributions || 0))
                + pTFSAWithdrawal + sTFSAWithdrawal + pNonRegWithdrawal + sNonRegWithdrawal
                - (reinvestedTFSA + reinvestedRRSP + reinvestedNonReg),
            spending: targetSpend,
            taxPaid: totalTaxPaid,
            // End-of-year non-reg composition, per person (undefined once a
            // person has no accounts — dead, or rolled over to the survivor)
            nonRegMix: pAlive ? blendedNonRegMix(p.nonRegisteredAccounts) : undefined,
            spouseNonRegMix: sAlive && s ? blendedNonRegMix(s.nonRegisteredAccounts) : undefined,
            nonRegDriftMix: pAlive ? driftingNonRegMix(p) : undefined,
            spouseNonRegDriftMix: sAlive && s ? driftingNonRegMix(s) : undefined,
            personTaxPaid: pTaxPaid,
            spouseTaxPaid: sTaxPaid,
            // Household OAS clawback (pre-split; splitting's effect is in taxSavingsFromSplit)
            oasClawbackPaid: (pFinal?.oasRecovery || 0) + (sFinal?.oasRecovery || 0),
            // Investment tax by source (household, marginal attribution, pre-split)
            capGainsTaxPaid: (pFinal?.capGainsTax || 0) + (sFinal?.capGainsTax || 0),
            terminalRealizedGains,
            dividendTaxPaid: (pFinal?.dividendTax || 0) + (sFinal?.dividendTax || 0),
            interestTaxPaid: (pFinal?.interestTax || 0) + (sFinal?.interestTax || 0),
            accounts: {
                rrsp: pAlive ? p.rrsp.balance : 0,
                tfsa: pAlive ? p.tfsa.balance : 0,
                nonRegistered: pAlive ? totalNonRegBalance(p) : 0,
                nonRegisteredACB: pAlive ? totalNonRegACB(p) : 0
            },
            spouseAccounts: sAlive && s ? {
                rrsp: s.rrsp.balance,
                tfsa: s.tfsa.balance,
                nonRegistered: totalNonRegBalance(s),
                spouseNonRegisteredACB: totalNonRegACB(s)
            } : undefined,

            // New Visualization Fields
            netEmploymentIncome: pNetEmp + sNetEmp,
            netCPPIncome: pNetCPP + sNetCPP,
            netOASIncome: pNetOAS + sNetOAS,
            // Per-person nets for the table's You/Spouse hover breakdown
            personNetCPP: pNetCPP,
            spouseNetCPP: sNetCPP,
            personNetOAS: pNetOAS,
            spouseNetOAS: sNetOAS,
            personNetPension: pNetPension,
            spouseNetPension: sNetPension,
            netInvestmentIncome: pNetInvCash + sNetInvCash,
            taxShareOnCapGains,
            taxReliefFromPayrollDeduction,
            taxReliefFromRRSPDeduction,

            // Reinvestments
            reinvestedTFSA,
            reinvestedRRSP,
            reinvestedNonReg,

            // Split Nets
            personNetRRSP: pNetRRSP,
            spouseNetRRSP: sNetRRSP,
            personNetTFSA: pTFSAWithdrawal,
            spouseNetTFSA: sTFSAWithdrawal,
            personNetNonReg: pNonRegNet,
            spouseNetNonReg: sNonRegNet,

            // Raw
            totalTFSAWithdrawal: pTFSAWithdrawal + sTFSAWithdrawal,
            totalNonRegWithdrawal: pNonRegWithdrawal + sNonRegWithdrawal,
            totalRRSPWithdrawal: (pFinal?.totalRRSP || 0) + (sFinal?.totalRRSP || 0),

            // Just for checking
            netRRSPWithdrawal: pNetRRSP + sNetRRSP,
            netTFSAWithdrawal: pTFSAWithdrawal + sTFSAWithdrawal,
            netNonRegWithdrawal: pNonRegNet + sNonRegNet,

            employmentIncome: (pBase?.employmentIncome || 0) + (sBase?.employmentIncome || 0),
            investmentIncome: (pBase?.interestIncome || 0) + (pBase?.divIncome || 0) + (pBase?.foreignDivIncome || 0) + (sBase?.interestIncome || 0) + (sBase?.divIncome || 0) + (sBase?.foreignDivIncome || 0),
            totalRealizedCapGains: pRealizedGains + sRealizedGains,
            inflationFactor,
            householdSurplus: surplus, // The initial surplus before reinvestment
            shortfall,

            // Income Splitting
            pensionSplitAmount,
            taxSavingsFromSplit,

            // Estate / Death Year
            isDeathYear,
            personDeathThisYear: pDiedThisYear,
            spouseDeathThisYear: sDiedThisYear,
            terminalTaxOnRRSP,
            terminalTaxOnCapGains,
            totalTerminalTax,
            grossEstateValue,
            netEstateValue,
            rrspRolledToSpouse
        });
    }

    return results;
}

// Federal RRIF Minimum Withdrawal Factors (Post-2015)
// The factor age is the annuitant's age on Jan 1 of the withdrawal year.
// When called from the engine: factorAge = calendarAge - 1.
const RRIF_MINIMUMS: { [age: number]: number } = {
    71: 0.0528, 72: 0.0540, 73: 0.0553, 74: 0.0567, 75: 0.0582,
    76: 0.0598, 77: 0.0617, 78: 0.0636, 79: 0.0658, 80: 0.0682,
    81: 0.0708, 82: 0.0738, 83: 0.0771, 84: 0.0808, 85: 0.0851,
    86: 0.0899, 87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192,
    91: 0.1306, 92: 0.1449, 93: 0.1634, 94: 0.1879
};

// Returns the RRIF minimum factor for a given age (age on Jan 1)
function getRRIFMinFactor(age: number): number {
    if (age <= 70) return 1 / (90 - age); // CRA formula for under-71
    if (age >= 95) return 0.20;
    return RRIF_MINIMUMS[age] || 0.06;
}

export function runMonteCarlo(inputs: SimulationInputs, iterations: number = 200): MonteCarloResult {
    const rawRuns: SimulationResult[][] = [];

    // Run N simulations
    for (let i = 0; i < iterations; i++) {
        rawRuns.push(runSimulation(inputs, true));
    }

    // Guard: runSimulation returns [] for invalid age configurations
    if (rawRuns[0].length === 0) {
        return { percentiles: [], successRate: 0, medianEndOfPlanAssets: 0 };
    }

    // Process Results
    // All runs have the same length (same life expectancy inputs)
    const years = rawRuns[0].length;
    const percentiles: MonteCarloPercentile[] = [];

    for (let i = 0; i < years; i++) {
        // Extract total assets for this specific year across all runs
        const assetsAtYear = rawRuns.map(run => run[i].totalAssets);
        const refRun = rawRuns[0][i];

        // Sort to find percentiles
        assetsAtYear.sort((a, b) => a - b);

        const getP = (p: number) => assetsAtYear[Math.floor(p * iterations)];

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

    // Success Rate: a run fails if it ever left spending unfunded.
    // (Cumulative tolerance of $1,000 to ignore rounding-level gaps.)
    const failures = rawRuns.filter(run =>
        run.reduce((sum, year) => sum + year.shortfall, 0) > 1000
    ).length;

    return {
        percentiles,
        successRate: ((iterations - failures) / iterations) * 100,
        medianEndOfPlanAssets: percentiles[percentiles.length - 1].p50
    };
}
