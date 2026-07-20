import type { ReactNode } from 'react';
import type { ComparisonRun } from '../../utils/comparison';
import { bestIndex } from '../../utils/comparison';
import { formatCurrencyCAD } from '../../utils/formatters';

interface ComparisonMetricsTableProps {
    runs: ComparisonRun[];
    inflationAdjusted: boolean;
}

// Soft pill wrapping the best-in-row value (replaces the old bold-green text).
const HIGHLIGHT_PILL = 'inline-block rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700';

// Delta direction: which way is "better" for a lower/higher-is-better metric,
// or 'neutral' when no direction is universally better (coloured slate).
type DeltaDir = 'higher' | 'lower' | 'neutral';

// Per-row descriptor for the delta column (only rendered when comparing 2 plans).
// `value` extracts the comparable number for a run (null → delta shown as "—").
type Delta =
    | { kind: 'currency'; dir: DeltaDir; value: (run: ComparisonRun) => number | null }
    | { kind: 'pct'; dir: DeltaDir; decimals: number; value: (run: ComparisonRun) => number | null }
    | { kind: 'age'; dir: DeltaDir; value: (run: ComparisonRun) => number | null };

const DASH = <span className="text-slate-300">—</span>;

// Render plan2 − plan1 for a row, signed and direction-coloured. Any missing
// side (null), or a value that rounds to zero, renders a muted em dash.
function deltaCell(delta: Delta, a: ComparisonRun, b: ComparisonRun): ReactNode {
    const v1 = delta.value(a);
    const v2 = delta.value(b);
    if (v1 === null || v2 === null) return DASH;

    const d = v2 - v1;
    const decimals = delta.kind === 'pct' ? delta.decimals : 0;
    // Zero (or rounds-to-zero at the row's precision) carries no signal.
    if (Math.abs(Number(d.toFixed(decimals))) === 0) return DASH;

    const sign = d > 0 ? '+' : '-';
    const mag = Math.abs(d);
    let text: string;
    if (delta.kind === 'currency') text = `${sign}${formatCurrencyCAD(mag)}`;
    else if (delta.kind === 'pct') text = `${sign}${mag.toFixed(delta.decimals)} pts`;
    else text = `${sign}${Math.round(mag)} yrs`;

    let color: string;
    if (delta.dir === 'neutral') {
        color = 'text-slate-500';
    } else {
        const better = delta.dir === 'higher' ? d > 0 : d < 0;
        color = better ? 'text-emerald-600' : 'text-rose-600';
    }

    return <span className={color}>{text}</span>;
}

export function ComparisonMetricsTable({ runs, inflationAdjusted }: ComparisonMetricsTableProps) {
    const fmtPct1 = (v: number) => `${v.toFixed(1)}%`;
    const showDelta = runs.length === 2;

    // Pre-compute best-in-row indices for the rows that get a highlight.
    const successVals = runs.map(r => (r.monteCarlo ? r.monteCarlo.successRate : null));
    const netEstateVals = runs.map(r => r.metrics.netEstateValue);
    const lifetimeTaxVals = runs.map(r => r.metrics.lifetimeTaxPaid);
    const shortfallVals = runs.map(r => r.metrics.totalShortfall);
    const anyShortfall = shortfallVals.some(v => v > 0);

    const bestSuccess = bestIndex(successVals, 'max');
    const bestNetEstate = bestIndex(netEstateVals, 'max');
    const bestLifetimeTax = bestIndex(lifetimeTaxVals, 'min');
    const bestShortfall = anyShortfall ? bestIndex(shortfallVals, 'min') : null;

    // Median end-of-plan assets: deflate by each run's OWN last deterministic
    // inflation factor (scenarios carry independent inflation assumptions).
    const medianEndAssets = (run: ComparisonRun): number | null => {
        if (!run.monteCarlo) return null;
        const factor = inflationAdjusted
            ? run.results[run.results.length - 1]?.inflationFactor ?? 1.0
            : 1.0;
        return run.monteCarlo.medianEndOfPlanAssets / factor;
    };

    const outOfMoneyCell = (run: ComparisonRun): ReactNode => {
        const age = run.metrics.outOfMoneyAge;
        if (age === null) return <span className="text-emerald-700 font-semibold">Never</span>;
        const year = run.results.find(r => r.age === age)?.year;
        return `Age ${age}${year !== undefined ? ` (${year})` : ''}`;
    };

    // A row is either a data row (label + one cell per run) or a group header.
    type MetricRow =
        | { kind: 'group'; label: string }
        | {
              kind: 'data';
              label: string;
              cell: (run: ComparisonRun, i: number) => ReactNode;
              highlight?: number | null;
              delta?: Delta;
          };

    const rows: MetricRow[] = [
        { kind: 'group', label: 'Outcomes' },
        {
            kind: 'data',
            label: 'Money runs out',
            cell: run => outOfMoneyCell(run),
            // Later depletion is better; "Never" (null age) has no numeric delta → "—".
            delta: { kind: 'age', dir: 'higher', value: r => r.metrics.outOfMoneyAge },
        },
        {
            kind: 'data',
            label: 'Total unfunded spending',
            cell: run =>
                run.metrics.totalShortfall > 0 ? formatCurrencyCAD(run.metrics.totalShortfall) : '$0',
            highlight: bestShortfall,
            delta: { kind: 'currency', dir: 'lower', value: r => r.metrics.totalShortfall },
        },
        {
            kind: 'data',
            label: 'Initial withdrawal rate',
            cell: run => fmtPct1(run.metrics.initialWithdrawalRate),
            delta: { kind: 'pct', dir: 'neutral', decimals: 1, value: r => r.metrics.initialWithdrawalRate },
        },
        {
            kind: 'data',
            label: 'Monte Carlo success rate',
            cell: run =>
                run.monteCarlo ? (
                    `${run.monteCarlo.successRate.toFixed(0)}%`
                ) : (
                    <span className="text-slate-300">…</span>
                ),
            highlight: bestSuccess,
            // Integer precision (success rate is shown with 0 decimals → "+7 pts").
            delta: { kind: 'pct', dir: 'higher', decimals: 0, value: r => (r.monteCarlo ? r.monteCarlo.successRate : null) },
        },
        {
            kind: 'data',
            label: 'Median end-of-plan assets (Monte Carlo)',
            cell: run => {
                const v = medianEndAssets(run);
                return v === null ? <span className="text-slate-300">…</span> : formatCurrencyCAD(v);
            },
            delta: { kind: 'currency', dir: 'higher', value: r => medianEndAssets(r) },
        },
        { kind: 'group', label: 'Estate' },
        {
            kind: 'data',
            label: 'Net estate (after terminal tax)',
            cell: run => formatCurrencyCAD(run.metrics.netEstateValue),
            highlight: bestNetEstate,
            delta: { kind: 'currency', dir: 'higher', value: r => r.metrics.netEstateValue },
        },
        {
            kind: 'data',
            label: 'Gross estate',
            cell: run => formatCurrencyCAD(run.metrics.estate),
            delta: { kind: 'currency', dir: 'higher', value: r => r.metrics.estate },
        },
        {
            kind: 'data',
            label: 'Estate tax',
            cell: run => formatCurrencyCAD(run.metrics.estateTax),
            delta: { kind: 'currency', dir: 'lower', value: r => r.metrics.estateTax },
        },
        {
            // Shown GROSS — the tax on these deemed gains is already inside Estate tax.
            // No universal direction (depends on the estate/tax trade-off).
            kind: 'data',
            label: 'Gains deemed realized at death',
            cell: run => formatCurrencyCAD(run.metrics.deemedGainsAtDeath),
            delta: { kind: 'currency', dir: 'neutral', value: r => r.metrics.deemedGainsAtDeath },
        },
        { kind: 'group', label: 'Taxes' },
        {
            kind: 'data',
            label: 'Lifetime tax paid',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeTaxPaid),
            highlight: bestLifetimeTax,
            delta: { kind: 'currency', dir: 'lower', value: r => r.metrics.lifetimeTaxPaid },
        },
        {
            kind: 'data',
            label: 'Retirement effective tax rate',
            cell: run => fmtPct1(run.metrics.effectiveTaxRateRetirement),
            delta: { kind: 'pct', dir: 'neutral', decimals: 1, value: r => r.metrics.effectiveTaxRateRetirement },
        },
        {
            kind: 'data',
            label: 'Total effective tax rate (retirement and estate)',
            cell: run => fmtPct1(run.metrics.totalEffectiveTaxRate),
            delta: { kind: 'pct', dir: 'neutral', decimals: 1, value: r => r.metrics.totalEffectiveTaxRate },
        },
        { kind: 'group', label: 'Lifetime income by source (net)' },
        {
            kind: 'data',
            label: 'CPP',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeNetCPP),
            delta: { kind: 'currency', dir: 'neutral', value: r => r.metrics.lifetimeNetCPP },
        },
        {
            kind: 'data',
            label: 'OAS',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeNetOAS),
            delta: { kind: 'currency', dir: 'neutral', value: r => r.metrics.lifetimeNetOAS },
        },
        {
            kind: 'data',
            label: 'Investment income (interest and net dividends)',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeNetInvestment),
            delta: { kind: 'currency', dir: 'neutral', value: r => r.metrics.lifetimeNetInvestment },
        },
        {
            // No best-in-row highlight: neither more nor less realized gain is
            // universally "better" (depends on the estate/tax trade-off).
            kind: 'data',
            label: 'Realized capital gains (net)',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeRealizedGainsNet),
            delta: { kind: 'currency', dir: 'neutral', value: r => r.metrics.lifetimeRealizedGainsNet },
        },
        {
            kind: 'data',
            label: 'Employment income',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeNetEmployment),
            delta: { kind: 'currency', dir: 'neutral', value: r => r.metrics.lifetimeNetEmployment },
        },
    ];

    // Total column count for group-header colSpan: metric label + one per run + optional delta.
    const totalCols = runs.length + 1 + (showDelta ? 1 : 0);

    return (
        <div className="w-full rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-6 text-xl font-bold text-slate-900">
                Plan Comparison
                <span className="ml-2 text-sm font-normal text-slate-400">
                    {inflationAdjusted ? '(real $)' : '(nominal $)'}
                </span>
            </h3>
            <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-slate-200">
                            <th className="text-left font-medium text-slate-500 py-2 pr-4 align-bottom">
                                Metric
                            </th>
                            {runs.map(run => (
                                <th
                                    key={run.comparand.id}
                                    className="text-right font-semibold text-slate-900 py-2 pl-4 align-bottom whitespace-nowrap"
                                >
                                    <span className="flex items-center justify-end gap-1.5">
                                        <span
                                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: run.color }}
                                        />
                                        <span className="truncate max-w-[10rem]">{run.comparand.name}</span>
                                    </span>
                                </th>
                            ))}
                            {showDelta && (
                                <th className="text-right font-normal text-slate-400 py-2 pl-4 align-bottom whitespace-nowrap text-xs">
                                    <span className="truncate max-w-[10rem] inline-block align-bottom">
                                        vs. {runs[0].comparand.name}
                                    </span>
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, ri) =>
                            row.kind === 'group' ? (
                                <tr key={`group-${ri}`}>
                                    <td
                                        colSpan={totalCols}
                                        className="pt-5 pb-1 text-sm font-semibold uppercase tracking-wider text-slate-700"
                                    >
                                        {row.label}
                                    </td>
                                </tr>
                            ) : (
                                <tr key={row.label} className="border-b border-slate-100 last:border-0">
                                    <td className="text-left text-slate-600 py-2 pr-4">{row.label}</td>
                                    {runs.map((run, i) => (
                                        <td
                                            key={run.comparand.id}
                                            className="text-right py-2 pl-4 tabular-nums whitespace-nowrap text-slate-900"
                                        >
                                            {row.highlight === i ? (
                                                <span className={HIGHLIGHT_PILL}>{row.cell(run, i)}</span>
                                            ) : (
                                                row.cell(run, i)
                                            )}
                                        </td>
                                    ))}
                                    {showDelta && (
                                        <td className="text-right py-2 pl-4 tabular-nums whitespace-nowrap">
                                            {row.delta ? deltaCell(row.delta, runs[0], runs[1]) : DASH}
                                        </td>
                                    )}
                                </tr>
                            )
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
