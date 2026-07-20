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
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">

                    {/* Hero: Net Estate */}
                    <div className="summary-card summary-card--emerald col-span-2 lg:col-span-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Net Estate</p>
                        <p className="text-2xl font-bold text-emerald-600 font-mono leading-tight mt-0.5">
                            {formatCurrencyCAD(metrics.netEstateValue)}
                        </p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">Before tax: {formatCurrencyCAD(metrics.estate)}</p>
                    </div>

                    {/* Withdrawal Rate */}
                    <div className="summary-card summary-card--cyan">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Withdrawal Rate</p>
                        <p className="text-xl font-bold text-cyan-600 font-mono leading-tight mt-0.5">
                            {metrics.initialWithdrawalRate.toFixed(1)}%
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">Initial year</p>
                    </div>

                    {/* Retirement Tax Rate */}
                    <div className="summary-card summary-card--red-300">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Retirement Tax Rate</p>
                        <p className="text-xl font-bold text-red-500 font-mono leading-tight mt-0.5">
                            {metrics.effectiveTaxRateRetirement.toFixed(1)}%
                        </p>
                        <div className="flex flex-col gap-0.5 mt-0.5">
                            <p className="text-xs text-slate-500 font-mono">Net {formatCurrencyCAD(metrics.netRetirementIncome)}</p>
                            <p className="text-xs text-red-400 font-mono">Tax {formatCurrencyCAD(metrics.annualTaxRetirement)}</p>
                        </div>
                    </div>

                    {/* Estate Tax Rate */}
                    <div className="summary-card summary-card--red-300">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Estate Tax Rate</p>
                        <p className="text-xl font-bold text-red-500 font-mono leading-tight mt-0.5">
                            {metrics.effectiveTaxRateEstate.toFixed(1)}%
                        </p>
                        <div className="flex flex-col gap-0.5 mt-0.5">
                            <p className="text-xs text-slate-500 font-mono">Net {formatCurrencyCAD(metrics.netEstateValue)}</p>
                            <p className="text-xs text-red-400 font-mono">Tax {formatCurrencyCAD(metrics.estateTax)}</p>
                        </div>
                    </div>

                    {/* Total Tax Rate */}
                    <div className="summary-card summary-card--red-400">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Tax Rate</p>
                        <p className="text-xl font-bold text-red-600 font-mono leading-tight mt-0.5">
                            {metrics.totalEffectiveTaxRate.toFixed(1)}%
                        </p>
                        <div className="flex flex-col gap-0.5 mt-0.5">
                            <p className="text-xs text-slate-500 font-mono">Net {formatCurrencyCAD(metrics.totalNetValue)}</p>
                            <p className="text-xs text-red-400 font-mono">Tax {formatCurrencyCAD(metrics.totalTaxPlusEstate)}</p>
                        </div>
                    </div>

                    {/* Optional: Monte Carlo */}
                    {monteCarlo && (
                        <div className="summary-card summary-card--indigo col-span-2 lg:col-span-1">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Monte Carlo Success Rate</p>
                            <p className="text-xl font-bold text-indigo-600 font-mono leading-tight mt-0.5">
                                {monteCarlo.successRate.toFixed(1)}%
                            </p>
                            <p className="text-xs text-slate-400 font-mono mt-0.5">Median {formatCurrencyCAD(monteCarlo.medianEndOfPlanAssets)}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
