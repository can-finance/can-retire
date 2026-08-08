import React from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { ComparisonChartRow, ComparisonRun, BandMode } from '../../utils/comparison';
import { MAX_COMPARANDS } from '../../utils/comparison';
import { formatCurrencyShort, formatCurrencyCAD } from '../../utils/formatters';
import { ChartLegend } from './ChartLegend';
import type { LegendEntry } from './ChartLegend';

interface ComparisonChartProps {
    data: ComparisonChartRow[];
    runs: ComparisonRun[];      // names + colors, slot order matches data keys
    bandMode: BandMode;
    inflationAdjusted: boolean;
}

// Row keys are slot-suffixed (det0/age1/band2/...); a narrow index cast lets the
// tooltip read them without loosening the exported ComparisonChartRow interface.
type IndexedRow = Record<string, number | [number, number] | undefined>;

export const ComparisonChart = React.memo(function ComparisonChart({ data, runs, bandMode, inflationAdjusted }: ComparisonChartProps) {
    const slots = runs.slice(0, MAX_COMPARANDS);

    return (
        <div className="h-[350px] lg:h-[450px] w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-xl font-bold text-slate-900">
                Net Worth Comparison
                <span className="ml-2 text-sm font-normal text-slate-500">{inflationAdjusted ? '(real $)' : '(nominal $)'}</span>
            </h3>
            <ResponsiveContainer width="100%" height="90%">
                <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                        dataKey="year"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        allowDecimals={false}
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
                    />
                    <Tooltip
                        content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const r = payload[0].payload as IndexedRow;
                            const rows = slots
                                .map((run, i) => ({ run, i }))
                                .filter(({ i }) => r[`det${i}`] !== undefined);
                            if (!rows.length) return null;
                            return (
                                <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-200 text-xs">
                                    <p className="font-semibold text-slate-900 mb-2">Year {r.year}</p>
                                    {rows.map(({ run, i }) => {
                                        const det = r[`det${i}`] as number;
                                        const age = r[`age${i}`] as number | undefined;
                                        const band = r[`band${i}`] as [number, number] | undefined;
                                        return (
                                            <div key={run.comparand.id} className="mb-1.5 last:mb-0">
                                                <div className="flex justify-between gap-4">
                                                    <span className="flex items-center gap-1.5">
                                                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: run.color }} />
                                                        <span className="text-slate-700">{run.comparand.name}</span>
                                                    </span>
                                                    <span className="font-semibold text-slate-900">
                                                        {formatCurrencyCAD(det)}
                                                        {age !== undefined && <span className="font-normal text-slate-500"> (age {age})</span>}
                                                    </span>
                                                </div>
                                                {bandMode !== 'off' && band && (
                                                    <div className="pl-4 text-slate-500">range {formatCurrencyCAD(band[0])} – {formatCurrencyCAD(band[1])}</div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        }}
                    />
                    {/* Legend built from slots directly — recharts' own payload leaks the
                        band series (legendType="none" is ignored by custom content) and
                        re-orders entries alphabetically. */}
                    <Legend
                        content={() => (
                            <ChartLegend
                                payload={slots.map((run): LegendEntry => ({ value: run.comparand.name, color: run.color }))}
                            />
                        )}
                    />

                    {/* Bands first so they render behind the deterministic lines. */}
                    {slots.map((run, i) => (
                        <Area
                            key={`band${i}`}
                            dataKey={`band${i}`}
                            stroke="none"
                            fill={run.color}
                            fillOpacity={0.12}
                            isAnimationActive={false}
                            activeDot={false}
                            legendType="none"
                            connectNulls={false}
                        />
                    ))}
                    {slots.map((run, i) => (
                        <Line
                            key={`det${i}`}
                            dataKey={`det${i}`}
                            name={run.comparand.name}
                            stroke={run.color}
                            strokeWidth={2.5}
                            dot={false}
                            connectNulls={false}
                        />
                    ))}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
});
