import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SimulationResult } from '../../engine/types';

interface SurplusChartProps {
    data: SimulationResult[];
    inflationAdjusted: boolean;
}

export function SurplusChart({ data, inflationAdjusted }: SurplusChartProps) {
    const formatCurrency = (val: number) => {
        const absVal = Math.abs(val);
        if (absVal >= 1000) return `$${(absVal / 1000).toFixed(0)}k`;
        return `$${absVal}`;
    };

    const chartData = useMemo(() => {
        return data.map(d => {
            const factor = inflationAdjusted ? d.inflationFactor : 1.0;
            return {
                age: d.age,
                ReinvestedTFSA: d.reinvestedTFSA / factor,
                ReinvestedRRSP: d.reinvestedRRSP / factor,
                ReinvestedNonReg: d.reinvestedNonReg / factor
            };
        });
    }, [data, inflationAdjusted]);

    // Only show if there is ANY surplus in the projection
    const hasSurplus = chartData.some(d => (d.ReinvestedTFSA + d.ReinvestedRRSP + d.ReinvestedNonReg) > 100);

    if (!hasSurplus) {
        return (
            <div className="h-[200px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100 flex items-center justify-center">
                <p className="text-slate-400 text-sm italic">No surplus income detected to reinvest.</p>
            </div>
        );
    }

    return (
        <div className="h-[350px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-lg font-bold text-slate-900">Surplus Reinvestment</h3>
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
                            const hasValues = payload.some((p: any) => Math.abs(Number(p.value)) >= 1);
                            if (!hasValues) return null;

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
                    <Legend iconType="circle" />

                    <Bar dataKey="ReinvestedTFSA" name="To TFSA" stackId="a" fill="#10b981" />
                    <Bar dataKey="ReinvestedRRSP" name="To RRSP" stackId="a" fill="#0ea5e9" />
                    <Bar dataKey="ReinvestedNonReg" name="To Non-Reg" stackId="a" fill="#f59e0b" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
