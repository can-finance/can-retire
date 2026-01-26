import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Line } from 'recharts';
import type { SimulationResult } from '../../engine/types';

interface SpendingChartProps {
    data: SimulationResult[];
    hasSpouse: boolean;
    inflationAdjusted: boolean;
    domainMax?: number;
}

export const SpendingChart = React.memo(function SpendingChart({ data, inflationAdjusted, domainMax }: SpendingChartProps) {
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
                Salary: d.netEmploymentIncome / factor,
                CPP: d.netCPPIncome / factor,
                OAS: d.netOASIncome / factor,
                Yield: d.netInvestmentIncome / factor,
                RRSP: d.netRRSPWithdrawal / factor,
                TFSA: d.netTFSAWithdrawal / factor,
                NonReg: d.netNonRegWithdrawal / factor,
                // Negative for outflow
                Taxes: -d.taxPaid / factor,
                TargetSpend: d.spending / factor
            };
        });
    }, [data, inflationAdjusted]);

    return (
        <div className="h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-lg font-bold text-slate-900">Annual Cash Flow (Net)</h3>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
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
                        domain={domainMax ? [0, domainMax] : ['auto', 'auto']}
                    />
                    <Tooltip
                        formatter={((val: number) => {
                            if (Math.abs(val) < 1) return [undefined, undefined];
                            return [
                                new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(Math.abs(val)),
                                undefined
                            ];
                        }) as any}
                        cursor={{ fill: '#f1f5f9' }}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />

                    <Line type="monotone" dataKey="TargetSpend" stroke="#0f172a" strokeWidth={2} dot={false} name="Target Spend" />

                    <Bar dataKey="Salary" name="Salary" stackId="a" fill="#94a3b8" />
                    <Bar dataKey="CPP" name="CPP" stackId="a" fill="#8b5cf6" />
                    <Bar dataKey="OAS" name="OAS" stackId="a" fill="#c4b5fd" />
                    <Bar dataKey="Yield" name="Yield" stackId="a" fill="#a78bfa" />

                    <Bar dataKey="RRSP" name="RRSP Withdrawal" stackId="a" fill="#0ea5e9" />
                    <Bar dataKey="TFSA" name="TFSA Withdrawal" stackId="a" fill="#10b981" />
                    <Bar dataKey="NonReg" name="Non-Reg Withdrawal" stackId="a" fill="#f59e0b" />

                    <Bar dataKey="Taxes" name="Taxes Paid" stackId="a" fill="#ef4444" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
});
