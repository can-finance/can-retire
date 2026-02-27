import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SimulationResult } from '../../engine/types';
import { CHART_COLORS } from '../../constants/chartColors';
import { formatCurrencyShort, formatCurrencyCAD } from '../../utils/formatters';
import { ChartLegend } from './ChartLegend';

interface SurplusChartProps {
    data: SimulationResult[];
    inflationAdjusted: boolean;
    domainMax?: number;
}

const LABEL_MAP: Record<string, string> = {
    TFSA:   'TFSA',
    RRSP:   'RRSP',
    NonReg: 'Non-Reg',
};

export const SurplusChart = React.memo(function SurplusChart({ data, inflationAdjusted, domainMax }: SurplusChartProps) {
    const chartData = useMemo(() => {
        return data.map(d => {
            const factor = inflationAdjusted ? d.inflationFactor : 1.0;
            return {
                ...d,
                TFSA:   d.reinvestedTFSA / factor,
                RRSP:   d.reinvestedRRSP / factor,
                NonReg: d.reinvestedNonReg / factor,
            };
        });
    }, [data, inflationAdjusted]);

    return (
        <div className="h-[350px] lg:h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-xl font-bold text-slate-900">Surplus Reinvestment</h3>
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
                            let total = 0;
                            return (
                                <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-200">
                                    <p className="font-semibold text-slate-900 mb-2">Age {d?.age}</p>
                                    {payload.map((e: any, i: number) => {
                                        if (Math.abs(e.value) < 1) return null;
                                        total += e.value;
                                        return (
                                            <div key={i} className="flex justify-between gap-4 text-sm">
                                                <span style={{ color: e.color }}>{LABEL_MAP[e.dataKey] || e.name}</span>
                                                <span className="font-semibold text-slate-900">{formatCurrencyCAD(e.value)}</span>
                                            </div>
                                        );
                                    })}
                                    {total > 0 && (
                                        <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between gap-4 text-sm font-semibold">
                                            <span className="text-slate-900">Total Surplus</span>
                                            <span className="text-slate-900">{formatCurrencyCAD(total)}</span>
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
                        content={(props: any) => <ChartLegend payload={props.payload} dotSize="sm" />}
                    />

                    <Bar dataKey="TFSA"   name="To TFSA"    stackId="a" fill={CHART_COLORS.tfsa} />
                    <Bar dataKey="RRSP"   name="To RRSP"    stackId="a" fill={CHART_COLORS.rrsp} />
                    <Bar dataKey="NonReg" name="To Non-Reg" stackId="a" fill={CHART_COLORS.nonReg} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
});
