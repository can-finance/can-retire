import type { EarliestAgeResult } from '../../utils/meltdownOptimizer';
import { Fragment } from 'react';
import { formatCurrencyCAD, formatSuccessRate } from '../../utils/formatters';
import { HelpTooltip } from '../ui/HelpTooltip';

/*
 * The "When can I retire?" trade-off table: a row per retirement age around the
 * answer, showing the odds at the planned spending and what each age costs or
 * buys (money left at the end, total tax paid, and how much you could spend instead). Pure
 * presentation over EarliestAgeResult, shared with the landing page.
 *
 * The table scrolls sideways inside its own box on narrow screens (min width on
 * the table, overflow on the wrapper), so the page itself never scrolls.
 */
export function EarliestAgeTable({
    result, planLabel = 'your plan',
}: {
    result: EarliestAgeResult;
    /** Tag on the row at the plan's own age; null hides it (no target to point at). */
    planLabel?: string | null;
}) {
    const rows = result.rows;
    if (rows.length === 0) return null;

    const showOther = rows.some(r => r.otherRetirementAge !== undefined);
    const isSpouse = result.reportedWho === 'spouse';
    const ageHeader = isSpouse ? 'Spouse retires at' : showOther ? 'You retire at' : 'Retire at';
    const spend = `${formatCurrencyCAD(result.postRetirementSpend)}/yr`;
    const target = result.mcSuccessTarget;

    const th = 'font-medium text-slate-500 py-2 whitespace-nowrap';

    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-slate-200">
                            <th className={`${th} text-left pr-4`}>{ageHeader}</th>
                            {showOther && <th className={`${th} text-left pr-4`}>Spouse</th>}
                            <th className={`${th} text-right pl-4`}>Success</th>
                            <th className={`${th} text-right pl-4`}>
                                <HelpTooltip text="What's left when the plan ends, after tax at death.">
                                    <span className="cursor-help border-b border-dashed border-slate-400">Left at the end</span>
                                </HelpTooltip>
                            </th>
                            <th className={`${th} text-right pl-4`}>Total tax paid</th>
                            <th className={`${th} text-right pl-4`}>
                                <HelpTooltip text={`About the most you could spend each year retiring at that age, with the same choices shown for that age, and still meet your ${target}% target.`}>
                                    <span className="cursor-help border-b border-dashed border-slate-400">Could spend</span>
                                </HelpTooltip>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <Fragment key={r.delta}>
                            {/* The plan's own age can sit apart from the rows around
                                the answer; mark the ages skipped in between. */}
                            {i > 0 && r.delta - rows[i - 1].delta > 1 && (
                                <tr className="border-b border-slate-100 text-slate-400">
                                    <td colSpan={showOther ? 6 : 5} className="py-1 pl-2 text-left text-xs">
                                        ⋯
                                    </td>
                                </tr>
                            )}
                            <tr
                                className={`border-b border-slate-100 last:border-0 ${
                                    r.isAnswer ? 'bg-brand-50 font-semibold text-slate-900' : 'text-slate-700'
                                }`}
                            >
                                <td className="text-left py-2 pr-4 pl-2 whitespace-nowrap tabular-nums">
                                    {r.retirementAge}
                                    {r.isAnswer && (
                                        <span className="ml-2 inline-block rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white align-middle">
                                            Earliest
                                        </span>
                                    )}
                                    {r.isPlan && planLabel && (
                                        <span className="ml-2 text-xs font-normal text-slate-500">{planLabel}</span>
                                    )}
                                </td>
                                {showOther && (
                                    <td className="text-left py-2 pr-4 whitespace-nowrap tabular-nums">
                                        {r.otherRetirementAge ?? '—'}
                                    </td>
                                )}
                                <td className={`text-right py-2 pl-4 whitespace-nowrap tabular-nums ${
                                    r.clearsTarget ? 'text-emerald-700' : 'text-rose-600'
                                }`}>
                                    <span aria-hidden="true">{r.clearsTarget ? '✓' : '✗'}</span>{' '}
                                    {formatSuccessRate(r.successRate, target)}
                                    <span className="sr-only">{r.clearsTarget ? ' (meets target)' : ' (below target)'}</span>
                                </td>
                                <td className="text-right py-2 pl-4 whitespace-nowrap tabular-nums">
                                    {formatCurrencyCAD(r.netEstate)}
                                </td>
                                <td className="text-right py-2 pl-4 whitespace-nowrap tabular-nums">
                                    {formatCurrencyCAD(r.lifetimeTax)}
                                </td>
                                <td className="text-right py-2 pl-4 pr-2 whitespace-nowrap tabular-nums">
                                    {r.couldSpend === null ? '—' : `${formatCurrencyCAD(r.couldSpend)}/yr`}
                                </td>
                            </tr>
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                Success is the share of market simulations in which your money lasts, spending {spend};
                ✓ meets your {target}% target. Left at the end and total tax paid use the best strategy
                for each age. All amounts are in today's dollars.
            </p>
        </div>
    );
}
