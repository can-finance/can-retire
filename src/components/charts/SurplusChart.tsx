import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SimulationResult } from '../../engine/types';
import { CHART_COLORS } from '../../constants/chartColors';
import { formatCurrencyShort } from '../../utils/formatters';
import { ChartLegend } from './ChartLegend';
import type { LegendEntry } from './ChartLegend';
import { ChartTooltip } from './ChartTooltip';
import type { TooltipRow } from './ChartTooltip';

interface SurplusChartProps {
    data: SimulationResult[];
    inflationAdjusted: boolean;
    domainMax?: number;
}

const LABEL_MAP: Record<string, string> = {
    TFSA:   'To TFSA',
    RRSP:   'To RRSP',
    NonReg: 'To Non-Reg',
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
                        content={({ active, payload }) => (
                            <ChartTooltip
                                active={active}
                                payload={payload as unknown as TooltipRow[]}
                                labelMap={LABEL_MAP}
                                showTotal
                                totalLabel="Total Surplus"
                            />
                        )}
                        cursor={{ fill: '#f1f5f9' }}
                    />
                    <Legend
                        iconType="circle"
                        wrapperStyle={{ paddingTop: '20px' }}
                        content={(props) => <ChartLegend payload={props.payload as unknown as LegendEntry[]} dotSize="sm" />}
                    />

                    <Bar dataKey="TFSA"   name="To TFSA"    stackId="a" fill={CHART_COLORS.tfsa} />
                    <Bar dataKey="RRSP"   name="To RRSP"    stackId="a" fill={CHART_COLORS.rrsp} />
                    <Bar dataKey="NonReg" name="To Non-Reg" stackId="a" fill={CHART_COLORS.nonReg} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
});
