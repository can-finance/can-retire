import type { SavingsAgeRow, SavingsNeededResult } from '../../utils/meltdownOptimizer';
import { formatCurrencyApprox, formatCurrencyCAD, formatSuccessRate, roundCurrencyApprox } from '../../utils/formatters';
import { HelpTooltip } from '../ui/HelpTooltip';
import { savingsAgeTableShown } from './savingsNeededSummary';

/*
 * The "How much do I need to retire?" table of nearby ages: a row per
 * retirement age around the plan's own, showing the savings you'd need by
 * then, what you're on track for, the difference, and your odds with what you
 * have. Pure presentation over SavingsNeededResult.ageRows, shared with the
 * landing page, and laid out like the earliest-age table.
 *
 * The plan's own row is the headline answer; the others are estimates that
 * keep the answer's choices, so they err a little high. Amounts are rounded
 * like the headline's (separate runs of market simulations move them by a few
 * percent), and the difference is taken between the rounded figures. A row
 * with no amount that meets the target shows a dash, never its best try.
 *
 * The table scrolls sideways inside its own box on narrow screens (min width on
 * the table, overflow on the wrapper), so the page itself never scrolls.
 */

const money = formatCurrencyApprox;

interface RowAmounts {
    needed: number | null;  // null when no amount meets the target at this age
    none: boolean;          // nothing needed today: shown as "None", all savings to spare
    current: number;
    today: boolean;         // retiring this year: today's figures stand in
}

// What a row shows. Retiring this year leaves no working year to grow
// through, so the at-retirement pair is null and today's figures stand in.
// A row that needs nothing today shows "None" rather than its at-retirement
// figure (which would be only the pay saved until then, grown).
function rowAmounts(r: SavingsAgeRow, currentSavings: number): RowAmounts {
    const today = r.currentAtRetirement === null;
    const none = r.clears && r.neededSavings === 0;
    const neededRaw = none ? 0 : today ? r.neededSavings : r.neededAtRetirement;
    return {
        needed: r.clears && neededRaw !== null ? neededRaw : null,
        none,
        current: today ? currentSavings : r.currentAtRetirement!,
        today,
    };
}

function difference(a: RowAmounts): string {
    if (a.needed === null) return '—';
    const gap = roundCurrencyApprox(a.needed) - roundCurrencyApprox(a.current);
    if (gap > 0) return `${money(gap)} more`;
    if (gap < 0) return `${money(-gap)} to spare`;
    return 'about right';
}

export function SavingsNeededTable({
    result, planLabel = 'your plan',
}: {
    result: SavingsNeededResult;
    /** Tag on the row at the plan's own age (the headline answer); null hides it. */
    planLabel?: string | null;
}) {
    if (!savingsAgeTableShown(result)) return null;
    const rows = result.ageRows;

    const showOther = rows.some(r => r.otherRetirementAge !== undefined);
    const isSpouse = result.reportedWho === 'spouse';
    const ageHeader = isSpouse ? 'Spouse retires at' : showOther ? 'You retire at' : 'Retire at';
    const when = isSpouse ? 'when your spouse retires at that age' : 'when you retire at that age';
    const spend = `${formatCurrencyCAD(result.postRetirementSpend)}/yr`;
    const target = result.mcSuccessTarget;
    const anyMissing = rows.some(r => !r.clears);
    const anyToday = rows.some(r => r.currentAtRetirement === null);

    const th = 'font-medium text-slate-500 py-2 whitespace-nowrap';
    const tip = 'cursor-help border-b border-dashed border-slate-400';

    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[38rem] text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-slate-200">
                            <th className={`${th} text-left pr-4`}>{ageHeader}</th>
                            {showOther && <th className={`${th} text-left pr-4`}>Spouse</th>}
                            <th className={`${th} text-right pl-4`}>
                                <HelpTooltip text={`Household savings needed ${when}, to last in at least ${target}% of market simulations.`}>
                                    <span className={tip}>Need by then</span>
                                </HelpTooltip>
                            </th>
                            <th className={`${th} text-right pl-4`}>
                                <HelpTooltip text="What you have now plus what you keep saving from your pay, grown to then.">
                                    <span className={tip}>On track for</span>
                                </HelpTooltip>
                            </th>
                            <th className={`${th} text-right pl-4`}>Difference</th>
                            <th className={`${th} text-right pl-4`}>Odds with what you have</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => {
                            const a = rowAmounts(r, result.currentSavings);
                            const meets = r.successRateAtCurrent >= target;
                            const todayTag = a.today && (
                                <span className="ml-1 text-xs font-normal text-slate-500">today</span>
                            );
                            return (
                                <tr
                                    key={r.delta}
                                    className={`border-b border-slate-100 last:border-0 ${
                                        r.isPlan ? 'bg-brand-50 font-semibold text-slate-900' : 'text-slate-700'
                                    }`}
                                >
                                    <td className="text-left py-2 pr-4 pl-2 whitespace-nowrap tabular-nums">
                                        {r.retirementAge}
                                        {r.isPlan && planLabel && (
                                            <span className="ml-2 text-xs font-normal text-slate-500">{planLabel}</span>
                                        )}
                                    </td>
                                    {showOther && (
                                        <td className="text-left py-2 pr-4 whitespace-nowrap tabular-nums">
                                            {r.otherRetirementAge ?? '—'}
                                        </td>
                                    )}
                                    <td className="text-right py-2 pl-4 whitespace-nowrap tabular-nums">
                                        {a.needed === null ? '—' : a.none ? 'None' : <>{money(a.needed)}{todayTag}</>}
                                    </td>
                                    <td className="text-right py-2 pl-4 whitespace-nowrap tabular-nums">
                                        {money(a.current)}{todayTag}
                                    </td>
                                    <td className="text-right py-2 pl-4 whitespace-nowrap tabular-nums">
                                        {difference(a)}
                                    </td>
                                    <td className={`text-right py-2 pl-4 pr-2 whitespace-nowrap tabular-nums ${
                                        meets ? 'text-emerald-700' : 'text-rose-600'
                                    }`}>
                                        <span aria-hidden="true">{meets ? '✓' : '✗'}</span>{' '}
                                        {formatSuccessRate(r.successRateAtCurrent, target)}
                                        <span className="sr-only">{meets ? ' (meets target)' : ' (below target)'}</span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                Other ages are estimates that keep your answer's choices and may run a little high.
                Odds use the savings you have now, at {spend}; ✓ meets your {target}% target.
                {anyMissing && ' A dash means no amount meets your target.'}
                {anyToday && " Retiring this year uses today's amounts."}
                {' '}Amounts are in today's dollars.
            </p>
        </div>
    );
}
