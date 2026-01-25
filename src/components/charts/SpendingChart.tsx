import { useMemo } from 'react';
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Line, ComposedChart } from 'recharts';
import type { SimulationResult } from '../../engine/types';

interface SpendingChartProps {
    data: SimulationResult[];
    hasSpouse: boolean;
    inflationAdjusted: boolean;
}

export function SpendingChart({ data, hasSpouse, inflationAdjusted }: SpendingChartProps) {
    const formatCurrency = (val: number) => {
        const absVal = Math.abs(val);
        if (absVal >= 1000) return `$${(absVal / 1000).toFixed(0)}k`;
        return `$${absVal}`;
    };

    const chartData = useMemo(() => {
        return data.map(d => {
            const factor = inflationAdjusted ? d.inflationFactor : 1.0;
            const targetSpend = d.spending / factor;

            return {
                age: d.age,
                NetEmployment: d.netEmploymentIncome / factor,
                NetCPP: d.netCPPIncome / factor,
                NetOAS: d.netOASIncome / factor,
                NetInvestment: d.netInvestmentIncome / factor,

                // Withdrawals (already Net in new engine)
                PersonNetRRSP: d.personNetRRSP / factor,
                SpouseNetRRSP: d.spouseNetRRSP / factor,

                PersonNetTFSA: d.personNetTFSA / factor,
                SpouseNetTFSA: d.spouseNetTFSA / factor,

                PersonNetNonReg: d.personNetNonReg / factor,
                SpouseNetNonReg: d.spouseNetNonReg / factor,

                TargetSpend: targetSpend,
                TaxPaid: -d.taxPaid / factor
            };
        });
    }, [data, inflationAdjusted]);

    return (
        <div className="h-[500px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-lg font-bold text-slate-900">Annual Spending Funding Sources</h3>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
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
                            return (
                                <div className="bg-white p-3 border border-slate-100 shadow-lg rounded-xl">
                                    <p className="text-sm font-bold text-slate-900 mb-2">Age {label}</p>
                                    <div className="space-y-1">
                                        {payload.map((entry: any, index: number) => {
                                            const val = Number(entry.value);
                                            if (Math.abs(val) < 1) return null;
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
                                "Target Spend",
                                "Spouse Non-Reg",
                                "Non-Reg",
                                "Spouse TFSA",
                                "TFSA",
                                "Spouse RRSP",
                                "RRSP",
                                "Yield (Net)",
                                "OAS (Net)",
                                "CPP (Net)",
                                "Net Salary",
                                "Taxes Paid"
                            ];

                            // Sort payload based on the desired order
                            const sortedPayload = [...payload].sort((a: any, b: any) => {
                                // Handle special case for "Sp." vs "Spouse" mapping if needed, 
                                // currently names match fairly well but some have abbreviations
                                const nameA = a.value;
                                const nameB = b.value;

                                // Helper to partial match since names vary slightly (e.g. "Sp. RRSP")
                                const getIndex = (name: string) => {
                                    // Exact match first
                                    let idx = desiredOrder.indexOf(name);
                                    if (idx !== -1) return idx;
                                    // Try matching known abbreviations
                                    if (name === "Sp. RRSP") return desiredOrder.indexOf("Spouse RRSP");
                                    if (name === "Sp. TFSA") return desiredOrder.indexOf("Spouse TFSA");
                                    if (name === "Sp. Non-Reg") return desiredOrder.indexOf("Spouse Non-Reg");
                                    return 999;
                                };

                                return getIndex(nameA) - getIndex(nameB);
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

                    {/* Target Line */}
                    <Line type="monotone" dataKey="TargetSpend" stroke="#0f172a" strokeWidth={2} dot={false} name="Target Spend" />

                    {/* Sources Stack (Bottom to Top) */}
                    <Bar dataKey="NetEmployment" name="Net Salary" stackId="a" fill="#94a3b8" />
                    <Bar dataKey="NetCPP" name="CPP (Net)" stackId="a" fill="#8b5cf6" />
                    <Bar dataKey="NetOAS" name="OAS (Net)" stackId="a" fill="#c4b5fd" />
                    <Bar dataKey="NetInvestment" name="Yield (Net)" stackId="a" fill="#a78bfa" />

                    {/* RRSP Group: Primary (Bottom), Spouse (Top) */}
                    <Bar dataKey="PersonNetRRSP" name="RRSP" stackId="a" fill="#0ea5e9" />
                    {hasSpouse && <Bar dataKey="SpouseNetRRSP" name="Sp. RRSP" stackId="a" fill="#38bdf8" />}

                    {/* TFSA Group: Primary (Bottom), Spouse (Top) */}
                    <Bar dataKey="PersonNetTFSA" name="TFSA" stackId="a" fill="#10b981" />
                    {hasSpouse && <Bar dataKey="SpouseNetTFSA" name="Sp. TFSA" stackId="a" fill="#34d399" />}

                    {/* Non-Reg Group: Primary (Bottom), Spouse (Top) */}
                    <Bar dataKey="PersonNetNonReg" name="Non-Reg" stackId="a" fill="#f59e0b" />
                    {hasSpouse && <Bar dataKey="SpouseNetNonReg" name="Sp. Non-Reg" stackId="a" fill="#fbbf24" />}

                    {/* Tax (Negative Stack) */}
                    <Bar dataKey="TaxPaid" name="Taxes Paid" stackId="a" fill="#ef4444" />

                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}
