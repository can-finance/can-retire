import React, { useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SimulationResult } from '../../engine/types';
import { CHART_COLORS } from '../../constants/chartColors';
import { formatCurrencyShort, formatCurrencyCAD } from '../../utils/formatters';
import { ChartLegend } from './ChartLegend';

interface SpendingChartProps {
    data: SimulationResult[];
    inflationAdjusted: boolean;
    domainMax?: number;
}

const LABEL_MAP: Record<string, string> = {
    Salary: 'Employment Income',
    CPP: 'CPP',
    OAS: 'OAS',
    Yield: 'Investment Income',
    RRSP: 'RRSP/RRIF',
    TFSA: 'TFSA',
    NonReg: 'Non-Reg',
    Taxes: 'Income Tax',
    TargetSpend: 'Target Spending',
};

const LEGEND_ORDER = [
    'Target Spend',
    'Non-Reg',
    'TFSA',
    'RRSP',
    'Yield',
    'OAS',
    'CPP',
    'Salary',
    'Taxes Paid',
];

export const SpendingChart = React.memo(function SpendingChart({ data, inflationAdjusted, domainMax }: SpendingChartProps) {
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
                Taxes: -d.taxPaid / factor,
                TargetSpend: d.spending / factor,
            };
        });
    }, [data, inflationAdjusted]);

    return (
        <div className="h-[350px] lg:h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-xl font-bold text-slate-900">Annual Cash Flow (Net)</h3>
            <ResponsiveContainer width="100%" height="90%">
                <ComposedChart
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
                        tickFormatter={formatCurrencyShort}
                        stroke="#64748b"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        domain={domainMax ? [0, domainMax] : ['auto', 'auto']}
                    />
                    <Tooltip
                        content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const d = payload[0]?.payload;
                            return (
                                <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-200">
                                    <p className="font-semibold text-slate-900 mb-2">Age {d?.age}</p>
                                    {payload.map((e: any, i: number) => {
                                        if (Math.abs(e.value) < 1) return null;
                                        return (
                                            <div key={i} className="flex justify-between gap-4 text-sm">
                                                <span style={{ color: e.color }}>{LABEL_MAP[e.dataKey] || e.name}</span>
                                                <span className="font-semibold text-slate-900">{formatCurrencyCAD(Math.abs(e.value))}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        }}
                        cursor={{ fill: '#f1f5f9' }}
                    />
                    <Legend
                        iconType="circle"
                        wrapperStyle={{ paddingTop: '20px' }}
                        content={(props: any) => <ChartLegend payload={props.payload} desiredOrder={LEGEND_ORDER} dotSize="sm" />}
                    />

                    <Line type="monotone" dataKey="TargetSpend" stroke="#0f172a" strokeWidth={2} dot={false} name="Target Spend" />

                    <Bar dataKey="Salary" name="Salary" stackId="a" fill="#94a3b8" />
                    <Bar dataKey="CPP" name="CPP" stackId="a" fill="#8b5cf6" />
                    <Bar dataKey="OAS" name="OAS" stackId="a" fill="#c4b5fd" />
                    <Bar dataKey="Yield" name="Yield" stackId="a" fill="#a78bfa" />
                    <Bar dataKey="RRSP" name="RRSP" stackId="a" fill={CHART_COLORS.rrsp} />
                    <Bar dataKey="TFSA" name="TFSA" stackId="a" fill={CHART_COLORS.tfsa} />
                    <Bar dataKey="NonReg" name="Non-Reg" stackId="a" fill={CHART_COLORS.nonReg} />
                    <Bar dataKey="Taxes" name="Taxes Paid" stackId="a" fill="#ef4444" />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
});
