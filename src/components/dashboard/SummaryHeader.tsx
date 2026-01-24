
interface SummaryMetrics {
    estate: number;
    estateTax: number;
    annualTaxRetirement: number;
    effectiveTaxRateRetirement: number;
    effectiveTaxRateEstate: number;
    totalEffectiveTaxRate: number;
    totalSpend: number;
    totalRetirementIncome: number;
}

interface SummaryHeaderProps {
    metrics: SummaryMetrics;
}

export function SummaryHeader({ metrics }: SummaryHeaderProps) {
    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="sticky top-16 z-20 -mx-4 px-4 py-4 bg-slate-50/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Estate Value</p>
                        <p className="text-lg font-bold text-slate-900">
                            {formatCurrency(metrics.estate)}
                        </p>
                        <p className="text-[10px] text-slate-400">Tax on Death: {formatCurrency(metrics.estateTax)}</p>
                    </div>
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Retirement Tax</p>
                        <p className="text-lg font-bold text-red-500">
                            {formatCurrency(metrics.annualTaxRetirement)}
                        </p>
                        <p className="text-[10px] text-slate-400">Eff. Rate: {metrics.effectiveTaxRateRetirement.toFixed(1)}%</p>
                    </div>
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Estate Tax Rate</p>
                        <p className="text-lg font-bold text-red-600">
                            {metrics.effectiveTaxRateEstate.toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-slate-400">Terminal Tax Rate</p>
                    </div>
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Total Eff. Tax Rate</p>
                        <p className="text-lg font-bold text-amber-600">
                            {metrics.totalEffectiveTaxRate.toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-slate-400">Retire + Estate Combined</p>
                    </div>
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Lifetime Spend</p>
                        <p className="text-lg font-bold text-blue-600">
                            {formatCurrency(metrics.totalSpend)}
                        </p>
                    </div>
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Retirement Income</p>
                        <p className="text-lg font-bold text-green-600">
                            {formatCurrency(metrics.totalRetirementIncome)}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
