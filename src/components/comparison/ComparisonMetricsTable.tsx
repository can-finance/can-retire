import type { ReactNode } from 'react';
import type { ComparisonRun } from '../../utils/comparison';
import { formatCurrencyCAD } from '../../utils/formatters';

interface ComparisonMetricsTableProps {
    runs: ComparisonRun[];
    inflationAdjusted: boolean;
}

// Index of the "best" value in a row, or null when it can't be meaningfully
// highlighted: fewer than two non-null values, or every value tied.
function bestIndex(values: (number | null)[], dir: 'max' | 'min'): number | null {
    const present = values
        .map((v, i) => ({ v, i }))
        .filter((x): x is { v: number; i: number } => x.v !== null);
    if (present.length < 2) return null;
    const allEqual = present.every(x => x.v === present[0].v);
    if (allEqual) return null;
    let best = present[0];
    for (const x of present) {
        if (dir === 'max' ? x.v > best.v : x.v < best.v) best = x;
    }
    return best.i;
}

const HIGHLIGHT = 'font-semibold text-emerald-700';

export function ComparisonMetricsTable({ runs, inflationAdjusted }: ComparisonMetricsTableProps) {
    const fmtPct1 = (v: number) => `${v.toFixed(1)}%`;

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
          };

    const rows: MetricRow[] = [
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
        },
        {
            kind: 'data',
            label: 'Net estate (after terminal tax)',
            cell: run => formatCurrencyCAD(run.metrics.netEstateValue),
            highlight: bestNetEstate,
        },
        {
            kind: 'data',
            label: 'Gross estate',
            cell: run => formatCurrencyCAD(run.metrics.estate),
        },
        {
            kind: 'data',
            label: 'Estate tax',
            cell: run => formatCurrencyCAD(run.metrics.estateTax),
        },
        {
            kind: 'data',
            label: 'Lifetime tax paid',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeTaxPaid),
            highlight: bestLifetimeTax,
        },
        {
            // No best-in-row highlight: neither more nor less realized gain is
            // universally "better" (depends on the estate/tax trade-off).
            kind: 'data',
            label: 'Realized capital gains (net)',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeRealizedGainsNet),
        },
        {
            // Shown GROSS — the tax on these deemed gains is already inside Estate tax.
            kind: 'data',
            label: 'Gains deemed realized at death',
            cell: run => formatCurrencyCAD(run.metrics.deemedGainsAtDeath),
        },
        {
            kind: 'data',
            label: 'Money runs out',
            cell: run => outOfMoneyCell(run),
        },
        {
            kind: 'data',
            label: 'Total unfunded spending',
            cell: run =>
                run.metrics.totalShortfall > 0 ? formatCurrencyCAD(run.metrics.totalShortfall) : '$0',
            highlight: bestShortfall,
        },
        {
            kind: 'data',
            label: 'Initial withdrawal rate',
            cell: run => fmtPct1(run.metrics.initialWithdrawalRate),
        },
        {
            kind: 'data',
            label: 'Retirement effective tax rate',
            cell: run => fmtPct1(run.metrics.effectiveTaxRateRetirement),
        },
        {
            kind: 'data',
            label: 'Total effective tax rate',
            cell: run => fmtPct1(run.metrics.totalEffectiveTaxRate),
        },
        {
            kind: 'data',
            label: 'Median end-of-plan assets (MC)',
            cell: run => {
                const v = medianEndAssets(run);
                return v === null ? <span className="text-slate-300">…</span> : formatCurrencyCAD(v);
            },
        },
        { kind: 'group', label: 'Lifetime income by source (net)' },
        {
            kind: 'data',
            label: 'CPP',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeNetCPP),
        },
        {
            kind: 'data',
            label: 'OAS',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeNetOAS),
        },
        {
            kind: 'data',
            label: 'Investment income',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeNetInvestment),
        },
        {
            kind: 'data',
            label: 'Employment income',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeNetEmployment),
        },
    ];

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
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, ri) =>
                            row.kind === 'group' ? (
                                <tr key={`group-${ri}`}>
                                    <td
                                        colSpan={runs.length + 1}
                                        className="pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
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
                                            className={`text-right py-2 pl-4 tabular-nums whitespace-nowrap ${
                                                row.highlight === i ? HIGHLIGHT : 'text-slate-900'
                                            }`}
                                        >
                                            {row.cell(run, i)}
                                        </td>
                                    ))}
                                </tr>
                            )
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
