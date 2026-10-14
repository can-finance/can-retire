import type { SimulationInputs } from '../../engine/types';
import type { MeltdownResult, SavingsNeededResult, SavingsPerYearResult } from '../../utils/meltdownOptimizer';
import { formatCurrencyApprox } from '../../utils/formatters';
import { describeStrategyChanges } from './strategySummary';

/*
 * The rules about a "How much do I need to retire?" answer that the answer box
 * (SavingsNeededHeadline), the landing page's hand-off link and the in-app
 * optimizer's buttons must agree on, kept in one place so a state that reads
 * as "no amount works" in the box can never offer to save that amount.
 */

/** The parts of an optimizer result the savings answer box reads. */
export type SavingsAnswer = Pick<MeltdownResult, 'savingsNeeded' | 'baselineInputs' | 'baselineSuccessRate' | 'decisions'>;

/**
 * Whether there is an amount that clears the success bar. False when even the
 * search cap fails on average returns (unreachable), when even the cap misses
 * the bar (boundHit), and when the probe budget ran out before any amount
 * cleared it (stepUpCapHit below the target): in the last two the reported
 * total is only the best probe, not an answer.
 */
export function savingsAnswerClears(sn: SavingsNeededResult): boolean {
    if (sn.status !== 'found' || sn.neededSavings === null) return false;
    if (sn.boundHit) return false;
    if (sn.stepUpCapHit && (sn.achievedSuccessRate ?? 0) < sn.mcSuccessTarget) return false;
    return true;
}

/**
 * "To get there: …" for a savings answer, or null when there is nothing to
 * change. Needing more: the amount assumes the answer's CPP/OAS starts, melt
 * and withdrawal order, so they are part of the answer. Having enough: only
 * when the plan as entered misses the bar without them (strategyChangeNeeded,
 * the same rule as the earliest-age answer at the plan's own age); otherwise
 * the search's pick is a preference, not a fix.
 */
export function savingsStrategyNote(r: SavingsAnswer): string | null {
    const sn = r.savingsNeeded;
    if (!sn || !savingsAnswerClears(sn)) return null;
    if (sn.haveEnough && !sn.strategyChangeNeeded) return null;
    return describeStrategyChanges(
        r.decisions,
        r.baselineInputs.withdrawalStrategy ?? 'tax-efficient',
        sn.withdrawalStrategy,
    );
}

/**
 * Below this many dollars a year (today's), the save-as-you-go amount is
 * within what market simulations wobble between runs: it reads as "a little
 * less", not as a figure.
 */
export const SAVE_AS_YOU_GO_SMALL = 1_000;

/** A save-as-you-go answer with a yearly amount that clears the bar. */
export type SaveAsYouGoPlan = SavingsPerYearResult & { extraPerYear: number; recommendedInputs: SimulationInputs };

/**
 * The save-as-you-go plan ("spend about $R less a year before you retire and
 * save the difference"), or null when there is none to offer: only alongside
 * a lump-sum answer that clears the bar and is more than you have, and only
 * when some yearly amount clears it too. Its plan is today's balances with the
 * lower before-retirement spending and its own strategy, ready to save or open
 * as it is (applyMeltdownRecommendation would drop the spending change).
 */
export function saveAsYouGoPlan(sn: SavingsNeededResult): SaveAsYouGoPlan | null {
    if (!savingsAnswerClears(sn) || sn.haveEnough) return null;
    const p = sn.perYear;
    if (!p || !p.clears || p.extraPerYear === null || p.recommendedInputs === null) return null;
    return p as SaveAsYouGoPlan;
}

/** "$14k/yr", or null when the amount is too small to state (see SAVE_AS_YOU_GO_SMALL). */
export function saveAsYouGoAmount(extraPerYear: number): string | null {
    return extraPerYear < SAVE_AS_YOU_GO_SMALL ? null : `${formatCurrencyApprox(extraPerYear)}/yr`;
}

/**
 * Whether to show the "savings needed at each retirement age" table: when
 * there is more than the plan's own row (that one only repeats the answer).
 */
export function savingsAgeTableShown(sn: SavingsNeededResult): boolean {
    return sn.ageRows.length > 1;
}
