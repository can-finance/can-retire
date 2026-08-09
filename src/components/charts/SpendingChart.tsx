import React, { useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SimulationResult } from '../../engine/types';
import { CHART_COLORS } from '../../constants/chartColors';
import { formatCurrencyShort } from '../../utils/formatters';
import { ChartLegend } from './ChartLegend';
import type { LegendEntry } from './ChartLegend';
import { ChartTooltip } from './ChartTooltip';
import { evenTicks } from '../../utils/chartTicks';
import type { TooltipRow } from './ChartTooltip';

interface SpendingChartProps {
    data: SimulationResult[];
    inflationAdjusted: boolean;
    domainMax?: number;
    // When provided, bars become clickable and open the Year Audit drawer for that year.
    onSelectYear?: (year: number) => void;
}

const LABEL_MAP: Record<string, string> = {
    Salary: 'Salary',
    CPP: 'CPP',
    OAS: 'OAS',
    Pension: 'Pension',
    Yield: 'Yield',
    RRSP: 'RRSP',
    TFSA: 'TFSA',
    NonReg: 'Non-Reg',
    Taxes: 'Taxes Paid',
    TargetSpend: 'Target Spend',
};

const LEGEND_ORDER = [
    'Target Spend',
    'Non-Reg',
    'Yield',
    'TFSA',
    'RRSP',
    'OAS',
    'Pension',
    'CPP',
    'Salary',
    'Taxes Paid',
];

export const SpendingChart = React.memo(function SpendingChart({ data, inflationAdjusted, domainMax, onSelectYear }: SpendingChartProps) {
    const chartData = useMemo(() => {
        return data.map(d => {
            const factor = inflationAdjusted ? d.inflationFactor : 1.0;
            return {
                ...d,
                Salary: d.netEmploymentIncome / factor,
                CPP: d.netCPPIncome / factor,
                OAS: d.netOASIncome / factor,
                Pension: d.netPensionIncome / factor,
                Yield: d.netInvestmentIncome / factor,
                RRSP: d.netRRSPWithdrawal / factor,
                TFSA: d.netTFSAWithdrawal / factor,
                NonReg: d.netNonRegWithdrawal / factor,
                Taxes: -d.taxPaid / factor,
                TargetSpend: d.spending / factor,
            };
        });
    }, [data, inflationAdjusted]);
    // Uniform, round-numbered age ticks. Recharts' own selection drops whatever
    // does not fit, which leaves visibly uneven gaps along the axis.
    const ageTicks = useMemo(() => evenTicks(data.map(d => d.age)), [data]);

    // Applied to every Bar so hovering any segment of a stacked column reads as
    // clickable when a click handler is actually wired up.
    const barCursor = onSelectYear ? { cursor: 'pointer' } : undefined;

    return (
        <div className="h-[350px] lg:h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="mb-6 flex items-baseline justify-between gap-4">
                <h3 className="text-xl font-bold text-slate-900">Annual Cash Flow (Net)</h3>
                {onSelectYear && (
                    <p className="hidden sm:block text-xs text-slate-500">Click a bar for that year's full breakdown</p>
                )}
            </div>
            <ResponsiveContainer width="100%" height="90%">
                <ComposedChart
                    data={chartData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    stackOffset="sign"
                    onClick={onSelectYear ? (state: { activeIndex?: string | number | null }) => {
                        // Recharts v3's click state carries `activeIndex` (a numeric string
                        // clamped to the data array, e.g. "0") rather than the full payload —
                        // there is no `activePayload` on the click handler in this version.
                        // Index into `chartData` (1:1 with `data`) to read the real calendar
                        // year, rather than using `activeLabel`, which is the age axis tick.
                        if (state?.activeIndex == null) return;
                        const idx = Number(state.activeIndex);
                        const year = Number.isInteger(idx) ? chartData[idx]?.year : undefined;
                        if (typeof year === 'number') onSelectYear(year);
                    } : undefined}
                >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                        dataKey="age"
                        ticks={ageTicks}
                        interval={0}
                        stroke="#64748b"
                        tick={{ fontSize: 14 }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        tickFormatter={formatCurrencyShort}
                        stroke="#64748b"
                        tick={{ fontSize: 14 }}
                        tickLine={false}
                        axisLine={false}
                        domain={domainMax
                            ? [(dataMin: number) => Math.min(0, dataMin), domainMax]
                            : ['auto', 'auto']}
                    />
                    <Tooltip
                        content={({ active, payload }) => (
                            <ChartTooltip
                                active={active}
                                payload={payload as unknown as TooltipRow[]}
                                labelMap={LABEL_MAP}
                                absValues
                            />
                        )}
                        cursor={{ fill: '#f1f5f9' }}
                    />
                    <Legend
                        iconType="circle"
                        wrapperStyle={{ paddingTop: '20px' }}
                        content={(props) => <ChartLegend payload={props.payload as unknown as LegendEntry[]} desiredOrder={LEGEND_ORDER} dotSize="sm" />}
                    />

                    <Line type="monotone" dataKey="TargetSpend" stroke="#0f172a" strokeWidth={2} dot={false} name="Target Spend" />

                    <Bar dataKey="Salary" name="Salary" stackId="a" fill="#94a3b8" style={barCursor} />
                    <Bar dataKey="CPP" name="CPP" stackId="a" fill="#8b5cf6" style={barCursor} />
                    <Bar dataKey="OAS" name="OAS" stackId="a" fill="#c4b5fd" style={barCursor} />
                    <Bar dataKey="Pension" name="Pension" stackId="a" fill={CHART_COLORS.pension} style={barCursor} />
                    <Bar dataKey="RRSP" name="RRSP" stackId="a" fill={CHART_COLORS.rrsp} style={barCursor} />
                    <Bar dataKey="TFSA" name="TFSA" stackId="a" fill={CHART_COLORS.tfsa} style={barCursor} />
                    <Bar dataKey="NonReg" name="Non-Reg" stackId="a" fill={CHART_COLORS.nonReg} style={barCursor} />
                    <Bar dataKey="Yield" name="Yield" stackId="a" fill="#ec4899" style={barCursor} />
                    <Bar dataKey="Taxes" name="Taxes Paid" stackId="a" fill="#ef4444" style={barCursor} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
});
