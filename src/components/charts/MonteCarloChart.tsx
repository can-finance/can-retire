import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { SimulationResult, MonteCarloResult } from '../../engine/types';

interface MonteCarloChartProps {
    data: SimulationResult[];
    monteCarlo: MonteCarloResult;
    inflationAdjusted: boolean;
}

export const MonteCarloChart = React.memo(function MonteCarloChart({ data, monteCarlo, inflationAdjusted }: MonteCarloChartProps) {
    const formatCurrency = (val: number) => {
        if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `$${(val / 1000).toFixed(0)}k`;
        return `$${val}`;
    };

    const chartData = useMemo(() => {
        return monteCarlo.percentiles.map(d => {
            const factor = inflationAdjusted ? (data.find(r => r.year === d.year)?.inflationFactor || 1.0) : 1.0;

            return {
                year: d.year,
                age: d.age,
                p5: d.p5 / factor,
                p25: d.p25 / factor,
                p50: d.p50 / factor,
                p75: d.p75 / factor,
                p95: d.p95 / factor
            };
        });
    }, [data, monteCarlo, inflationAdjusted]);

    return (
        <div className="h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-lg font-bold text-slate-900 flex items-center gap-2">
                Projected Net Worth
                <span className="text-xs font-normal text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">Monte Carlo Simulation</span>
            </h3>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
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
                    />
                    <Tooltip
                        content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                                const d = payload[0].payload;
                                return (
                                    <div className="bg-white p-4 border border-slate-100 shadow-xl rounded-xl text-xs space-y-2">
                                        <p className="font-bold text-slate-900 mb-2">Age {d.age}</p>
                                        <div className="space-y-1">
                                            <div className="flex justify-between gap-4"><span className="text-indigo-300 font-medium">95th Percentile:</span> <span>{formatCurrency(d.p95)}</span></div>
                                            <div className="flex justify-between gap-4"><span className="text-indigo-400 font-medium">75th Percentile:</span> <span>{formatCurrency(d.p75)}</span></div>
                                            <div className="flex justify-between gap-4"><span className="text-indigo-600 font-bold border-t border-b border-indigo-100 py-1 my-1">Median (50th):</span> <span className="font-bold py-1 my-1 border-t border-b border-indigo-100">{formatCurrency(d.p50)}</span></div>
                                            <div className="flex justify-between gap-4"><span className="text-indigo-400 font-medium">25th Percentile:</span> <span>{formatCurrency(d.p25)}</span></div>
                                            <div className="flex justify-between gap-4"><span className="text-indigo-300 font-medium">5th Percentile:</span> <span>{formatCurrency(d.p5)}</span></div>
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        }}
                    />

                    {/* Lines for percentiles */}
                    <Area type="monotone" dataKey="p95" stroke="#a5b4fc" strokeDasharray="5 5" fill="none" strokeWidth={2} name="95th" />
                    <Area type="monotone" dataKey="p75" stroke="#818cf8" strokeDasharray="3 3" fill="none" strokeWidth={2} name="75th" />
                    <Area type="monotone" dataKey="p50" stroke="#4f46e5" fill="none" strokeWidth={3} name="Median" />
                    <Area type="monotone" dataKey="p25" stroke="#818cf8" strokeDasharray="3 3" fill="none" strokeWidth={2} name="25th" />
                    <Area type="monotone" dataKey="p5" stroke="#a5b4fc" strokeDasharray="5 5" fill="none" strokeWidth={2} name="5th" />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
});
