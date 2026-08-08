import type { ReactNode } from 'react';
import type { ComparisonRun } from '../../utils/comparison';
import { bestIndex } from '../../utils/comparison';
import { formatCurrencyCAD } from '../../utils/formatters';

interface ComparisonSummaryCardsProps {
    runs: ComparisonRun[];
}

// A single headline stat card: a label, then one value line per selected plan.
// The best plan's value is emphasized; the rest are muted.
function StatCard({
    label,
    note,
    runs,
    best,
    value,
}: {
    label: string;
    note?: string;
    runs: ComparisonRun[];
    best: number | null;
    value: (run: ComparisonRun, isBest: boolean) => ReactNode;
}) {
    return (
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {label}
                {note && (
                    <span className="ml-1 normal-case font-normal tracking-normal text-slate-500">
                        {note}
                    </span>
                )}
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
                {runs.map((run, i) => (
                    <div key={run.comparand.id} className="flex items-center gap-1.5 text-sm">
                        <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: run.color }}
                        />
                        <span className="truncate text-xs text-slate-500 flex-1">
                            {run.comparand.name}
                        </span>
                        <span className="tabular-nums whitespace-nowrap">{value(run, best === i)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ComparisonSummaryCards({ runs }: ComparisonSummaryCardsProps) {
    // Best-plan indices for each headline metric (null when not meaningfully best).
    const successVals = runs.map(r => (r.monteCarlo ? r.monteCarlo.successRate : null));
    const netEstateVals = runs.map(r => r.metrics.netEstateValue);
    // "Never" (null age) outranks any age, and a later age outranks an earlier
    // one — map Never to +Infinity so a plain 'max' comparison expresses both.
    const moneyRunsOutVals = runs.map(r =>
        r.metrics.outOfMoneyAge === null ? Infinity : r.metrics.outOfMoneyAge,
    );

    const bestSuccess = bestIndex(successVals, 'max');
    const bestNetEstate = bestIndex(netEstateVals, 'max');
    const bestMoneyRunsOut = bestIndex(moneyRunsOutVals, 'max');

    const emphasis = (isBest: boolean) => (isBest ? 'font-semibold text-slate-900' : 'text-slate-500');

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
                label="Monte Carlo success"
                runs={runs}
                best={bestSuccess}
                value={(run, isBest) =>
                    run.monteCarlo ? (
                        <span className={emphasis(isBest)}>{run.monteCarlo.successRate.toFixed(0)}%</span>
                    ) : (
                        <span className="text-slate-300">…</span>
                    )
                }
            />
            <StatCard
                label="Net estate"
                runs={runs}
                best={bestNetEstate}
                value={(run, isBest) => (
                    <span className={emphasis(isBest)}>
                        {formatCurrencyCAD(run.metrics.netEstateValue)}
                    </span>
                )}
            />
            <StatCard
                label="Money runs out"
                note="(baseline scenario, not Monte Carlo)"
                runs={runs}
                best={bestMoneyRunsOut}
                value={(run, isBest) =>
                    run.metrics.outOfMoneyAge === null ? (
                        <span className={`text-emerald-600 ${isBest ? 'font-semibold' : ''}`}>Never</span>
                    ) : (
                        <span className={emphasis(isBest)}>Age {run.metrics.outOfMoneyAge}</span>
                    )
                }
            />
        </div>
    );
}
