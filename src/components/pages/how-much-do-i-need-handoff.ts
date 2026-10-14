import type { SimulationInputs } from '../../engine/types';
import { applyMeltdownRecommendation } from '../../utils/meltdownOptimizer';
import type { MeltdownResult, SavingsNeededResult } from '../../utils/meltdownOptimizer';
import { formatCurrencyApprox } from '../../utils/formatters';
import { saveAsYouGoAmount, saveAsYouGoPlan, savingsAnswerClears } from '../optimizer/savingsNeededSummary';

/*
 * What the /how-much-do-i-need-to-retire/ hand-off links open: which plan,
 * under what name, and what the button says. The page turns each into a
 * #start= share link (the full planner opens it as a new plan).
 *
 * needHandoff, the main link:
 *  - Need more: the plan at the savings needed (recommendedInputs — balances
 *    and the strategy the amount assumes), named after the amount, so the
 *    planner shows what the answer looks like year by year.
 *  - Have enough: the plan as entered — balances are facts, so they never
 *    shrink to the lower amount — with the answer's strategy merged in only
 *    when the plan needs it to clear the bar (strategyChangeNeeded).
 *  - No amount works: the plan as entered, to adjust in the planner.
 *
 * needSaveAsYouGoHandoff, a second link beside it only when saving as you go
 * works (saveAsYouGoPlan): today's balances with the lower before-retirement
 * spending and that answer's strategy, exactly as the solver built it.
 */

export interface NeedHandoff {
    inputs: SimulationInputs;
    name: string;
    buttonLabel: 'See the full plan' | 'Open in the full planner' | 'See the save-as-you-go plan';
}

// Named after whoever the answer is about, like the earliest-age page.
function planNameFor(sn: SavingsNeededResult): string {
    const age = sn.retirementAge;
    if (age === null) return 'My plan';
    return sn.reportedWho === 'spouse' ? `Spouse retires at ${age}` : `Retire at ${age}`;
}

export function needHandoff(
    r: Pick<MeltdownResult, 'savingsNeeded' | 'baselineInputs' | 'recommendedInputs'>,
): NeedHandoff | null {
    const sn = r.savingsNeeded;
    if (!sn) return null;
    const age = sn.retirementAge;
    const planName = planNameFor(sn);

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

/**
 * The save-as-you-go plan as a hand-off, named after the age and the yearly
 * amount ("Retire at 60, save $14k/yr more"), or null when there is none.
 */
export function needSaveAsYouGoHandoff(r: Pick<MeltdownResult, 'savingsNeeded'>): NeedHandoff | null {
    const sn = r.savingsNeeded;
    if (!sn) return null;
    const plan = saveAsYouGoPlan(sn);
    if (!plan) return null;
    const amount = saveAsYouGoAmount(plan.extraPerYear);
    return {
        inputs: plan.recommendedInputs,
        name: `${planNameFor(sn)}, ${amount === null ? 'save a little more' : `save ${amount} more`}`,
        buttonLabel: 'See the save-as-you-go plan',
    };
}
