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
        <div className="h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-lg font-bold text-slate-900">Surplus Reinvestment</h3>
            <ResponsiveContainer width="100%" height="100%">
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
                        formatter={((val: number) => {
                            if (Math.abs(val) < 1) return [undefined, undefined];
                            return [
                                new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(val),
                                undefined
                            ];
                        }) as any}
                        cursor={{ fill: '#f1f5f9' }}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />

                    <Bar dataKey="TFSA" name="To TFSA" stackId="a" fill="#10b981" />
                    <Bar dataKey="RRSP" name="To RRSP" stackId="a" fill="#0ea5e9" />
                    <Bar dataKey="NonReg" name="To Non-Reg" stackId="a" fill="#f59e0b" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
});
