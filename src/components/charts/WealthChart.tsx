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
            <ResponsiveContainer width="100%" height="90%">
                <AreaChart
                    key={hasSpouse ? 'spouse' : 'single'}
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
                        content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;

                            const labelMap: Record<string, string> = {
                                'pRRSP': 'RRSP/RRIF',
                                'sRRSP': 'Spouse RRSP/RRIF',
                                'pTFSA': 'TFSA',
                                'sTFSA': 'Spouse TFSA',
                                'pNonReg': 'Non-Reg',
                                'sNonReg': 'Spouse Non-Reg'
                            };

                            const data = payload[0]?.payload;
                            let total = 0;

                            return (
                                <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-200">
                                    <p className="font-semibold text-slate-900 mb-2">Age {data?.age}</p>
                                    {payload.filter((entry: any) => Math.abs(entry.value) >= 1).map((entry: any, index: number) => {
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
                                    <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between gap-4 text-sm font-semibold">
                                        <span className="text-slate-900">Total Net Worth</span>
                                        <span className="text-slate-900">
                                            {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(total)}
                                        </span>
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
