import type { PersonMeltdownDecision } from '../../utils/meltdownOptimizer';
import { formatCurrencyCAD } from '../../utils/formatters';

type WithdrawalStrategy = 'tax-efficient' | 'rrsp-first';

/*
 * One plain-language line on what a recommendation changed in the strategy —
 * CPP/OAS start ages, the RRSP melt, the withdrawal order — for a headline
 * that can't fit the full current-vs-suggested tables. Returns null when
 * nothing changed. Kept outside the components so the earliest-age landing
 * page can reuse it with the same result data. The fields it words are the
 * ones strategyDiffersFromPlan checks, so the two always agree on whether
 * anything changed.
 */
export function describeStrategyChanges(
    decisions: PersonMeltdownDecision[],
    currentStrategy: WithdrawalStrategy,
    suggestedStrategy: WithdrawalStrategy,
): string | null {
    const parts: string[] = [];

    for (const d of decisions) {
        const whose = d.who === 'spouse' ? 'your spouse’s' : 'your';
        if (d.cppChanged) parts.push(`start ${whose} CPP at ${d.cppStartAge} instead of ${d.originalCppStartAge}`);
        if (d.oasChanged) parts.push(`start ${whose} OAS at ${d.oasStartAge} instead of ${d.originalOasStartAge}`);
        if (d.hasRrsp && d.meltAmount !== d.originalMeltAmount) {
            parts.push(d.meltAmount > 0
                ? `take ${formatCurrencyCAD(d.meltAmount)}/yr from ${whose} RRSP from ${d.meltStartAge} to ${d.meltEndAge}`
                : `stop the early withdrawals from ${whose} RRSP`);
        }
    }
    if (suggestedStrategy !== currentStrategy) {
        parts.push(suggestedStrategy === 'rrsp-first' ? 'draw on your RRSP first' : 'draw on your RRSP last');
    }

    if (parts.length === 0) return null;
    const list = parts.length === 1
        ? parts[0]
        : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    return `To get there: ${list}.`;
}
