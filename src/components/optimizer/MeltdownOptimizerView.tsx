import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SimulationInputs } from '../../engine/types';
import type { ComparisonRun, BandMode } from '../../utils/comparison';
import { buildComparisonChartData } from '../../utils/comparison';
import { computeSummaryMetrics } from '../../utils/summaryMetrics';
import { optimizeMeltdown } from '../../utils/meltdownOptimizer';
import type { MeltdownResult, PersonMeltdownDecision } from '../../utils/meltdownOptimizer';
import { PLAN_COLORS } from '../../constants/chartColors';
import { formatCurrencyCAD } from '../../utils/formatters';
import { Toggle } from '../ui/Toggle';
import { ComparisonChart } from '../charts/ComparisonChart';
import { ComparisonSummaryCards } from '../comparison/ComparisonSummaryCards';
import { ComparisonMetricsTable } from '../comparison/ComparisonMetricsTable';

interface MeltdownOptimizerViewProps {
    liveInputs: SimulationInputs;
    hasRealPlan: boolean;
    isInflationAdjusted: boolean;
    onToggleInflation: (v: boolean) => void;
    onExit: () => void;
    onSavePlan: (name: string, inputs: SimulationInputs) => void;
    onApply: (recommended: SimulationInputs) => void;
}

type Phase =
    | { kind: 'setup' }
    | { kind: 'running'; done: number; total: number }
    | { kind: 'results'; result: MeltdownResult }
    | { kind: 'error' };

const BAND_OPTIONS: { mode: BandMode; label: string }[] = [
    { mode: 'off', label: 'No bands' },
    { mode: 'p25p75', label: 'Likely (25–75%)' },
    { mode: 'p5p95', label: 'Full (5–95%)' },
];

const secondaryBtn =
    'text-sm bg-slate-50 text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200 font-medium whitespace-nowrap';
const primaryBtn =
    'text-sm bg-brand-600 text-white px-5 py-2.5 rounded-lg hover:bg-brand-700 transition-colors font-semibold whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed';

export function MeltdownOptimizerView({
    liveInputs,
    hasRealPlan,
    isInflationAdjusted,
    onToggleInflation,
    onExit,
    onSavePlan,
    onApply,
}: MeltdownOptimizerViewProps) {
    const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
    const [considerCppOas, setConsiderCppOas] = useState(true);
    const [bandMode, setBandMode] = useState<BandMode>('p25p75');
    const [saved, setSaved] = useState(false);
    const [applied, setApplied] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Abort any in-flight search on unmount.
    useEffect(() => () => abortRef.current?.abort(), []);

    const runSearch = useCallback(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setSaved(false);
        setApplied(false);
        setPhase({ kind: 'running', done: 0, total: 1 });

        optimizeMeltdown(liveInputs, {
            considerCppOas,
            mcIterations: 200,
            signal: controller.signal,
            onProgress: (done, total) => {
                if (controller.signal.aborted) return;
                setPhase({ kind: 'running', done, total });
            },
        })
            .then(result => {
                if (controller.signal.aborted) return;
                setPhase({ kind: 'results', result });
            })
            .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                console.error('Meltdown optimization failed', err);
                setPhase({ kind: 'error' });
            });
    }, [liveInputs, considerCppOas]);

    // Back to the setup screen (also cancels a running search).
    const backToSetup = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setSaved(false);
        setApplied(false);
        setPhase({ kind: 'setup' });
    }, []);

    // Visitors without a saved plan typically arrived from the landing page, not
    // the dashboard — "Back" would claim a place they've never been.
    const exitLabel = hasRealPlan ? 'Back to Dashboard' : 'Go to Dashboard';

    const header = (
        <h2 className="text-2xl font-bold text-slate-900 text-center">RRSP Meltdown Optimizer</h2>
    );

    if (phase.kind === 'setup') {
        return (
            <div className="flex flex-col gap-6">
                {header}
                <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-100 max-w-2xl w-full mx-auto">
                    <h3 className="text-lg font-bold text-slate-900">What is an RRSP meltdown?</h3>
                    <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                        An RRSP "meltdown" means voluntarily drawing down your RRSP in your
                        lower-income early-retirement years — before age 72, when mandatory
                        RRIF minimums, CPP and OAS all start stacking on top of each other.
                        Withdrawing at today's lower tax rates can shrink the large tax bill
                        that would otherwise land on your RRSP at death, leaving more for your
                        estate.
                    </p>
                    <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                        This tool searches hundreds of combinations of annual withdrawal
                        amounts (and, optionally, CPP/OAS start ages) and finds the one that
                        leaves the largest estate without running you short.
                    </p>
                    <p className="mt-3 text-sm">
                        <a
                            href="/rrsp-withdrawal-strategy/"
                            className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
                        >
                            Learn more about the RRSP meltdown strategy →
                        </a>
                    </p>

                    <div className="mt-6 max-w-md">
                        <Toggle
                            checked={considerCppOas}
                            onChange={setConsiderCppOas}
                            label="Also consider delaying CPP/OAS (recommended)"
                            tooltip="Delaying CPP and OAS raises the guaranteed lifetime benefit and often pairs well with an RRSP meltdown. Turn off to keep your current start ages fixed."
                        />
                    </div>

                    {!hasRealPlan && (
                        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
                            <svg className="w-5 h-5 text-amber-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            <div>
                                <p className="text-sm font-bold text-amber-900">These are sample numbers</p>
                                <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                                    You haven't set up your own plan yet, so the optimizer would run
                                    on the sample data you see on the dashboard. For a recommendation
                                    about your retirement, run the Guided Setup first — it takes a few
                                    minutes and asks for your ages, balances, and spending.
                                </p>
                                <a href="/?setup=1" className={`${primaryBtn} mt-3 inline-block`}>
                                    Run Guided Setup
                                </a>
                            </div>
                        </div>
                    )}

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        <button onClick={runSearch} className={hasRealPlan ? primaryBtn : secondaryBtn}>
                            {hasRealPlan ? 'Find my best meltdown' : 'Continue with sample numbers'}
                        </button>
                        <button onClick={onExit} className={secondaryBtn}>
                            {exitLabel}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (phase.kind === 'running') {
        const pct = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : 0;
        return (
            <div className="flex flex-col gap-6">
                {header}
                <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-100 max-w-2xl w-full mx-auto">
                    <p className="text-sm font-medium text-slate-700">Searching for your best meltdown…</p>
                    <div className="mt-4 h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-brand-500 transition-all duration-150"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <p className="mt-2 text-xs text-slate-400">{pct}%</p>
                    <button onClick={backToSetup} className={`${secondaryBtn} mt-6`}>
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    if (phase.kind === 'error') {
        return (
            <div className="flex flex-col gap-6">
                {header}
                <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-100 max-w-2xl w-full mx-auto">
                    <p className="text-sm text-rose-600">
                        Something went wrong running the optimizer. Please try again.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        <button onClick={backToSetup} className={primaryBtn}>
                            Try again
                        </button>
                        <button onClick={onExit} className={secondaryBtn}>
                            {exitLabel}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <ResultsView
            result={phase.result}
            isInflationAdjusted={isInflationAdjusted}
            onToggleInflation={onToggleInflation}
            bandMode={bandMode}
            onBandMode={setBandMode}
            saved={saved}
            onSave={() => {
                onSavePlan('Suggested meltdown', phase.result.recommendedInputs);
                setSaved(true);
            }}
            applied={applied}
            onApply={() => {
                onApply(phase.result.recommendedInputs);
                setApplied(true);
            }}
            onRunAgain={backToSetup}
            onExit={onExit}
            exitLabel={exitLabel}
        />
    );
}

// --- Results ------------------------------------------------------------

interface ResultsViewProps {
    result: MeltdownResult;
    isInflationAdjusted: boolean;
    onToggleInflation: (v: boolean) => void;
    bandMode: BandMode;
    onBandMode: (m: BandMode) => void;
    saved: boolean;
    onSave: () => void;
    applied: boolean;
    onApply: () => void;
    onRunAgain: () => void;
    onExit: () => void;
    exitLabel: string;
}

function ResultsView({
    result,
    isInflationAdjusted,
    onToggleInflation,
    bandMode,
    onBandMode,
    saved,
    onSave,
    applied,
    onApply,
    onRunAgain,
    onExit,
    exitLabel,
}: ResultsViewProps) {
    // Two ephemeral comparison runs: current plan vs. suggested meltdown. Metrics
    // honour the inflation toggle (recomputed from results, like ComparisonView).
    const runs = useMemo<ComparisonRun[]>(() => {
        return [
            {
                comparand: { id: 'baseline', name: 'Current plan', inputs: result.baselineInputs },
                color: PLAN_COLORS[0],
                results: result.baselineResults,
                metrics: computeSummaryMetrics(result.baselineResults, result.baselineInputs, isInflationAdjusted),
                monteCarlo: result.baselineMonteCarlo,
            },
            {
                comparand: { id: 'suggested', name: 'Suggested meltdown', inputs: result.recommendedInputs },
                color: PLAN_COLORS[1],
                results: result.recommendedResults,
                metrics: computeSummaryMetrics(result.recommendedResults, result.recommendedInputs, isInflationAdjusted),
                monteCarlo: result.recommendedMonteCarlo,
            },
        ];
    }, [result, isInflationAdjusted]);

    const chartData = useMemo(
        () => buildComparisonChartData(runs, bandMode, isInflationAdjusted),
        [runs, bandMode, isInflationAdjusted],
    );

    const secondary = secondaryBtn;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-4">
                <h2 className="text-2xl font-bold text-slate-900 mr-auto">RRSP Meltdown Optimizer</h2>

                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    {BAND_OPTIONS.map(opt => (
                        <button
                            key={opt.mode}
                            onClick={() => onBandMode(opt.mode)}
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
            </div>

            {result.improved ? (
                <RecommendationCard result={result} />
            ) : (
                <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-6">
                    <p className="text-base font-bold text-emerald-900">Your current plan already looks good</p>
                    <p className="mt-1.5 text-sm text-emerald-800">
                        We couldn't find a meltdown schedule that meaningfully beats what you've
                        already got — your RRSP drawdown, CPP and OAS timing are close to optimal
                        for leaving the largest estate. The comparison below shows the numbers.
                    </p>
                </div>
            )}

            <ComparisonChart
                data={chartData}
                runs={runs}
                bandMode={bandMode}
                inflationAdjusted={isInflationAdjusted}
            />
            <ComparisonSummaryCards runs={runs} />
            <ComparisonMetricsTable runs={runs} inflationAdjusted={isInflationAdjusted} />

            {result.improved && (
                <p className="text-xs text-slate-500">
                    Applying overwrites the RRSP melt amount and CPP/OAS start ages on the
                    plan you're currently editing — everything else (balances, spending,
                    other edits) is left as-is. Prefer to keep both versions? Save this as a
                    new plan instead.
                </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
                {result.improved && (
                    <button
                        onClick={onApply}
                        disabled={applied}
                        className={applied
                            ? 'text-sm bg-emerald-50 text-emerald-700 px-5 py-2.5 rounded-lg border border-emerald-200 font-semibold whitespace-nowrap cursor-default'
                            : primaryBtn}
                    >
                        {applied ? 'Applied ✓' : 'Apply to current plan'}
                    </button>
                )}
                {result.improved && (
                    <button
                        onClick={onSave}
                        disabled={saved}
                        className={saved
                            ? 'text-sm bg-emerald-50 text-emerald-700 px-5 py-2.5 rounded-lg border border-emerald-200 font-semibold whitespace-nowrap cursor-default'
                            : secondary}
                    >
                        {saved ? 'Saved ✓' : 'Save as new plan'}
                    </button>
                )}
                <button onClick={onRunAgain} className={secondary}>
                    Run again
                </button>
                <button onClick={onExit} className={secondary}>
                    {exitLabel}
                </button>
            </div>
        </div>
    );
}

function RecommendationCard({ result }: { result: MeltdownResult }) {
    return (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900">Suggested meltdown</h3>

            <div className="mt-4 space-y-6">
                {result.decisions.map(d => (
                    <DecisionTable key={d.who} decision={d} showLabel={result.decisions.length > 1} />
                ))}
            </div>

            <p className="mt-3 text-xs text-slate-400">
                The melt runs each year until age 71 (RRIF conversion) or until the RRSP is empty.
            </p>

            {/* Headline deltas */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Headline
                    label="Net estate"
                    value={`${result.netEstateDelta >= 0 ? '+' : '−'}${formatCurrencyCAD(Math.abs(result.netEstateDelta))}`}
                    tone={result.netEstateDelta >= 0 ? 'good' : 'bad'}
                />
                <Headline
                    label="Lifetime tax"
                    value={`${result.lifetimeTaxDelta <= 0 ? '−' : '+'}${formatCurrencyCAD(Math.abs(result.lifetimeTaxDelta))}`}
                    tone={result.lifetimeTaxDelta <= 0 ? 'good' : 'bad'}
                />
                <Headline
                    label="Monte Carlo success"
                    value={
                        result.baselineSuccessRate !== null && result.recommendedSuccessRate !== null
                            ? `${result.recommendedSuccessRate.toFixed(0)}% vs ${result.baselineSuccessRate.toFixed(0)}%`
                            : '—'
                    }
                    tone="neutral"
                />
            </div>

            {result.mcWarning && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                    <svg className="w-5 h-5 text-amber-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <p className="text-xs text-amber-800">
                        This meltdown leaves a larger estate but has a somewhat lower Monte Carlo
                        success rate than your current plan — it leans on markets behaving. Review
                        the success rates below before saving.
                    </p>
                </div>
            )}
        </div>
    );
}

// Suggested-column cell: highlighted (emerald, semibold) when it differs from
// the current-plan cell, plain slate otherwise.
function SuggestedCell({ value, changed }: { value: string; changed: boolean }) {
    return (
        <td
            className={`text-right py-1.5 pl-4 tabular-nums whitespace-nowrap ${
                changed ? 'font-semibold text-emerald-600' : 'text-slate-700'
            }`}
        >
            {value}
        </td>
    );
}

function meltCell(amount: number): string {
    return amount <= 0 ? 'None' : `${formatCurrencyCAD(amount)}/yr`;
}

function meltStartCell(amount: number, startAge: number): string {
    return amount <= 0 ? '—' : String(startAge);
}

function DecisionTable({ decision: d, showLabel }: { decision: PersonMeltdownDecision; showLabel: boolean }) {
    const currentMeltStart = meltStartCell(d.originalMeltAmount, d.originalMeltStartAge);
    const suggestedMeltStart = meltStartCell(d.meltAmount, d.meltStartAge);

    const rows: { label: string; current: string; suggested: string; changed: boolean }[] = [
        {
            label: 'RRSP melt',
            current: meltCell(d.originalMeltAmount),
            suggested: meltCell(d.meltAmount),
            changed: d.originalMeltAmount !== d.meltAmount,
        },
        {
            label: 'Melt start age',
            current: currentMeltStart,
            suggested: suggestedMeltStart,
            changed: currentMeltStart !== suggestedMeltStart,
        },
        {
            label: 'CPP start age',
            current: String(d.originalCppStartAge),
            suggested: String(d.cppStartAge),
            changed: d.cppChanged,
        },
        {
            label: 'OAS start age',
            current: String(d.originalOasStartAge),
            suggested: String(d.oasStartAge),
            changed: d.oasChanged,
        },
    ];

    return (
        <div>
            {showLabel && <p className="mb-2 text-sm font-semibold text-slate-800">{d.label}</p>}
            <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-slate-200">
                            <th className="text-left font-medium text-slate-500 py-1.5 pr-4" />
                            <th className="text-right font-medium text-slate-500 py-1.5 pl-4 whitespace-nowrap">
                                Current plan
                            </th>
                            <th className="text-right font-medium text-slate-500 py-1.5 pl-4 whitespace-nowrap">
                                Suggested
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={row.label} className="border-b border-slate-100 last:border-0">
                                <td className="text-left text-slate-500 py-1.5 pr-4">{row.label}</td>
                                <td className="text-right py-1.5 pl-4 tabular-nums whitespace-nowrap text-slate-700">
                                    {row.current}
                                </td>
                                <SuggestedCell value={row.suggested} changed={row.changed} />
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Headline({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'neutral' }) {
    const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-900';
    return (
        <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-1.5 text-lg font-bold tabular-nums ${color}`}>{value}</p>
        </div>
    );
}
