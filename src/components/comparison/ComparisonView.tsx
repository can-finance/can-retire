import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SavedPlan } from '../../hooks/usePlans';
import type { SimulationInputs, MonteCarloResult } from '../../engine/types';
import type { Comparand, ComparisonRun, BandMode } from '../../utils/comparison';
import { MAX_COMPARANDS, buildComparisonChartData } from '../../utils/comparison';
import { PLAN_COLORS } from '../../constants/chartColors';
import { runSimulation, runMonteCarlo } from '../../engine/projection';
import { computeSummaryMetrics } from '../../utils/summaryMetrics';
import { sanitizeSimulationInputs } from '../../utils/inputSanitizer';
import { Toggle } from '../ui/Toggle';
import { ComparisonChart } from '../charts/ComparisonChart';
import { ComparisonSummaryCards } from './ComparisonSummaryCards';
import { ComparisonMetricsTable } from './ComparisonMetricsTable';

interface ComparisonViewProps {
    plans: SavedPlan[];
    activePlanId: string | null;
    liveInputs: SimulationInputs;   // authoritative inputs for the ACTIVE plan
    isInflationAdjusted: boolean;
    onToggleInflation: (v: boolean) => void;
    onExit: () => void;
}

const BAND_OPTIONS: { mode: BandMode; label: string }[] = [
    { mode: 'off', label: 'No bands' },
    { mode: 'p25p75', label: 'Likely (25–75%)' },
    { mode: 'p5p95', label: 'Full (5–95%)' },
];

// Default selection: the active plan plus the most recently edited OTHER
// plan. When activePlanId is null/unknown, falls back to the two most
// recently edited plans. Never more than 2; at least 1 when plans is non-empty.
function defaultSelection(plans: SavedPlan[], activePlanId: string | null): string[] {
    if (plans.length === 0) return [];
    const byRecency = [...plans].sort(
        (a, b) => new Date(b.lastSaved).getTime() - new Date(a.lastSaved).getTime(),
    );
    const active = activePlanId ? plans.find(p => p.id === activePlanId) : undefined;
    if (active) {
        const other = byRecency.find(p => p.id !== active.id);
        return other ? [active.id, other.id] : [active.id];
    }
    return byRecency.slice(0, 2).map(p => p.id);
}

export function ComparisonView({
    plans,
    activePlanId,
    liveInputs,
    isInflationAdjusted,
    onToggleInflation,
    onExit,
}: ComparisonViewProps) {
    const [selectedIds, setSelectedIds] = useState<string[]>(() => defaultSelection(plans, activePlanId));

    const [bandMode, setBandMode] = useState<BandMode>('p25p75');

    // Chip selection rules: min 1 (clicking the last selected is a no-op) and
    // max MAX_COMPARANDS (further chips are disabled in the UI, guarded here too).
    const toggleId = useCallback((id: string) => {
        setSelectedIds(prev => {
            if (prev.includes(id)) {
                if (prev.length === 1) return prev;
                return prev.filter(x => x !== id);
            }
            if (prev.length >= MAX_COMPARANDS) return prev;
            return [...prev, id];
        });
    }, []);

    // Cache key for a comparand's Monte Carlo run. lastSaved is frozen while
    // comparing (compare mode replaces the editor, so plans can't be edited here).
    const keyFor = useCallback(
        (id: string): string => {
            const p = plans.find(pl => pl.id === id);
            return `${id}:${p?.lastSaved ?? 'live'}`;
        },
        [plans],
    );

    const comparands = useMemo<Comparand[]>(() => {
        const out: Comparand[] = [];
        for (const id of selectedIds) {
            const p = plans.find(pl => pl.id === id);
            if (!p) continue;
            if (p.id === activePlanId) {
                out.push({ id, name: p.name, inputs: liveInputs });
                continue;
            }
            const clean = sanitizeSimulationInputs(p.inputs);
            if (!clean) {
                console.warn(`Comparison: skipping plan "${p.name}" — inputs failed sanitization`);
                continue;
            }
            out.push({ id, name: p.name, inputs: clean });
        }
        return out;
    }, [selectedIds, plans, activePlanId, liveInputs]);

    // Tier 1: deterministic runs depend ONLY on the comparands — toggling
    // inflation or bands must never re-run the engine.
    const detRuns = useMemo(
        () => comparands.map(c => ({ comparand: c, results: runSimulation(c.inputs) })),
        [comparands],
    );

    // Monte Carlo cache survives re-renders; only completed results are retained.
    const cache = useRef(new Map<string, MonteCarloResult>());
    const [mcResults, setMcResults] = useState<Record<string, MonteCarloResult>>({});

    useEffect(() => {
        let cancelled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];

        const entries = comparands.map(c => ({ c, key: keyFor(c.id) }));
        const snapshot = (): Record<string, MonteCarloResult> => {
            const out: Record<string, MonteCarloResult> = {};
            for (const { key } of entries) {
                const cached = cache.current.get(key);
                if (cached) out[key] = cached;
            }
            return out;
        };

        const pending = entries.filter(({ key }) => !cache.current.has(key));

        // Everything already computed — just mirror the cache and stop.
        if (pending.length === 0) {
            setMcResults(snapshot());
            return;
        }

        // Show whatever is already cached immediately (placeholders fill in as
        // the remaining runs complete).
        setMcResults(snapshot());

        // Run one Monte Carlo per macrotask so the main thread stays responsive.
        let idx = 0;
        const runNext = () => {
            if (cancelled || idx >= pending.length) return;
            const { c, key } = pending[idx++];
            cache.current.set(key, runMonteCarlo(c.inputs, 200));
            if (cancelled) return;
            setMcResults(snapshot());
            timers.push(setTimeout(runNext, 0));
        };
        timers.push(setTimeout(runNext, 50));

        return () => {
            cancelled = true;
            for (const t of timers) clearTimeout(t);
        };
        // keyFor is stable per `plans`, which also drives `comparands`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [comparands]);

    // Tier 2: attach metrics/color/Monte Carlo without re-running the engine.
    const runs = useMemo<ComparisonRun[]>(
        () =>
            detRuns.map((dr, i) => ({
                comparand: dr.comparand,
                color: PLAN_COLORS[i],
                results: dr.results,
                metrics: computeSummaryMetrics(dr.results, dr.comparand.inputs, isInflationAdjusted),
                monteCarlo: mcResults[keyFor(dr.comparand.id)] ?? null,
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [detRuns, isInflationAdjusted, mcResults],
    );

    const chartData = useMemo(
        () => buildComparisonChartData(runs, bandMode, isInflationAdjusted),
        [runs, bandMode, isInflationAdjusted],
    );

    const secondaryBtn =
        'text-sm bg-slate-50 text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200 font-medium whitespace-nowrap';

    return (
        <div className="flex flex-col gap-6">
            {/* Header: title + band control + inflation toggle + exit */}
            <div className="flex flex-wrap items-center gap-4">
                <h2 className="text-2xl font-bold text-slate-900 mr-auto">Compare Plans</h2>

                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    {BAND_OPTIONS.map(opt => (
                        <button
                            key={opt.mode}
                            onClick={() => setBandMode(opt.mode)}
                            aria-pressed={bandMode === opt.mode}
                            className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                                bandMode === opt.mode
                                    ? 'bg-brand-600 text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>

                <div className="w-full sm:w-auto sm:min-w-[16rem]">
                    <Toggle
                        checked={isInflationAdjusted}
                        onChange={onToggleInflation}
                        label="Show Today's Dollars (Inflation-Adjusted)"
                    />
                </div>

                <button onClick={onExit} className={secondaryBtn}>
                    Back to Dashboard
                </button>
            </div>

            {/* Chip picker */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500 mr-1">
                    {selectedIds.length >= MAX_COMPARANDS
                        ? `Maximum of ${MAX_COMPARANDS} plans selected — deselect one to swap`
                        : `Choose up to ${MAX_COMPARANDS} plans:`}
                </span>
                {plans.map(p => {
                    const selected = selectedIds.includes(p.id);
                    const slot = selectedIds.indexOf(p.id);
                    const color = selected ? PLAN_COLORS[slot] : undefined;
                    const disabled = !selected && selectedIds.length >= MAX_COMPARANDS;
                    return (
                        <button
                            key={p.id}
                            onClick={() => toggleId(p.id)}
                            aria-pressed={selected}
                            disabled={disabled}
                            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-all ${
                                selected
                                    ? 'bg-white shadow-sm'
                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            style={selected && color ? { borderColor: color, color } : undefined}
                        >
                            <span
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: color ?? '#cbd5e1' }}
                            />
                            <span>{p.name}</span>
                            {p.id === activePlanId && (
                                <span className="text-slate-500 font-normal">(active)</span>
                            )}
                            <span className="text-xs font-normal text-slate-500">
                                {new Date(p.lastSaved).toLocaleDateString()}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Body: insufficient-plans state or chart + table */}
            {plans.length < 2 ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 flex flex-col items-center gap-4 text-center">
                    <p className="text-sm text-slate-500 max-w-md">
                        Create at least two plans to compare.
                    </p>
                    <button onClick={onExit} className={secondaryBtn}>
                        Back to Dashboard
                    </button>
                </div>
            ) : (
                <>
                    <ComparisonChart
                        data={chartData}
                        runs={runs}
                        bandMode={bandMode}
                        inflationAdjusted={isInflationAdjusted}
                    />
                    <ComparisonSummaryCards runs={runs} />
                    <ComparisonMetricsTable runs={runs} inflationAdjusted={isInflationAdjusted} />
                </>
            )}
        </div>
    );
}
