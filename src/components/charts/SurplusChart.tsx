import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SimulationResult } from '../../engine/types';

interface SurplusChartProps {
    data: SimulationResult[];
    inflationAdjusted: boolean;
    domainMax?: number;
}

export const SurplusChart = React.memo(function SurplusChart({ data, inflationAdjusted, domainMax }: SurplusChartProps) {
    const formatCurrency = (val: number) => {
        if (Math.abs(val) >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
        if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(0)}k`;
        return `$${val}`;
    };

    const chartData = useMemo(() => {
        return data.map(d => {
            const factor = inflationAdjusted ? d.inflationFactor : 1.0;
            return {
                ...d,
                TFSA: d.reinvestedTFSA / factor,
                RRSP: d.reinvestedRRSP / factor,
                NonReg: d.reinvestedNonReg / factor,
            };
        });
    }, [data, inflationAdjusted]);

    return (
        <div className="h-[350px] lg:h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-lg font-bold text-slate-900">Surplus Reinvestment</h3>
            <ResponsiveContainer width="100%" height="90%">
                <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
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
                        domain={domainMax ? [0, domainMax] : ['auto', 'auto']}
                    />
                    <Tooltip
                        content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;

                            const labelMap: Record<string, string> = {
                                'TFSA': 'TFSA',
                                'RRSP': 'RRSP',
                                'NonReg': 'Non-Reg'
                            };

                            const data = payload[0]?.payload;
                            let total = 0;

                            return (
                                <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-200">
                                    <p className="font-semibold text-slate-900 mb-2">Age {data?.age}</p>
                                    {payload.map((entry: any, index: number) => {
                                        if (Math.abs(entry.value) < 1) return null;
                                        total += entry.value;
                                        return (
                                            <div key={index} className="flex justify-between gap-4 text-sm">
                                                <span className="text-slate-600" style={{ color: entry.color }}>
                                                    {labelMap[entry.dataKey] || entry.name}
                                                </span>
                                                <span className="font-semibold text-slate-900">
                                                    {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(entry.value)}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {total > 0 && (
                                        <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between gap-4 text-sm font-semibold">
                                            <span className="text-slate-900">Total Surplus</span>
                                            <span className="text-slate-900">
                                                {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(total)}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        }}
                        cursor={{ fill: '#f1f5f9' }}
                    />
                    <Legend
                        iconType="circle"
                        wrapperStyle={{ paddingTop: '20px' }}
                        content={(props: any) => {
                            const { payload } = props;
                            if (!payload) return null;

                            return (
                                <ul className="flex flex-wrap justify-center gap-4 mt-4 p-0 list-none">
                                    {payload.map((entry: any, index: number) => (
                                        <li key={`item-${index}`} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                                            <span
                                                className="w-2.5 h-2.5 rounded-full"
                                                style={{ backgroundColor: entry.color }}
                                            />
                                            {entry.value}
                                        </li>
                                    ))}
                                </ul>
                            );
                        }}
                    />

                    <Bar dataKey="TFSA" name="To TFSA" stackId="a" fill="#10b981" />
                    <Bar dataKey="RRSP" name="To RRSP" stackId="a" fill="#0ea5e9" />
                    <Bar dataKey="NonReg" name="To Non-Reg" stackId="a" fill="#f59e0b" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
});
