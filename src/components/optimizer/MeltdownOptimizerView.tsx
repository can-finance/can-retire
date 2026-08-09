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
import { Dialog } from '../ui/Dialog';
import { ComparisonChart } from '../charts/ComparisonChart';
import { ComparisonSummaryCards } from '../comparison/ComparisonSummaryCards';
import { ComparisonMetricsTable } from '../comparison/ComparisonMetricsTable';

interface MeltdownOptimizerViewProps {
    liveInputs: SimulationInputs;
    hasRealPlan: boolean;
    /** Name of the active plan the optimizer will run on (shown on the setup screen). */
    activePlanName: string;
    isInflationAdjusted: boolean;
    onToggleInflation: (v: boolean) => void;
    onExit: () => void;
    onSavePlan: (name: string, inputs: SimulationInputs) => string;
    onApply: (recommended: SimulationInputs, objective: 'estate' | 'max-spend') => void;
}

type Objective = 'estate' | 'max-spend';

// Human labels for the household withdrawal strategy (mirrors the app's relabel).
function strategyLabel(s: 'tax-efficient' | 'rrsp-first' | undefined): string {
    return s === 'rrsp-first' ? 'RRSP first (early melt)' : 'RRSP last (defer taxes)';
}

const SUCCESS_TARGETS: { value: number; label: string; blurb: string }[] = [
    { value: 75, label: 'Aggressive', blurb: 'Spend more, accept more risk of falling short.' },
    { value: 85, label: 'Balanced', blurb: 'A sensible middle ground (recommended).' },
    { value: 95, label: 'Conservative', blurb: 'Spend less, stay funded in almost every scenario.' },
];

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
    activePlanName,
    isInflationAdjusted,
    onToggleInflation,
    onExit,
    onSavePlan,
    onApply,
}: MeltdownOptimizerViewProps) {
    const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
    const [objective, setObjective] = useState<Objective>('estate');
    const [mcSuccessTarget, setMcSuccessTarget] = useState(85);
    const [considerCppOas, setConsiderCppOas] = useState(true);
    const [bandMode, setBandMode] = useState<BandMode>('p25p75');
    const [savedName, setSavedName] = useState<string | null>(null);
    const [saveDialogOpen, setSaveDialogOpen] = useState(false);
    const [applied, setApplied] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Abort any in-flight search on unmount.
    useEffect(() => () => abortRef.current?.abort(), []);

    const runSearch = useCallback(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setSavedName(null);
        setSaveDialogOpen(false);
        setApplied(false);
        setPhase({ kind: 'running', done: 0, total: 1 });

        optimizeMeltdown(liveInputs, {
            objective,
            considerCppOas,
            mcIterations: 200,
            mcSuccessTarget,
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
    }, [liveInputs, objective, considerCppOas, mcSuccessTarget]);

    // Back to the setup screen (also cancels a running search).
    const backToSetup = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setSavedName(null);
        setSaveDialogOpen(false);
        setApplied(false);
        setPhase({ kind: 'setup' });
    }, []);

    // Visitors without a saved plan typically arrived from the landing page, not
    // the dashboard — "Back" would claim a place they've never been.
    const exitLabel = hasRealPlan ? 'Back to Dashboard' : 'Go to Dashboard';

    const header = (
        <h2 className="text-2xl font-bold text-slate-900 text-center">
            RRSP Meltdown Optimizer
            <span className="ml-2 inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-bold align-middle">BETA</span>
        </h2>
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
                        RRIF minimum withdrawals begin and stack on top of CPP, OAS and any
                        other income. Withdrawing at today's lower tax rates can shrink the
                        large tax bill that would otherwise land on your RRSP at death,
                        leaving more for your estate.
                    </p>
                    <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                        This tool searches hundreds of strategy combinations and can
                        optimize for different goals:
                    </p>
                    <ul className="mt-2 text-sm text-slate-600 leading-relaxed list-disc pl-5 space-y-1">
                        <li>
                            <span className="font-medium text-slate-700">Leave the largest estate</span> — the
                            withdrawal schedule that passes the most to your heirs after tax, without
                            running you short.
                        </li>
                        <li>
                            <span className="font-medium text-slate-700">Spend the most in retirement</span> — the
                            highest annual spending your savings can sustain at a confidence level you choose.
                        </li>
                    </ul>
                    <p className="mt-3 text-sm">
                        <a
                            href="/rrsp-withdrawal-strategy/"
                            className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
                        >
                            Learn more about the RRSP meltdown strategy →
                        </a>
                    </p>

                    {hasRealPlan && (
                        <div className="mt-6 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                            <p className="text-sm text-slate-600">
                                Optimizing plan: <span className="font-semibold text-slate-900">{activePlanName}</span>
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                                To optimize a different plan, select it in the plan list on the dashboard first.
                            </p>
                        </div>
                    )}

                    <div className="mt-6">
                        <p className="text-sm font-semibold text-slate-800">What should the optimizer aim for?</p>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <ObjectiveCard
                                selected={objective === 'estate'}
                                onSelect={() => setObjective('estate')}
                                title="Leave the largest estate"
                                sub="Shrinks the terminal tax bill so more passes to your heirs."
                                detail="Adjusts RRSP melt and CPP/OAS timing — your spending stays as planned."
                            />
                            <ObjectiveCard
                                selected={objective === 'max-spend'}
                                onSelect={() => setObjective('max-spend')}
                                title="Spend the most in retirement"
                                sub="Finds the highest annual spending your savings can sustain."
                                detail="Adjusts RRSP melt, CPP/OAS timing and withdrawal order — and solves for your spending."
                            />
                        </div>
                    </div>

                    {objective === 'max-spend' && (
                        <div className="mt-5">
                            <p className="text-sm font-semibold text-slate-800">How safe should that spending be?</p>
                            <p className="mt-1 text-xs text-slate-500">
                                The Monte Carlo success rate the sustainable spending must clear — the
                                portion of simulations in which you don't run out of money.
                            </p>
                            <div className="mt-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                                {SUCCESS_TARGETS.map(t => (
                                    <button
                                        key={t.value}
                                        onClick={() => setMcSuccessTarget(t.value)}
                                        aria-pressed={mcSuccessTarget === t.value}
                                        className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                                            mcSuccessTarget === t.value
                                                ? 'bg-brand-600 text-white shadow-sm'
                                                : 'text-slate-600 hover:bg-slate-100'
                                        }`}
                                    >
                                        {t.label} ({t.value}%)
                                    </button>
                                ))}
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                                {SUCCESS_TARGETS.find(t => t.value === mcSuccessTarget)?.blurb}
                            </p>
                        </div>
                    )}

                    <div className="mt-6 max-w-md">
                        <Toggle
                            checked={considerCppOas}
                            onChange={setConsiderCppOas}
                            label="Optimize CPP/OAS timing (recommended)"
                            tooltip="Lets the optimizer test different CPP (60–70) and OAS (65–70) start ages alongside the melt. Delaying usually raises the guaranteed lifetime benefit and pairs well with a meltdown, but earlier starts are tested too. Turn off to keep your current start ages fixed."
                        />
                        <p className="mt-1 text-xs text-slate-500">
                            {liveInputs.spouse
                                ? `Currently — You: CPP at ${liveInputs.person.cppStartAge}, OAS at ${liveInputs.person.oasStartAge} · Spouse: CPP at ${liveInputs.spouse.cppStartAge}, OAS at ${liveInputs.spouse.oasStartAge}`
                                : `Currently CPP at ${liveInputs.person.cppStartAge}, OAS at ${liveInputs.person.oasStartAge}`}
                        </p>
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
                            {hasRealPlan
                                ? (objective === 'max-spend' ? 'Find my max spending' : 'Find my best meltdown')
                                : 'Continue with sample numbers'}
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
                    <p className="text-sm font-medium text-slate-700">
                        {objective === 'max-spend'
                            ? 'Searching for your highest sustainable spending…'
                            : 'Searching for your best meltdown…'}
                    </p>
                    <div className="mt-4 h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-brand-500 transition-all duration-150"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{pct}%</p>
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
            savedName={savedName}
            saveDialogOpen={saveDialogOpen}
            onSave={() => {
                const baseName = phase.result.objective === 'max-spend' ? 'Suggested plan' : 'Suggested meltdown';
                setSavedName(onSavePlan(baseName, phase.result.recommendedInputs));
                setSaveDialogOpen(true);
            }}
            onCloseSaveDialog={() => setSaveDialogOpen(false)}
            applied={applied}
            onApply={() => {
                onApply(phase.result.recommendedInputs, phase.result.objective);
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
    savedName: string | null;
    saveDialogOpen: boolean;
    onSave: () => void;
    onCloseSaveDialog: () => void;
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
    savedName,
    saveDialogOpen,
    onSave,
    onCloseSaveDialog,
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
                comparand: {
                    id: 'suggested',
                    name: result.objective === 'max-spend' ? 'Suggested plan' : 'Suggested meltdown',
                    inputs: result.recommendedInputs,
                },
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

    /*
     * The caveat travels with the buttons — it describes what Apply overwrites,
     * so it has to be read before the button, not stranded elsewhere on the page.
     *
     * Where this lands depends on the result shape. A max-spend recommendation
     * splits into an answer box and a detail box, so the actions slot BETWEEN
     * them (passed into MaxSpendCard). Every other shape is a single box, and
     * the actions follow it directly. Either way they sit above the chart and
     * comparison table, which are evidence for the recommendation rather than
     * something you must read before acting on it.
     */
    const actions = (
        <>
            {result.improved && (
                <p className="text-xs text-slate-500">
                    {result.objective === 'max-spend'
                        ? 'Applying overwrites your annual spending, RRSP melt amount, CPP/OAS start ages and withdrawal order on the plan you’re currently editing — everything else (balances, other edits) is left as-is. Prefer to keep both versions? Save this as a new plan instead.'
                        : 'Applying overwrites the RRSP melt amount and CPP/OAS start ages on the plan you’re currently editing — everything else (balances, spending, other edits) is left as-is. Prefer to keep both versions? Save this as a new plan instead.'}
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
                        disabled={savedName !== null}
                        className={savedName !== null
                            ? 'text-sm bg-emerald-50 text-emerald-700 px-5 py-2.5 rounded-lg border border-emerald-200 font-semibold whitespace-nowrap cursor-default'
                            : secondary}
                    >
                        {savedName !== null ? 'Saved ✓' : 'Save as new plan'}
                    </button>
                )}
                <button onClick={onRunAgain} className={secondary}>
                    Run again
                </button>
                <button onClick={onExit} className={secondary}>
                    {exitLabel}
                </button>
            </div>
        </>
    );

    // MaxSpendCard renders `actions` itself, between its two boxes — don't
    // render them a second time at view level.
    const actionsInCard = result.objective === 'max-spend' && result.improved;

    return (
        <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-bold text-slate-900">
                RRSP Meltdown Optimizer
                <span className="ml-2 inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-bold align-middle">BETA</span>
            </h2>

            {result.objective === 'max-spend' ? (
                result.improved ? (
                    <MaxSpendCard result={result} actions={actions} />
                ) : (
                    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-6">
                        <p className="text-base font-bold text-emerald-900">Your planned spending is about right</p>
                        <p className="mt-1.5 text-sm text-emerald-800">
                            Your current spending is about the most your savings can sustainably
                            support at the {result.maxSpend?.mcSuccessTarget}% success level — we
                            couldn't find a meaningfully higher figure without pushing the plan past
                            that bar. The comparison below shows the numbers.
                        </p>
                    </div>
                )
            ) : result.improved ? (
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

            {!actionsInCard && actions}

            <div className="flex flex-wrap items-center justify-end gap-4 -mb-3">
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

            <ComparisonChart
                data={chartData}
                runs={runs}
                bandMode={bandMode}
                inflationAdjusted={isInflationAdjusted}
            />
            <ComparisonSummaryCards runs={runs} />
            <ComparisonMetricsTable runs={runs} inflationAdjusted={isInflationAdjusted} />

            <Dialog
                open={saveDialogOpen}
                onClose={onCloseSaveDialog}
                title="Plan saved"
                footer={
                    <button onClick={onCloseSaveDialog} data-autofocus className={primaryBtn}>
                        Done
                    </button>
                }
            >
                <p>
                    Saved as "{savedName}". You'll find it in your plan list on the
                    dashboard, and your current plan is untouched.
                </p>
            </Dialog>
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

            <p className="mt-3 text-xs text-slate-500">
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

// Selectable objective card for the setup screen. `detail` is the tiny
// "what it adjusts / what it solves for" line — the per-objective search space.
function ObjectiveCard({
    selected, onSelect, title, sub, detail,
}: { selected: boolean; onSelect: () => void; title: string; sub: string; detail?: string }) {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={`text-left rounded-xl border p-4 transition-colors ${
                selected
                    ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                    : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
        >
            <p className={`text-base font-semibold ${selected ? 'text-brand-700' : 'text-slate-800'}`}>{title}</p>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">{sub}</p>
            {detail && <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">{detail}</p>}
        </button>
    );
}

// Generic current-vs-suggested table (household spending/strategy rows).
function SimpleChangeTable({
    title, rows,
}: { title?: string; rows: { label: string; current: string; suggested: string; changed: boolean }[] }) {
    return (
        <div>
            {title && <p className="mb-2 text-sm font-semibold text-slate-800">{title}</p>}
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

/*
 * `actions` is slotted between the two boxes rather than rendered after the
 * card: the first box is the answer ("you could sustainably spend X"), the
 * second is the detail behind it. Someone who has read the answer and wants to
 * act on it shouldn't have to scroll past the suggested-plan tables to reach
 * Apply — and someone who wants the detail hasn't lost anything by scrolling
 * past the buttons.
 */
function MaxSpendCard({ result, actions }: { result: MeltdownResult; actions?: React.ReactNode }) {
    const ms = result.maxSpend!;
    // The figure only deserves good-news framing when it actually cleared the
    // user's success bar — a cap-hit spend is an optimistic upper bound, not a
    // sustainable level, regardless of how it compares to planned spending.
    const metTarget = !ms.stepDownCapHit;
    const good = ms.spendDelta > 0 && metTarget;
    const deltaAbs = formatCurrencyCAD(Math.abs(ms.spendDelta));
    const sustainable = formatCurrencyCAD(ms.sustainableSpend);

    const householdRows = [
        {
            label: 'Annual spending',
            current: `${formatCurrencyCAD(ms.currentSpend)}/yr`,
            suggested: `${sustainable}/yr`,
            changed: ms.sustainableSpend !== ms.currentSpend,
        },
        {
            label: 'Withdrawal order',
            current: strategyLabel(result.baselineInputs.withdrawalStrategy),
            suggested: strategyLabel(ms.withdrawalStrategy),
            changed: ms.strategyChanged,
        },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div
                className={`rounded-2xl border p-6 ${
                    good
                        ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50'
                        : 'border-amber-200 bg-amber-50'
                }`}
            >
                <p className={`text-base font-bold ${good ? 'text-emerald-900' : 'text-amber-900'}`}>
                    {!metTarget
                        ? `We couldn’t confirm a spending level that clears your ${ms.mcSuccessTarget}% success bar`
                        : good
                            ? `You could sustainably spend ${sustainable}/yr — ${deltaAbs}/yr more than planned`
                            : `Your plan supports about ${sustainable}/yr — ${deltaAbs}/yr less than you’ve planned`}
                </p>
                <p className={`mt-1.5 text-sm ${good ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {!metTarget
                        ? `The lowest spending our search tested, ${sustainable}/yr, only reached ${ms.achievedSuccessRate.toFixed(0)}% Monte Carlo success. Treat it as an optimistic upper bound — the spending that truly clears ${ms.mcSuccessTarget}% is lower. Rerunning with a lower success bar can give a confirmed answer.`
                        : good
                            ? `That’s the highest flat annual spending your savings can support while still clearing a ${ms.mcSuccessTarget}% Monte Carlo success rate.`
                            : `At the ${ms.mcSuccessTarget}% Monte Carlo success bar, your savings can’t sustain what you’ve planned to spend. Applying lowers your plan’s spending to the sustainable level.`}
                </p>
                <p className={`mt-2 text-sm font-medium ${good ? 'text-emerald-800' : 'text-amber-800'}`}>
                    Monte Carlo success at this spending: {ms.achievedSuccessRate.toFixed(0)}%{' '}
                    {metTarget ? `(target ${ms.mcSuccessTarget}%)` : `— short of the ${ms.mcSuccessTarget}% target`}
                </p>
            </div>

            {actions}

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">Suggested plan</h3>

                <div className="mt-4">
                    <SimpleChangeTable title="Household" rows={householdRows} />
                </div>

                <div className="mt-6 space-y-6">
                    {result.decisions.map(d => (
                        <DecisionTable key={d.who} decision={d} showLabel />
                    ))}
                </div>

                <p className="mt-3 text-xs text-slate-500">
                    The melt runs each year until age 71 (RRIF conversion) or until the RRSP is empty.
                </p>

                <p className="mt-4 text-xs text-slate-500 leading-relaxed">
                    This model assumes the same inflation-adjusted spending every year. Real
                    retirement spending is usually front-loaded — higher in the early “go-go” years —
                    so a flat sustainable figure tends to be conservative early on and generous later.
                </p>
            </div>
        </div>
    );
}
