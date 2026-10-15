import type { NonRegisteredAccount, Person, SimulationInputs } from '../engine/types';
import { runSimulation } from '../engine/projection';
import { preRetirementSpendYears } from './savingsSearch';

/*
 * How far spending before retirement runs ahead of the household's take-home
 * pay, in the first year of the plan (today's dollars). The engine draws that
 * difference from savings every working year, so a plan that overspends its
 * pay needs savings just to reach retirement.
 *
 * Measured with the engine itself: the plan is run with every balance zeroed
 * (and no one-time expenses or inflows), so nothing but pay, pensions and
 * government benefits funds year one, and whatever spending they can't cover
 * is that year's shortfall. Tax, CPP/EI contributions and income splitting
 * are therefore exactly the engine's.
 */

export interface PreRetirementDeficit {
    /** Spending before retirement minus take-home pay; 0 when pay covers it. */
    deficit: number;
    /** Household take-home pay (after tax) in the first year. */
    takeHome: number;
}

const NONE: PreRetirementDeficit = { deficit: 0, takeHome: 0 };

const emptyAccounts = (p: Person): Person => ({
    ...p,
    rrsp: { ...p.rrsp, balance: 0 },
    tfsa: { ...p.tfsa, balance: 0 },
    nonRegisteredAccounts: p.nonRegisteredAccounts.map((a): NonRegisteredAccount =>
        ({ ...a, balance: 0, adjustedCostBase: 0 })),
});

export function preRetirementDeficit(inputs: SimulationInputs): PreRetirementDeficit {
    // Everyone already retired: no spending before retirement to compare.
    if (preRetirementSpendYears(inputs) === 0) return NONE;
    const bare: SimulationInputs = {
        ...inputs,
        person: emptyAccounts(inputs.person),
        spouse: inputs.spouse ? emptyAccounts(inputs.spouse) : inputs.spouse,
        oneTimeExpenses: [],
    };
    const year = runSimulation(bare)[0];
    if (!year) return NONE;
    // With nothing to withdraw, take-home pay is the spending it funded plus
    // what was left over (householdSurplus) — or minus what it couldn't fund.
    const deficit = Math.max(0, year.shortfall);
    return { deficit, takeHome: year.spending + year.householdSurplus - deficit };
}
