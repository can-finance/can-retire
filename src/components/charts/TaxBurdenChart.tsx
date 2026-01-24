import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import type { SimulationResult } from '../../engine/types';

interface TaxBurdenChartProps {
    data: SimulationResult[];
    hasSpouse: boolean;
    inflationAdjusted: boolean;
}

export function TaxBurdenChart({ data, hasSpouse, inflationAdjusted }: TaxBurdenChartProps) {
    const formatCurrency = (val: number) => {
        const absVal = Math.abs(val);
        if (absVal >= 1000) return `$${(absVal / 1000).toFixed(0)}k`;
        return `$${absVal}`;
    };

    // Transform data for the chart
    const chartData = useMemo(() => {
        return data.map(d => {
            const factor = inflationAdjusted ? d.inflationFactor : 1.0;

            // Calculate effective tax rate on taxable sources to assume "Net" contribution
            const totalTaxableSources = d.grossIncome;
            const effectiveTaxRate = totalTaxableSources > 0 ? d.taxPaid / totalTaxableSources : 0;
            const netMultiplier = Math.max(0, 1 - effectiveTaxRate);

            // Calculate Net Contributions using explicit data from engine
            const netEmployment = (d.employmentIncome * netMultiplier) / factor;
            const netInvestment = (d.investmentIncome * netMultiplier) / factor;
            const netCPP = (d.cppIncome * netMultiplier) / factor;
            const netOAS = (d.oasIncome * netMultiplier) / factor;
            // Person Net Contributions
            const personNetRRSP = (d.personRRSPWithdrawal * netMultiplier) / factor;
            const personNetTFSA = d.personTFSAWithdrawal / factor;
            const personNetNonReg = d.personNonRegWithdrawal / factor;

            // Spouse Net Contributions
            const spouseNetRRSP = ((d.spouseRRSPWithdrawal ?? 0) * netMultiplier) / factor;
            const spouseNetTFSA = (d.spouseTFSAWithdrawal ?? 0) / factor;
            const spouseNetNonReg = (d.spouseNonRegWithdrawal ?? 0) / factor;

            // Scale all sources to match the actual "Total Spend" (Net Income)
            const rawSum = netEmployment + netInvestment + netCPP + netOAS +
                personNetRRSP + personNetTFSA + personNetNonReg +
                spouseNetRRSP + spouseNetTFSA + spouseNetNonReg;

            const targetSpend = d.netIncome;
            const scale = rawSum > 0 ? targetSpend / rawSum : 0;

            return {
                age: d.age,
                NetEmployment: netEmployment * scale,
                NetInvestment: netInvestment * scale,
                NetCPP: netCPP * scale,
                NetOAS: netOAS * scale,
                PersonNetRRSP: personNetRRSP * scale,
                PersonNetTFSA: personNetTFSA * scale,
                PersonNetNonReg: personNetNonReg * scale,
                SpouseNetRRSP: spouseNetRRSP * scale,
                SpouseNetTFSA: spouseNetTFSA * scale,
                SpouseNetNonReg: spouseNetNonReg * scale,
                TaxPaid: -d.taxPaid / factor
            };
        });
    }, [data, inflationAdjusted]);

    return (
        <div className="h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-lg font-bold text-slate-900">Sources of Spending</h3>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 5 }}
                    stackOffset="sign"
                >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                        dataKey="age"
                        stroke="#64748b"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        tickFormatter={formatCurrency}
                        stroke="#64748b"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <Tooltip
                        cursor={{ fill: '#f1f5f9' }}
                        content={({ active, payload, label }) => {
                            if (!active || !payload || !payload.length) return null;

                            // Calculate Total Net (Spendable)
                            const totalNet = payload
                                .filter((p: any) => p.name !== 'Tax')
                                .reduce((acc: number, p: any) => acc + (Number(p.value) || 0), 0);

                            const totalGross = totalNet + Math.abs(Number(payload.find((p: any) => p.name === 'Tax')?.value) || 0);
                            const avgTaxRate = totalGross > 0 ? (totalGross - totalNet) / totalGross : 0;

                            return (
                                <div className="bg-white p-3 border border-slate-100 shadow-lg rounded-xl">
                                    <p className="text-sm font-bold text-slate-900 mb-0.5">Age {label}</p>
                                    <p className="text-[10px] text-slate-400 mb-2 uppercase font-bold tracking-tight">Avg. Tax Rate: {(avgTaxRate * 100).toFixed(1)}%</p>
                                    <div className="space-y-1">
                                        {[...payload].reverse().map((entry: any, index: number) => {
                                            const val = Number(entry.value);
                                            if (val < 1) return null;
                                            return (
                                                <div key={index} className="flex items-center justify-between gap-4 text-xs">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                        <span className="text-slate-600">{entry.name}</span>
                                                    </div>
                                                    <span className="font-medium text-slate-900">
                                                        {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(val)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                        <div className="border-t border-slate-100 my-2" />
                                        <div className="flex items-center justify-between gap-4 text-xs font-bold text-slate-900">
                                            <span>Total Spend (Net)</span>
                                            <span>{new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(totalNet)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-4 text-xs text-slate-400">
                                            <span>Total Gross</span>
                                            <span>{new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(totalGross)}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        }}
                    />
                    <Legend
                        iconType="circle"
                        content={(props: any) => {
                            const { payload } = props;
                            if (!payload) return null;

                            // Explicitly define the desired order (Visual Top to Bottom)
                            const desiredOrder = [
                                "Non-Reg",
                                "Sp. Non-Reg",
                                "TFSA",
                                "Sp. TFSA",
                                "RRSP/RRIF",
                                "Sp. RRSP/RRIF",
                                "OAS",
                                "CPP",
                                "Salary",
                                "Tax"
                            ];

                            // Sort the payload based on the desired order
                            const sortedPayload = [...payload].sort((a, b) => {
                                const indexA = desiredOrder.indexOf(a.value);
                                const indexB = desiredOrder.indexOf(b.value);
                                // Handle cases where an item might not be in desiredOrder (though it should be)
                                if (indexA === -1 && indexB === -1) return 0;
                                if (indexA === -1) return 1; // Push unknown items to the end
                                if (indexB === -1) return -1; // Push unknown items to the end
                                return indexA - indexB;
                            });

                            return (
                                <ul className="flex flex-wrap justify-center gap-6 mt-4 p-0 list-none">
                                    {sortedPayload.map((entry: any, index: number) => (
                                        <li key={`item-${index}`} className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                                            <span
                                                className="w-3 h-3 rounded-full"
                                                style={{ backgroundColor: entry.color }}
                                            />
                                            {entry.value}
                                        </li>
                                    ))}
                                </ul>
                            );
                        }}
                    />
                    <ReferenceLine y={0} stroke="#94a3b8" />

                    {/* Sources (Positive Stack) */}
                    {/* 1. Fixed Income Base */}
                    <Bar dataKey="NetEmployment" name="Salary" stackId="stack" fill="#94a3b8" />
                    <Bar dataKey="NetCPP" name="CPP" stackId="stack" fill="#8b5cf6" />
                    <Bar dataKey="NetOAS" name="OAS" stackId="stack" fill="#c4b5fd" />

                    {/* 2. RRSP Group (Spouse then User) */}
                    {hasSpouse && (
                        <Bar dataKey="SpouseNetRRSP" name="Sp. RRSP/RRIF" stackId="stack" fill="#38bdf8" />
                    )}
                    <Bar dataKey="PersonNetRRSP" name="RRSP/RRIF" stackId="stack" fill="#0ea5e9" />

                    {/* 3. TFSA Group (Spouse then User) */}
                    {hasSpouse && (
                        <Bar dataKey="SpouseNetTFSA" name="Sp. TFSA" stackId="stack" fill="#34d399" />
                    )}
                    <Bar dataKey="PersonNetTFSA" name="TFSA" stackId="stack" fill="#10b981" />

                    {/* 4. Non-Reg Group (Spouse then User) */}
                    {hasSpouse && (
                        <Bar dataKey="SpouseNetNonReg" name="Sp. Non-Reg" stackId="stack" fill="#fbbf24" />
                    )}
                    <Bar dataKey="PersonNetNonReg" name="Non-Reg" stackId="stack" fill="#f59e0b" />

                    {/* Tax (Negative Stack) */}
                    <Bar dataKey="TaxPaid" name="Tax" stackId="stack" fill="#ef4444" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
