import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SimulationResult } from '../../engine/types';
import { CHART_COLORS } from '../../constants/chartColors';
import { formatCurrencyShort, formatCurrencyCAD } from '../../utils/formatters';
import { ChartLegend } from './ChartLegend';

interface WealthChartProps {
    data: SimulationResult[];
    hasSpouse: boolean;
    inflationAdjusted: boolean;
}

const LABEL_MAP: Record<string, string> = {
    pRRSP:   'RRSP/RRIF',
    sRRSP:   'Spouse RRSP/RRIF',
    pTFSA:   'TFSA',
    sTFSA:   'Spouse TFSA',
    pNonReg: 'Non-Reg',
    sNonReg: 'Spouse Non-Reg',
};

const LEGEND_ORDER = [
    'Spouse Non-Reg',
    'Non-Reg',
    'Spouse TFSA',
    'TFSA',
    'Spouse RRSP/RRIF',
    'RRSP/RRIF',
];

export const WealthChart = React.memo(function WealthChart({ data, hasSpouse, inflationAdjusted }: WealthChartProps) {
    const chartData = useMemo(() => {
        return data.map(d => {
            const factor = inflationAdjusted ? d.inflationFactor : 1.0;
            return {
                ...d,
                pRRSP:   d.accounts.rrsp / factor,
                pTFSA:   d.accounts.tfsa / factor,
                pNonReg: d.accounts.nonRegistered / factor,
                sRRSP:   hasSpouse ? (d.spouseAccounts?.rrsp || 0) / factor : 0,
                sTFSA:   hasSpouse ? (d.spouseAccounts?.tfsa || 0) / factor : 0,
                sNonReg: hasSpouse ? (d.spouseAccounts?.nonRegistered || 0) / factor : 0,
            };
        });
    }, [data, hasSpouse, inflationAdjusted]);

    return (
        <div className="h-[350px] lg:h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-xl font-bold text-slate-900">Projected Net Worth</h3>
            <ResponsiveContainer width="100%" height="90%">
                <AreaChart
                    key={hasSpouse ? 'spouse' : 'single'}
                    data={chartData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                    <defs>
                        <linearGradient id="colorRrsp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={CHART_COLORS.rrsp} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={CHART_COLORS.rrsp} stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorSpRrsp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={CHART_COLORS.spRrsp} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={CHART_COLORS.spRrsp} stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorTfsa" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={CHART_COLORS.tfsa} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={CHART_COLORS.tfsa} stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorSpTfsa" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={CHART_COLORS.spTfsa} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={CHART_COLORS.spTfsa} stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorNonReg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={CHART_COLORS.nonReg} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={CHART_COLORS.nonReg} stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorSpNonReg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={CHART_COLORS.spNonReg} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={CHART_COLORS.spNonReg} stopOpacity={0.1} />
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
                        tickFormatter={formatCurrencyShort}
                        stroke="#64748b"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <Tooltip
                        content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const d = payload[0]?.payload;
                            let total = 0;
                            return (
                                <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-200">
                                    <p className="font-semibold text-slate-900 mb-2">Age {d?.age}</p>
                                    {payload.filter((e: any) => Math.abs(e.value) >= 1).map((e: any, i: number) => {
                                        total += e.value;
                                        return (
                                            <div key={i} className="flex justify-between gap-4 text-sm">
                                                <span style={{ color: e.color }}>{LABEL_MAP[e.dataKey] || e.name}</span>
                                                <span className="font-semibold text-slate-900">{formatCurrencyCAD(e.value)}</span>
                                            </div>
                                        );
                                    })}
                                    <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between gap-4 text-sm font-semibold">
                                        <span className="text-slate-900">Total Net Worth</span>
                                        <span className="text-slate-900">{formatCurrencyCAD(total)}</span>
                                    </div>
                                </div>
                            );
                        }}
                    />
                    <Legend
                        iconType="circle"
                        content={(props: any) => <ChartLegend payload={props.payload} desiredOrder={LEGEND_ORDER} />}
                    />

                    <Area type="monotone" dataKey="pRRSP"   name="RRSP/RRIF"         stackId="1" stroke={CHART_COLORS.rrsp}     fill="url(#colorRrsp)"     strokeWidth={2} />
                    {hasSpouse && <Area type="monotone" dataKey="sRRSP"   name="Spouse RRSP/RRIF" stackId="1" stroke={CHART_COLORS.spRrsp}   fill="url(#colorSpRrsp)"   strokeWidth={2} />}
                    <Area type="monotone" dataKey="pTFSA"   name="TFSA"               stackId="1" stroke={CHART_COLORS.tfsa}     fill="url(#colorTfsa)"     strokeWidth={2} />
                    {hasSpouse && <Area type="monotone" dataKey="sTFSA"   name="Spouse TFSA"      stackId="1" stroke={CHART_COLORS.spTfsa}   fill="url(#colorSpTfsa)"   strokeWidth={2} />}
                    <Area type="monotone" dataKey="pNonReg" name="Non-Reg"            stackId="1" stroke={CHART_COLORS.nonReg}   fill="url(#colorNonReg)"   strokeWidth={2} />
                    {hasSpouse && <Area type="monotone" dataKey="sNonReg" name="Spouse Non-Reg"   stackId="1" stroke={CHART_COLORS.spNonReg} fill="url(#colorSpNonReg)" strokeWidth={2} />}
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
});
