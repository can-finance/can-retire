import type { MonteCarloResult } from '../../engine/types';
import type { SummaryMetrics } from '../../utils/summaryMetrics';
import { formatCurrencyCAD } from '../../utils/formatters';

interface SummaryHeaderProps {
    metrics: SummaryMetrics;
    monteCarlo?: MonteCarloResult | null;
}

export function SummaryHeader({ metrics, monteCarlo }: SummaryHeaderProps) {

    return (
        <div className="lg:sticky lg:top-16 z-20 -mx-4 px-4 py-4 bg-slate-50/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
            <div className="max-w-7xl mx-auto">
                {/* Column count tracks the card count so the row always fills exactly,
                    rather than leaving a hole or wrapping: hero 3 + withdrawal 2 + tax 4
                    = 9, plus 2 more when the optional Monte Carlo card is present. */}
                <div className={`grid grid-cols-2 gap-3 ${monteCarlo ? 'lg:grid-cols-11' : 'lg:grid-cols-9'}`}>

                    {/* Hero: Net Estate — the number this whole tool exists to move, so
                        it is deliberately the largest thing in the header. */}
                    <div className="summary-card summary-card--emerald col-span-2 lg:col-span-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Net Estate</p>
                        <p className="text-4xl font-bold text-emerald-600 font-mono leading-tight mt-0.5">
                            {formatCurrencyCAD(metrics.netEstateValue)}
                        </p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">Before tax: {formatCurrencyCAD(metrics.estate)}</p>
                    </div>

                    {/* Withdrawal Rate */}
                    <div className="summary-card summary-card--cyan lg:col-span-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Withdrawal Rate</p>
                        <p className="text-xl font-bold text-cyan-600 font-mono leading-tight mt-0.5">
                            {metrics.initialWithdrawalRate.toFixed(1)}%
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">Initial year</p>
                    </div>

                    {/* Tax — one card, three rows, no hover required to see any of it.
                        The Tax and Net COLUMNS are true sums: computeSummaryMetrics
                        defines totalTaxPlusEstate and totalNetValue as literal additions
                        of the retirement and estate figures above them. Setting them out
                        as columns with a rule above the Total row is what makes the
                        combination self-evident.
                        The Rate column is NOT a sum — each rate is measured against its
                        own base (retirement income, estate value), and the total rate is
                        those two bases blended. That is why the rule and the word "Total"
                        do their work through the two additive columns, and why the rates
                        sit alongside as a per-row attribute rather than being totalled.
                        Do not add a "+" or "=" to the Rate column; the arithmetic there
                        does not hold. */}
                    <div className="summary-card summary-card--red-400 col-span-2 lg:col-span-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tax</p>
                        <table className="w-full mt-1 text-xs">
                            <thead>
                                <tr className="text-slate-500">
                                    <th scope="col" className="text-left font-medium">
                                        <span className="sr-only">Stage</span>
                                    </th>
                                    <th scope="col" className="text-right font-medium pl-2">Rate</th>
                                    <th scope="col" className="text-right font-medium pl-2">Tax</th>
                                    <th scope="col" className="text-right font-medium pl-2">Net</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <th scope="row" className="text-left font-medium text-slate-700">Retirement</th>
                                    <td className="text-right font-mono font-semibold text-red-600 pl-2">{metrics.effectiveTaxRateRetirement.toFixed(1)}%</td>
                                    <td className="text-right font-mono text-red-600 pl-2">{formatCurrencyCAD(metrics.annualTaxRetirement)}</td>
                                    <td className="text-right font-mono text-slate-600 pl-2">{formatCurrencyCAD(metrics.netRetirementIncome)}</td>
                                </tr>
                                <tr>
                                    <th scope="row" className="text-left font-medium text-slate-700">Estate</th>
                                    <td className="text-right font-mono font-semibold text-red-600 pl-2">{metrics.effectiveTaxRateEstate.toFixed(1)}%</td>
                                    <td className="text-right font-mono text-red-600 pl-2">{formatCurrencyCAD(metrics.estateTax)}</td>
                                    <td className="text-right font-mono text-slate-600 pl-2">{formatCurrencyCAD(metrics.netEstateValue)}</td>
                                </tr>
                                <tr className="border-t-2 border-slate-300">
                                    <th scope="row" className="text-left font-bold text-slate-900 pt-1">Total</th>
                                    <td className="text-right font-mono font-bold text-red-700 pl-2 pt-1">{metrics.totalEffectiveTaxRate.toFixed(1)}%</td>
                                    <td className="text-right font-mono font-bold text-red-700 pl-2 pt-1">{formatCurrencyCAD(metrics.totalTaxPlusEstate)}</td>
                                    <td className="text-right font-mono font-bold text-slate-900 pl-2 pt-1">{formatCurrencyCAD(metrics.totalNetValue)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* Optional: Monte Carlo */}
                    {monteCarlo && (
                        <div className="summary-card summary-card--indigo col-span-2 lg:col-span-2">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Monte Carlo Success Rate</p>
                            <p className="text-xl font-bold text-indigo-600 font-mono leading-tight mt-0.5">
                                {monteCarlo.successRate.toFixed(1)}%
                            </p>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">Median {formatCurrencyCAD(monteCarlo.medianEndOfPlanAssets)}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
