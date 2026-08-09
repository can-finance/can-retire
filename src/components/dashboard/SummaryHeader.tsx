import type { MonteCarloResult } from '../../engine/types';
import type { SummaryMetrics } from '../../utils/summaryMetrics';
import { formatCurrencyCAD } from '../../utils/formatters';

interface SummaryHeaderProps {
    metrics: SummaryMetrics;
    monteCarlo?: MonteCarloResult | null;
}

/**
 * The sticky readout above the dashboard. Because it stays on screen while the
 * inputs beside it are edited, it is an instrument panel rather than a summary:
 * it should answer "did that change help?" at a glance.
 *
 * Four zones, in the order the questions actually get asked — does the money
 * last, what do I get to spend, what is left, what did it cost. The first three
 * are outcomes; tax is the price paid for them, so it reads last and smallest
 * despite taking the most width (three rates need three rows).
 *
 * The column count is fixed at 12 (3 + 2 + 3 + 4). Monte Carlo is a line inside
 * the outcome card rather than a card of its own, so turning it on or off never
 * reflows the grid — it is a confidence qualifier on the verdict, which is
 * exactly where it belongs.
 */
export function SummaryHeader({ metrics, monteCarlo }: SummaryHeaderProps) {
    // outOfMoneyAge is null when every year's spending was funded.
    const runsShort = metrics.outOfMoneyAge !== null;

    return (
        <div className="lg:sticky lg:top-16 z-20 -mx-4 px-4 py-4 bg-slate-50/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-2 lg:grid-cols-12 gap-3">

                    {/* 1. Does the money last? The only card that changes colour, so a
                        plan that fails is visible without reading anything.
                        The verdict is kept to two or three words so it holds one line —
                        the detail belongs on the caption beneath it, not in the headline. */}
                    <div className={`summary-card col-span-2 lg:col-span-4 ${runsShort ? 'summary-card--red-400' : 'summary-card--emerald'}`}>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Plan Outcome</p>
                        <p className={`text-xl font-bold leading-tight mt-0.5 ${runsShort ? 'text-red-600' : 'text-emerald-600'}`}>
                            {runsShort ? `Runs short at ${metrics.outOfMoneyAge}` : 'Fully funded'}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                            {runsShort
                                ? `${formatCurrencyCAD(metrics.totalShortfall)} of spending unfunded`
                                : 'Spending covered every year of the plan'}
                        </p>
                        {monteCarlo && (
                            <p className="text-xs text-slate-500 mt-1.5">
                                Success rate{' '}
                                <span className="font-mono font-bold text-slate-700">{monteCarlo.successRate.toFixed(1)}%</span>
                            </p>
                        )}
                    </div>

                    {/* 2. What do I get to spend? Lifetime spending actually funded —
                        computed all along and never surfaced. Sits beside the estate
                        deliberately: every dollar not spent shows up in that card. */}
                    <div className="summary-card summary-card--cyan col-span-2 lg:col-span-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Lifetime Spend</p>
                        <p className="text-2xl font-bold text-cyan-600 font-mono leading-tight mt-0.5">
                            {formatCurrencyCAD(metrics.totalSpending)}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {runsShort ? 'after the shortfall' : 'all spending funded'}
                        </p>
                    </div>

                    {/* 3. What is left? */}
                    <div className="summary-card summary-card--emerald col-span-2 lg:col-span-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Net Estate</p>
                        <p className="text-2xl font-bold text-emerald-600 font-mono leading-tight mt-0.5">
                            {formatCurrencyCAD(metrics.netEstateValue)}
                        </p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                            after {formatCurrencyCAD(metrics.estateTax)} estate tax
                        </p>
                    </div>

                    {/* 4. What did it cost? All three rates on the surface, no hover.
                        The Amount COLUMN is a true sum — computeSummaryMetrics defines
                        totalTaxPlusEstate as a literal addition — which is what lets the
                        rule and the Total row show the combination without a tooltip, and
                        why Amount leads: the column that actually adds up is the one that
                        should sit nearest the row labels.
                        The Rate column is NOT summed: each rate is measured against its
                        own base (retirement income, estate value) and the total rate is
                        those bases blended, so 11.4% and 0.0% giving 8.0% is correct but
                        not additive. Do not add a "+" or "=" to the Rate column. */}
                    <div className="summary-card summary-card--red-400 col-span-2 lg:col-span-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tax</p>
                        <table className="w-full mt-1 text-xs">
                            <thead>
                                <tr className="text-slate-500">
                                    <th scope="col" className="text-left font-medium">
                                        <span className="sr-only">Stage</span>
                                    </th>
                                    <th scope="col" className="text-right font-medium pl-2">Amount</th>
                                    <th scope="col" className="text-right font-medium pl-2">Rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <th scope="row" className="text-left font-medium text-slate-700">Retirement</th>
                                    <td className="text-right font-mono text-red-600 pl-2">{formatCurrencyCAD(metrics.annualTaxRetirement)}</td>
                                    <td className="text-right font-mono font-semibold text-red-600 pl-2">{metrics.effectiveTaxRateRetirement.toFixed(1)}%</td>
                                </tr>
                                <tr>
                                    <th scope="row" className="text-left font-medium text-slate-700">Estate</th>
                                    <td className="text-right font-mono text-red-600 pl-2">{formatCurrencyCAD(metrics.estateTax)}</td>
                                    <td className="text-right font-mono font-semibold text-red-600 pl-2">{metrics.effectiveTaxRateEstate.toFixed(1)}%</td>
                                </tr>
                                <tr className="border-t-2 border-slate-300">
                                    <th scope="row" className="text-left font-bold text-slate-900 pt-1">Total</th>
                                    <td className="text-right font-mono font-bold text-red-700 pl-2 pt-1">{formatCurrencyCAD(metrics.totalTaxPlusEstate)}</td>
                                    <td className="text-right font-mono font-bold text-red-700 pl-2 pt-1">{metrics.totalEffectiveTaxRate.toFixed(1)}%</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
