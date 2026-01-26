import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SimulationResult } from '../../engine/types';

interface WealthChartProps {
    data: SimulationResult[];
    hasSpouse: boolean;
    inflationAdjusted: boolean;
}

export const WealthChart = React.memo(function WealthChart({ data, hasSpouse, inflationAdjusted }: WealthChartProps) {
    const formatCurrency = (val: number) => {
        if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `$${(val / 1000).toFixed(0)}k`;
        return `$${val}`;
    };

    const chartData = useMemo(() => {
        return data.map(d => {
            const factor = inflationAdjusted ? d.inflationFactor : 1.0;
            return {
                ...d,
                pRRSP: d.accounts.rrsp / factor,
                pTFSA: d.accounts.tfsa / factor,
                pNonReg: d.accounts.nonRegistered / factor,
                sRRSP: hasSpouse ? (d.spouseAccounts?.rrsp || 0) / factor : 0,
                sTFSA: hasSpouse ? (d.spouseAccounts?.tfsa || 0) / factor : 0,
                sNonReg: hasSpouse ? (d.spouseAccounts?.nonRegistered || 0) / factor : 0,
            };
        });
    }, [data, hasSpouse, inflationAdjusted]);

    // Deterministic View
    return (
        <div className="h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-lg font-bold text-slate-900">Projected Net Worth</h3>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={chartData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                    <defs>
                        <linearGradient id="colorRrsp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorSpRrsp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#7dd3fc" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#7dd3fc" stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorTfsa" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorSpTfsa" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6ee7b7" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#6ee7b7" stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorNonReg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorSpNonReg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.1} />
                        </linearGradient>
                    </defs>
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
                        formatter={((val: number) => {
                            if (val === undefined || val === null || Math.abs(val) < 1) return [undefined, undefined]; // Hide 0 values
                            return [
                                new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(val),
                                undefined
                            ];
                        }) as any}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend
                        iconType="circle"
                        content={(props: any) => {
                            const { payload } = props;
                            if (!payload) return null;

                            // Explicitly define the desired order (Visual Top to Bottom)
                            const desiredOrder = [
                                "Spouse Non-Reg",
                                "Non-Reg",
                                "Spouse TFSA",
                                "TFSA",
                                "Spouse RRSP/RRIF",
                                "RRSP/RRIF"
                            ];

                            // Sort payload based on the desired order
                            const sortedPayload = [...payload].sort((a: any, b: any) => {
                                const indexA = desiredOrder.indexOf(a.value);
                                const indexB = desiredOrder.indexOf(b.value);
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

                    {/* RRSP Group */}
                    <Area type="monotone" dataKey="pRRSP" name="RRSP/RRIF" stackId="1" stroke="#0ea5e9" fill="url(#colorRrsp)" strokeWidth={2} />
                    {hasSpouse && <Area type="monotone" dataKey="sRRSP" name="Spouse RRSP/RRIF" stackId="1" stroke="#7dd3fc" fill="url(#colorSpRrsp)" strokeWidth={2} />}
                    {/* TFSA Group */}
                    <Area type="monotone" dataKey="pTFSA" name="TFSA" stackId="1" stroke="#10b981" fill="url(#colorTfsa)" strokeWidth={2} />
                    {hasSpouse && <Area type="monotone" dataKey="sTFSA" name="Spouse TFSA" stackId="1" stroke="#6ee7b7" fill="url(#colorSpTfsa)" strokeWidth={2} />}
                    {/* Non-Reg Group */}
                    <Area type="monotone" dataKey="pNonReg" name="Non-Reg" stackId="1" stroke="#f59e0b" fill="url(#colorNonReg)" strokeWidth={2} />
                    {hasSpouse && <Area type="monotone" dataKey="sNonReg" name="Spouse Non-Reg" stackId="1" stroke="#fbbf24" fill="url(#colorSpNonReg)" strokeWidth={2} />}
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
});
