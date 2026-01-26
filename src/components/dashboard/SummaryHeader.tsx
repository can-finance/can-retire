interface SummaryMetrics {
    estate: number;
    estateTax: number;
    annualTaxRetirement: number;
    effectiveTaxRateRetirement: number;
    effectiveTaxRateEstate: number;
    totalEffectiveTaxRate: number;
    totalTaxPlusEstate: number;
    totalRetirementIncome: number;
    netRetirementIncome: number;
    netEstateValue: number;
    totalNetValue: number;
    initialWithdrawalRate: number;
}

import type { MonteCarloResult } from '../../engine/types';

interface SummaryHeaderProps {
    metrics: SummaryMetrics;
    monteCarlo?: MonteCarloResult | null;
}

export function SummaryHeader({ metrics, monteCarlo }: SummaryHeaderProps) {
    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="lg:sticky lg:top-16 z-20 -mx-4 px-4 py-4 bg-slate-50/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    {/* a) Estate Value */}
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Net Estate</p>
                        <p className="text-lg font-bold text-green-600">
                            {formatCurrency(metrics.netEstateValue)}
                        </p>
                        <p className="text-[10px] text-slate-400">Before Tax: {formatCurrency(metrics.estate)}</p>
                    </div>

                    {/* Withdrawal Rate */}
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-cyan-600 text-[10px] font-bold uppercase tracking-wider">Withdrawal Rate</p>
                        <p className="text-lg font-bold text-cyan-600">
                            {metrics.initialWithdrawalRate.toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-slate-400">Initial Year</p>
                    </div>

                    {/* b) Retirement Tax Rate */}
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Retirement Tax Rate</p>
                        <p className="text-lg font-bold text-red-500">
                            {metrics.effectiveTaxRateRetirement.toFixed(1)}%
                        </p>
                        <div className="flex flex-col gap-0.5">
                            <p className="text-[11px] font-semibold text-green-600">Net: {formatCurrency(metrics.netRetirementIncome)}</p>
                            <p className="text-[10px] text-red-400">Tax: {formatCurrency(metrics.annualTaxRetirement)}</p>
                        </div>
                    </div>

                    {/* c) Estate Tax Rate */}
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Estate Tax Rate</p>
                        <p className="text-lg font-bold text-red-600">
                            {metrics.effectiveTaxRateEstate.toFixed(1)}%
                        </p>
                        <div className="flex flex-col gap-0.5">
                            <p className="text-[11px] font-semibold text-green-600">Net: {formatCurrency(metrics.netEstateValue)}</p>
                            <p className="text-[10px] text-red-400">Tax: {formatCurrency(metrics.estateTax)}</p>
                        </div>
                    </div>

                    {/* d) Total Tax Rate */}
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Total Tax Rate</p>
                        <p className="text-lg font-bold text-red-600">
                            {metrics.totalEffectiveTaxRate.toFixed(1)}%
                        </p>
                        <div className="flex flex-col gap-0.5">
                            <p className="text-[11px] font-semibold text-green-600">Net: {formatCurrency(metrics.totalNetValue)}</p>
                            <p className="text-[10px] text-red-400">Tax: {formatCurrency(metrics.totalTaxPlusEstate)}</p>
                        </div>
                    </div>

                    {/* Optional: Monte Carlo (if active, displayed as an extra card) */}
                    {monteCarlo && (
                        <div className="bg-indigo-50 rounded-xl p-3 shadow-sm border border-indigo-100 col-span-2 lg:col-span-1">
                            <p className="text-indigo-600 text-[10px] font-bold uppercase tracking-wider">Probability of Success</p>
                            <p className="text-lg font-bold text-indigo-700">
                                {monteCarlo.successRate.toFixed(1)}%
                            </p>
                            <p className="text-[10px] text-indigo-400">Median End Wealth: {formatCurrency(monteCarlo.medianEndOfPlanAssets)}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
