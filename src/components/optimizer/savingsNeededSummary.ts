import type { MeltdownResult, SavingsNeededResult } from '../../utils/meltdownOptimizer';
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
