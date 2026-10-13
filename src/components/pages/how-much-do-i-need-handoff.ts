import type { SimulationInputs } from '../../engine/types';
import { applyMeltdownRecommendation } from '../../utils/meltdownOptimizer';
import type { MeltdownResult } from '../../utils/meltdownOptimizer';
import { formatCurrencyApprox } from '../../utils/formatters';
import { savingsAnswerClears } from '../optimizer/savingsNeededSummary';

/*
 * What the /how-much-do-i-need-to-retire/ "See the full plan" link opens: which
 * plan, under what name, and what the button says. The page turns it into a
 * #start= share link (the full planner opens it as a new plan).
 *
 *  - Need more: the plan at the savings needed (recommendedInputs — balances
 *    and the strategy the amount assumes), named after the amount, so the
 *    planner shows what the answer looks like year by year.
 *  - Have enough: the plan as entered — balances are facts, so they never
 *    shrink to the lower amount — with the answer's strategy merged in only
 *    when the plan needs it to clear the bar (strategyChangeNeeded).
 *  - No amount works: the plan as entered, to adjust in the planner.
 */

export interface NeedHandoff {
    inputs: SimulationInputs;
    name: string;
    buttonLabel: 'See the full plan' | 'Open in the full planner';
}

export function needHandoff(
    r: Pick<MeltdownResult, 'savingsNeeded' | 'baselineInputs' | 'recommendedInputs'>,
): NeedHandoff | null {
    const sn = r.savingsNeeded;
    if (!sn) return null;
    const age = sn.retirementAge;
    const isSpouse = sn.reportedWho === 'spouse';
    // Named after whoever the answer is about, like the earliest-age page.
    const planName = age === null
        ? 'My plan'
        : isSpouse ? `Spouse retires at ${age}` : `Retire at ${age}`;

    if (!savingsAnswerClears(sn)) {
        return { inputs: r.baselineInputs, name: planName, buttonLabel: 'Open in the full planner' };
    }

    if (!sn.haveEnough) {
        // The headline's amount: what you'd hold on the day you retire, or
        // today's when already retired.
        const amount = formatCurrencyApprox(sn.neededAtRetirement ?? sn.neededSavings!);
        const name = age === null ? `Retire now with ${amount}` : `${planName} with ${amount}`;
        return { inputs: r.recommendedInputs, name, buttonLabel: 'See the full plan' };
    }

    const inputs = sn.strategyChangeNeeded
        ? applyMeltdownRecommendation(r.baselineInputs, r.recommendedInputs, 'savings-needed')
        : r.baselineInputs;
    return { inputs, name: planName, buttonLabel: 'See the full plan' };
}
