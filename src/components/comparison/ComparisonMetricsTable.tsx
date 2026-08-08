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

    // Downside (5th percentile) end-of-plan assets — the last percentile row, deflated
    // the same way as the median above.
    const downsideEndAssets = (run: ComparisonRun): number | null => {
        if (!run.monteCarlo) return null;
        const factor = inflationAdjusted
            ? run.results[run.results.length - 1]?.inflationFactor ?? 1.0
            : 1.0;
        const last = run.monteCarlo.percentiles[run.monteCarlo.percentiles.length - 1];
        return last === undefined ? null : last.p5 / factor;
    };

    // Annual retirement spending is read off the first retirement result row rather
    // than `inputs.postRetirementSpend`: the row is already denominated correctly for
    // whichever dollar basis is selected, and it picks up any one-time expense that
    // lands in that year.
    const retirementSpending = (run: ComparisonRun): number | null => {
        const row = run.results.find(r => r.age >= run.comparand.inputs.person.retirementAge);
        if (!row) return null;
        return inflationAdjusted ? row.spending / row.inflationFactor : row.spending;
    };

    // Rates are stored as fractions (0.025 = 2.5%) — projection.ts consumes them raw
    // as `(1 + inflationRate)` and `balance * bondReturn` — so scale for display.
    const ratePct = (v: number | undefined): number | null => (v === undefined ? null : v * 100);

    // "65 / 63" for couples, plain "65" for a single person.
    const pairText = (p: number, s: number | undefined): string => (s === undefined ? `${p}` : `${p} / ${s}`);

    const outOfMoneyCell = (run: ComparisonRun): ReactNode => {
        const age = run.metrics.outOfMoneyAge;
        if (age === null) return <span className="text-emerald-700 font-semibold">Never</span>;
        const year = run.results.find(r => r.age === age)?.year;
        return `Age ${age}${year !== undefined ? ` (${year})` : ''}`;
    };

    // A row is either a data row (label + one cell per run) or a group header.
    type MetricRow =
        | { kind: 'group'; label: string; note?: string }
        | {
              kind: 'data';
              label: string;
              cell: (run: ComparisonRun, i: number) => ReactNode;
              highlight?: number | null;
              delta?: Delta;
          };

    // The "Plan inputs" group is a "what differs" summary, so a row whose value is
    // identical across every selected plan carries no signal and is dropped (unless
    // flagged `always`). Equality is tested on `key` — a rendered string — so rows
    // mixing numbers, text and undefined all compare on the same stable basis.
    type InputRowSpec = {
        label: string;
        always?: boolean;
        key: (run: ComparisonRun) => string;
        cell: (run: ComparisonRun) => ReactNode;
        delta?: Delta;
    };

    const planInputRows = (specs: InputRowSpec[]): MetricRow[] =>
        specs
            .filter(s => s.always || !runs.every(r => s.key(r) === s.key(runs[0])))
            .map(({ label, cell, delta }) => ({ kind: 'data' as const, label, cell, delta }));

    // A plain text input row: the rendered text is also the comparison key, and there
    // is no meaningful delta (omitting `delta` renders an em dash in that column).
    const textInputRow = (label: string, text: (run: ComparisonRun) => string, always = false): InputRowSpec => ({
        label,
        always,
        key: text,
        cell: text,
    });

    // A pct input row: same scaled value drives the cell, the comparison key and the delta.
    const pctInputRow = (label: string, value: (run: ComparisonRun) => number | undefined): InputRowSpec => {
        const pct = (run: ComparisonRun) => ratePct(value(run));
        return {
            label,
            key: run => {
                const v = pct(run);
                return v === null ? '—' : fmtPct1(v);
            },
            cell: run => {
                const v = pct(run);
                return v === null ? DASH : fmtPct1(v);
            },
            delta: { kind: 'pct', dir: 'neutral', decimals: 1, value: pct },
        };
    };

    const rows: MetricRow[] = [
        { kind: 'group', label: 'Plan inputs', note: '(what differs between these plans)' },
        ...planInputRows([
            {
                label: 'Annual retirement spending (first full retirement year)',
                always: true,
                key: run => String(retirementSpending(run)),
                cell: run => {
                    const v = retirementSpending(run);
                    return v === null ? DASH : formatCurrencyCAD(v);
                },
                delta: { kind: 'currency', dir: 'neutral', value: retirementSpending },
            },
            textInputRow(
                'Retirement age',
                run => pairText(run.comparand.inputs.person.retirementAge, run.comparand.inputs.spouse?.retirementAge),
                true,
            ),
            textInputRow('Life expectancy', run =>
                pairText(run.comparand.inputs.person.lifeExpectancy, run.comparand.inputs.spouse?.lifeExpectancy),
            ),
            textInputRow('Province', run => run.comparand.inputs.province),
            textInputRow('Withdrawal strategy', run =>
                (run.comparand.inputs.withdrawalStrategy ?? 'tax-efficient') === 'rrsp-first'
                    ? 'RRSP first'
                    : 'RRSP last',
            ),
            textInputRow('Income splitting', run => (run.comparand.inputs.useIncomeSplitting ? 'On' : 'Off')),
            pctInputRow('Inflation', run => run.comparand.inputs.inflationRate),
            pctInputRow('Equity growth', run => run.comparand.inputs.returnRates.capitalGrowth),
            pctInputRow('Bond return', run => run.comparand.inputs.returnRates.bondReturn),
            pctInputRow('Volatility', run => run.comparand.inputs.returnRates.volatility),
        ]),
        { kind: 'group', label: 'Outcomes' },
        {
            kind: 'data',
            label: 'Money runs out (baseline scenario, not Monte Carlo)',
            cell: run => outOfMoneyCell(run),
            // Later depletion is better; "Never" (null age) has no numeric delta → "—".
            delta: { kind: 'age', dir: 'higher', value: r => r.metrics.outOfMoneyAge },
        },
        {
            // Lifetime spending actually funded (desired minus shortfall), from the
            // deterministic run — the quantity the max-spend objective maximizes.
            kind: 'data',
            label: 'Total spending (funded)',
            cell: run => formatCurrencyCAD(run.metrics.totalSpending),
            delta: { kind: 'currency', dir: 'higher', value: r => r.metrics.totalSpending },
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
            label: 'RRSP/RRIF balance at 71',
            cell: run => {
                const v = run.metrics.rrspBalanceAt71;
                return v === null ? DASH : formatCurrencyCAD(v);
            },
            delta: { kind: 'currency', dir: 'neutral', value: r => r.metrics.rrspBalanceAt71 },
        },
        { kind: 'group', label: 'Monte Carlo', note: '(range of outcomes under random market returns)' },
        {
            kind: 'data',
            label: 'Success rate',
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
            label: 'Median end-of-plan assets',
            cell: run => {
                const v = medianEndAssets(run);
                return v === null ? <span className="text-slate-300">…</span> : formatCurrencyCAD(v);
            },
            delta: { kind: 'currency', dir: 'higher', value: r => medianEndAssets(r) },
        },
        {
            kind: 'data',
            label: 'Downside end-of-plan assets (5th percentile)',
            cell: run => {
                const v = downsideEndAssets(run);
                return v === null ? <span className="text-slate-300">…</span> : formatCurrencyCAD(v);
            },
            delta: { kind: 'currency', dir: 'higher', value: r => downsideEndAssets(r) },
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
            label: 'OAS clawed back (lifetime)',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeOASClawback),
            delta: { kind: 'currency', dir: 'lower', value: r => r.metrics.lifetimeOASClawback },
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
            label: 'DB pension',
            cell: run => formatCurrencyCAD(run.metrics.lifetimeNetPension),
            delta: { kind: 'currency', dir: 'neutral', value: r => r.metrics.lifetimeNetPension },
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
                <span className="ml-2 text-sm font-normal text-slate-500">
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
                                <th className="text-right font-normal text-slate-500 py-2 pl-4 align-bottom whitespace-nowrap text-xs">
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
                                        {row.note && (
                                            <span className="ml-2 normal-case font-normal tracking-normal text-slate-500">
                                                {row.note}
                                            </span>
                                        )}
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
