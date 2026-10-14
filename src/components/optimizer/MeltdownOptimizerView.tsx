import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SimulationInputs } from '../../engine/types';
import type { ComparisonRun, BandMode } from '../../utils/comparison';
import { buildComparisonChartData } from '../../utils/comparison';
import { computeSummaryMetrics } from '../../utils/summaryMetrics';
import { optimizeMeltdown } from '../../utils/meltdownOptimizer';
import type { MeltdownResult, OptimizerObjective, PersonMeltdownDecision } from '../../utils/meltdownOptimizer';
import { planAgeShift } from '../../utils/retirementAgeSearch';
import { PLAN_COLORS } from '../../constants/chartColors';
import { formatCurrencyApprox, formatCurrencyCAD, roundCurrencyApprox } from '../../utils/formatters';
import { Toggle } from '../ui/Toggle';
import { Dialog } from '../ui/Dialog';
import { HelpTooltip } from '../ui/HelpTooltip';
import { ComparisonChart } from '../charts/ComparisonChart';
import { ComparisonSummaryCards } from '../comparison/ComparisonSummaryCards';
import { ComparisonMetricsTable } from '../comparison/ComparisonMetricsTable';
import { EarliestAgeHeadline } from './EarliestAgeHeadline';
import { EarliestAgeTable } from './EarliestAgeTable';
import { SavingsNeededHeadline } from './SavingsNeededHeadline';
import { SavingsNeededTable } from './SavingsNeededTable';
import { saveAsYouGoAmount, saveAsYouGoPlan, savingsAgeTableShown, savingsAnswerClears } from './savingsNeededSummary';
import { describeStrategyChanges } from './strategySummary';
import { SUCCESS_TARGETS, DEFAULT_SUCCESS_TARGET } from './successTargets';

interface MeltdownOptimizerViewProps {
    liveInputs: SimulationInputs;
    hasRealPlan: boolean;
    /** Name of the active plan the optimizer will run on (shown on the setup screen). */
    activePlanName: string;
    isInflationAdjusted: boolean;
    onToggleInflation: (v: boolean) => void;
    onExit: () => void;
    onSavePlan: (name: string, inputs: SimulationInputs) => string;
    onApply: (recommended: SimulationInputs, objective: OptimizerObjective) => void;
}

type Objective = OptimizerObjective;

/*
 * What the search was solving for. For the three strategy goals it is used
 * both as the comparison run's label and as the name of the plan if it gets
 * saved — deliberately one function, so the chart legend and the plan list can
 * never call the same scenario two things.
 *
 * Savings Needed is the exception (see runLabel / savedPlanName): its
 * second run isn't a strategy to adopt but the same plan at a different
 * balance, so the legend says so, and a saved copy carries the amount.
 */
function objectiveLabel(objective: Objective): string {
    if (objective === 'max-spend') return 'Maximize Spend';
    if (objective === 'earliest-age') return 'Earliest Retirement';
    if (objective === 'savings-needed') return 'Savings Needed';
    return 'Maximize Estate';
}

// The comparison run's label: the goal, or for Savings Needed what the run
// holds — never a name that reads as a better strategy.
function runLabel(result: MeltdownResult): string {
    const sn = result.savingsNeeded;
    if (result.objective !== 'savings-needed' || !sn) return objectiveLabel(result.objective);
    if (savingsAnswerClears(sn)) return 'With the savings needed';
    // No amount clears the bar: the run is the best amount tried.
    return sn.neededSavings !== null ? `With ${formatCurrencyApprox(sn.neededSavings)} saved` : 'Current plan';
}

// What Savings Needed's comparison run holds, for the line above the chart.
function savingsComparisonPhrase(result: MeltdownResult): string {
    const sn = result.savingsNeeded;
    if (sn && !savingsAnswerClears(sn) && sn.neededSavings !== null) {
        return `with ${formatCurrencyApprox(sn.neededSavings)} saved, the best amount tried`;
    }
    return 'with the savings needed';
}

// The saved plan's name: the goal, or for Savings Needed the headline's amount
// — what you'd hold on the day you retire ("Needs $1.2M by 60"), or today's
// when everyone is already retired — so two runs stay apart in the plan list.
function savedPlanName(result: MeltdownResult): string {
    const sn = result.savingsNeeded;
    if (result.objective !== 'savings-needed' || !sn || sn.neededSavings === null) return objectiveLabel(result.objective);
    if (sn.retirementAge !== null && sn.neededAtRetirement !== null) {
        const amount = formatCurrencyApprox(sn.neededAtRetirement);
        return sn.reportedWho === 'spouse'
            ? `Needs ${amount} (spouse retires at ${sn.retirementAge})`
            : `Needs ${amount} by ${sn.retirementAge}`;
    }
    return `Needs ${formatCurrencyApprox(sn.neededSavings)}`;
}

// The save-as-you-go plan's saved name: the yearly amount and the age it runs
// to ("Save $14k/yr more to 60"), so it stays apart from the lump-sum copy.
// null when there is no save-as-you-go plan to save.
function saveAsYouGoPlanName(result: MeltdownResult): string | null {
    const sn = result.savingsNeeded;
    const plan = sn ? saveAsYouGoPlan(sn) : null;
    if (!sn || !plan || sn.retirementAge === null) return null;
    const amount = saveAsYouGoAmount(plan.extraPerYear);
    const save = amount === null ? 'Save a little more' : `Save ${amount} more`;
    return sn.reportedWho === 'spouse'
        ? `${save} (spouse retires at ${sn.retirementAge})`
        : `${save} to ${sn.retirementAge}`;
}

// Human labels for the household withdrawal strategy. Matches
// ComparisonMetricsTable's wording. Deliberately no "(early melt)" here: this
// setting is the drawdown ORDER, not the voluntary meltdown, which runs off
// each person's RRSP Melt Amount independently of it.
function strategyLabel(s: 'tax-efficient' | 'rrsp-first' | undefined): string {
    return s === 'rrsp-first' ? 'RRSP first' : 'RRSP last';
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
    activePlanName,
    isInflationAdjusted,
    onToggleInflation,
    onExit,
    onSavePlan,
    onApply,
}: MeltdownOptimizerViewProps) {
    const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
    const [objective, setObjective] = useState<Objective>('estate');
    const [mcSuccessTarget, setMcSuccessTarget] = useState(DEFAULT_SUCCESS_TARGET);
    const [considerCppOas, setConsiderCppOas] = useState(true);
    const [bandMode, setBandMode] = useState<BandMode>('p25p75');
    const [savedName, setSavedName] = useState<string | null>(null);
    // Savings Needed's second save, the save-as-you-go plan: saved apart from
    // the first, so each button keeps its own "Saved ✓".
    const [savedPerYearName, setSavedPerYearName] = useState<string | null>(null);
    const [saveDialogOpen, setSaveDialogOpen] = useState(false);
    // Which save the dialog is confirming.
    const [lastSaved, setLastSaved] = useState<'main' | 'per-year'>('main');
    const [applied, setApplied] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // The earliest-age search moves the retirement age of whoever is still
    // working — with nobody working there is nothing to move.
    const ageShift = useMemo(() => planAgeShift(liveInputs), [liveInputs]);
    const earliestUnavailable = !ageShift.available;
    const runDisabled = objective === 'earliest-age' && earliestUnavailable;

    // Abort any in-flight search on unmount.
    useEffect(() => () => abortRef.current?.abort(), []);

    const runSearch = useCallback(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setSavedName(null);
        setSavedPerYearName(null);
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
        setSavedPerYearName(null);
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
                <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-100 max-w-4xl w-full mx-auto">
                    <h3 className="text-lg font-bold text-slate-900">What is an RRSP meltdown?</h3>
                    <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                        An RRSP meltdown means withdrawing from your RRSP in your early
                        retirement years, while your income is lower. From 72, required RRIF
                        withdrawals start and add to your CPP, OAS and other income.
                        Withdrawing earlier, at lower tax rates, can shrink the large tax
                        bill your RRSP would otherwise face at death, leaving more for your
                        estate.
                    </p>
                    <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                        The optimizer tries a range of RRSP melt amounts, CPP and OAS start
                        ages, and withdrawal orders (RRSP first or last). The melt always
                        starts at retirement and runs to 71. Pick your goal below.
                    </p>
                    <p className="mt-3 text-sm">
                        <a
                            href="/rrsp-withdrawal-strategy/"
                            className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
                        >
                            Learn more about the RRSP meltdown strategy →
                        </a>
                    </p>

                    {/* Which plan is about to be rewritten. In a slate box with the name
                        as one more bolded word, this read as chrome — and Apply overwrites
                        the plan named here. The brand tint and the name on its own line at
                        the size the dashboard's plan field uses make it the thing you see.
                        Deliberately NOT styled as a field: it is not editable here, and the
                        line beneath says where it is. */}
                    {hasRealPlan && (
                        <div className="mt-6 rounded-lg bg-brand-50 border border-brand-200 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                                Optimizing plan
                            </p>
                            <p className="mt-1 text-lg font-semibold text-slate-900">{activePlanName}</p>
                            <p className="mt-1 text-xs text-slate-500">
                                To optimize a different plan, select it in the plan list on the dashboard first.
                            </p>
                        </div>
                    )}

                    <div className="mt-6">
                        <p className="text-sm font-semibold text-slate-800">What should the optimizer aim for?</p>
                        {/* Two by two from sm up: four across in this max-w-4xl card
                            would leave each title about 160px and wrap them unevenly. */}
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <ObjectiveCard
                                selected={objective === 'estate'}
                                onSelect={() => setObjective('estate')}
                                title="Leave the largest estate"
                                sub="Cuts the tax owed at death so more goes to your heirs."
                            />
                            <ObjectiveCard
                                selected={objective === 'max-spend'}
                                onSelect={() => setObjective('max-spend')}
                                title="Spend the most in retirement"
                                sub="Finds the most you can spend each year without running out."
                            />
                            <ObjectiveCard
                                selected={objective === 'earliest-age'}
                                onSelect={() => setObjective('earliest-age')}
                                disabled={earliestUnavailable}
                                title="Retire as early as possible"
                                sub="Finds the earliest age your plan stays funded at your current spending."
                                note={earliestUnavailable
                                    ? (ageShift.unavailableReason === 'no-common-range'
                                        ? 'Not available: your two retirement ages leave no room to move them together.'
                                        : 'Not available: everyone in this plan is already retired.')
                                    : undefined}
                            />
                            <ObjectiveCard
                                selected={objective === 'savings-needed'}
                                onSelect={() => setObjective('savings-needed')}
                                title="See how much you need"
                                sub="Finds the savings your plan needs at your current spending and retirement age."
                            />
                        </div>
                        {/* What the chosen goal changes, said once under the cards rather
                            than in all four — it only matters for the one you pick. */}
                        <p className="mt-3 text-sm text-slate-600">{OBJECTIVE_CHANGES[objective]}</p>
                    </div>

                    {(objective === 'max-spend' || objective === 'earliest-age' || objective === 'savings-needed') && (
                        <div className="mt-5">
                            <p className="text-sm font-semibold text-slate-800">
                                {objective === 'max-spend' ? 'How safe should that spending be?' : 'How sure do you want to be?'}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                                The portion of market simulations in which your money must last to the end of the plan.
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
                                {(() => {
                                    const t = SUCCESS_TARGETS.find(x => x.value === mcSuccessTarget);
                                    if (objective === 'earliest-age') return t?.ageBlurb;
                                    if (objective === 'savings-needed') return t?.savingsBlurb;
                                    return t?.blurb;
                                })()}
                            </p>
                        </div>
                    )}

                    <div className="mt-6">
                        {/* max-w-md belongs to the TOGGLE, not the block: it stops the switch
                            drifting to the far right of a 2xl card. The line beneath is plain
                            text with nothing to align, so it takes the card's full width and
                            stays on one line. */}
                        <div className="max-w-md">
                            <Toggle
                                checked={considerCppOas}
                                onChange={setConsiderCppOas}
                                label="Optimize CPP/OAS timing (recommended)"
                                tooltip="Also tests CPP start ages from 60 to 70 and OAS from 65 to 70. Starting later raises your benefits for life and often pairs well with a meltdown. Turn this off to keep your current start ages."
                            />
                        </div>
                        {/* One template string broke wherever it ran out of room, splitting
                            "OAS at 70" across two lines. Each age phrase is its own nowrap
                            atom now, so a break lands on a comma or the separator instead. */}
                        <p className="mt-1 text-xs text-slate-500">
                            Currently{liveInputs.spouse ? ' — ' : ' '}
                            <span className="whitespace-nowrap">
                                {liveInputs.spouse ? 'You: ' : ''}CPP at {liveInputs.person.cppStartAge}
                            </span>,{' '}
                            <span className="whitespace-nowrap">OAS at {liveInputs.person.oasStartAge}</span>
                            {liveInputs.spouse && (
                                <>
                                    {' · '}
                                    <span className="whitespace-nowrap">Spouse: CPP at {liveInputs.spouse.cppStartAge}</span>,{' '}
                                    <span className="whitespace-nowrap">OAS at {liveInputs.spouse.oasStartAge}</span>
                                </>
                            )}
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
                                    You haven't set up your own plan yet, so the optimizer would use
                                    the dashboard's sample numbers. To see results for your own
                                    retirement, run Guided Setup first. It takes a few minutes.
                                </p>
                                <a href="/?setup=1" className={`${primaryBtn} mt-3 inline-block`}>
                                    Run Guided Setup
                                </a>
                            </div>
                        </div>
                    )}

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        <button
                            onClick={runSearch}
                            disabled={runDisabled}
                            className={hasRealPlan ? primaryBtn : `${secondaryBtn} disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {hasRealPlan
                                ? (objective === 'max-spend'
                                    ? 'Find my highest spending'
                                    : objective === 'earliest-age'
                                        ? 'Find my earliest retirement age'
                                        : objective === 'savings-needed'
                                            ? 'Find how much I need'
                                            : 'Find my largest estate')
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
                <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-100 max-w-4xl w-full mx-auto">
                    <p className="text-sm font-medium text-slate-700">
                        {objective === 'max-spend'
                            ? 'Searching for your highest spending…'
                            : objective === 'earliest-age'
                                ? 'Searching for your earliest retirement age…'
                                : objective === 'savings-needed'
                                    ? 'Finding how much you need…'
                                    : 'Searching for your largest estate…'}
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
                <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-100 max-w-4xl w-full mx-auto">
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
            savedPerYearName={savedPerYearName}
            saveDialogOpen={saveDialogOpen}
            dialogName={lastSaved === 'per-year' ? savedPerYearName : savedName}
            onSave={() => {
                // uniquePlanName appends " 2", " 3" on collision, so re-running
                // the same objective stays readable in the plan list.
                const baseName = savedPlanName(phase.result);
                setSavedName(onSavePlan(baseName, phase.result.recommendedInputs));
                setLastSaved('main');
                setSaveDialogOpen(true);
            }}
            onSavePerYear={() => {
                // The save-as-you-go plan as the solver built it: today's
                // balances with the lower before-retirement spending.
                // applyMeltdownRecommendation would drop the spending change.
                const sn = phase.result.savingsNeeded;
                const plan = sn ? saveAsYouGoPlan(sn) : null;
                const baseName = saveAsYouGoPlanName(phase.result);
                if (!plan || !baseName) return;
                setSavedPerYearName(onSavePlan(baseName, plan.recommendedInputs));
                setLastSaved('per-year');
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
    savedPerYearName: string | null;   // Savings Needed's save-as-you-go copy
    saveDialogOpen: boolean;
    dialogName: string | null;         // the name the open dialog confirms
    onSave: () => void;
    onSavePerYear: () => void;
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
    savedPerYearName,
    saveDialogOpen,
    dialogName,
    onSave,
    onSavePerYear,
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
                    name: runLabel(result),
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

    // Savings Needed has no Apply: the answer's balances are facts about the
    // household, not settings to write into the plan. It can only be saved as
    // a copy, and only when there is an amount that clears the bar and it is
    // more than you have (a "you have enough" copy would just shrink your
    // savings; a "no amount works" one would hold an amount that doesn't work).
    const isSavings = result.objective === 'savings-needed';
    const canApply = result.improved && !isSavings;
    const canSave = isSavings
        ? result.improved && !!result.savingsNeeded && savingsAnswerClears(result.savingsNeeded)
        : result.improved;
    // Savings Needed's second copy, the save-as-you-go plan: only beside a
    // savable answer, and only when some yearly amount clears the bar too.
    const canSavePerYear = isSavings && canSave && saveAsYouGoPlanName(result) !== null;
    const savedBtn = 'text-sm bg-emerald-50 text-emerald-700 px-5 py-2.5 rounded-lg border border-emerald-200 font-semibold whitespace-nowrap cursor-default';

    // Savings Needed's comparison run is the plan at a different balance. When
    // no amount can fund the spending even on average returns there is no such
    // run (it is the plan as entered twice), so there is nothing to compare.
    const showComparison = !(isSavings && result.savingsNeeded?.status === 'unreachable');

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
            {canApply && (
                <p className="text-xs text-slate-500">
                    {result.objective === 'max-spend'
                        ? 'Applying changes your annual spending, RRSP melt amount, CPP/OAS start ages and withdrawal order in your current plan. Nothing else changes. To keep both versions, use Save as new plan instead.'
                        : result.objective === 'earliest-age'
                            ? `Applying changes your retirement age${result.earliestAge?.cppOverrideHeld ? '' : ' (and your CPP years to match)'}, RRSP melt amount, CPP/OAS start ages and withdrawal order in your current plan. Your spending and everything else stay the same. To keep both versions, use Save as new plan instead.`
                            : 'Applying changes the RRSP melt amount, CPP/OAS start ages and withdrawal order in your current plan. Nothing else changes. To keep both versions, use Save as new plan instead.'}
                </p>
            )}
            {isSavings && canSave && (canSavePerYear ? (
                <p className="text-xs text-slate-500">
                    Save as new plan adds a copy of your plan with the savings needed and the strategy
                    the amount assumes. Save the save-as-you-go plan adds a copy with your savings as they
                    are today and less spending before you retire instead. You can explore either year by
                    year, and your current plan stays as it is.
                </p>
            ) : (
                <p className="text-xs text-slate-500">
                    Save as new plan adds a copy of your plan with the savings needed and the strategy
                    the amount assumes, so you can explore it year by year. Your current plan stays as it is.
                </p>
            ))}

            <div className="flex flex-wrap items-center gap-3">
                {canApply && (
                    <button
                        onClick={onApply}
                        disabled={applied}
                        className={applied ? savedBtn : primaryBtn}
                    >
                        {applied ? 'Applied ✓' : 'Apply to current plan'}
                    </button>
                )}
                {canSave && (
                    <button
                        onClick={onSave}
                        disabled={savedName !== null}
                        className={savedName !== null ? savedBtn : secondary}
                    >
                        {savedName !== null ? 'Saved ✓' : 'Save as new plan'}
                    </button>
                )}
                {canSavePerYear && (
                    <button
                        onClick={onSavePerYear}
                        disabled={savedPerYearName !== null}
                        className={savedPerYearName !== null ? savedBtn : secondary}
                    >
                        {savedPerYearName !== null ? 'Saved ✓' : 'Save the save-as-you-go plan'}
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

    // MaxSpendCard, EarliestAgeCard and SavingsNeededCard render `actions`
    // themselves, between their boxes — don't render them a second time at
    // view level.
    const actionsInCard = (result.objective === 'max-spend' && result.improved)
        || result.objective === 'earliest-age'
        || result.objective === 'savings-needed';

    return (
        <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-bold text-slate-900">
                RRSP Meltdown Optimizer
                <span className="ml-2 inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-bold align-middle">BETA</span>
            </h2>

            {/* Savings Needed first: its result must never reach the estate
                branches below (RecommendationCard's net-estate and tax tiles
                would read the change in savings as a gain from the strategy). */}
            {result.objective === 'savings-needed' ? (
                <SavingsNeededCard result={result} actions={actions} />
            ) : result.objective === 'earliest-age' ? (
                <EarliestAgeCard result={result} actions={actions} />
            ) : result.objective === 'max-spend' ? (
                result.improved ? (
                    <MaxSpendCard result={result} actions={actions} />
                ) : (
                    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-6">
                        <p className="text-base font-bold text-emerald-900">Your planned spending is about right</p>
                        <p className="mt-1.5 text-sm text-emerald-800">
                            Your current spending is about the most your savings can support at
                            the {result.maxSpend?.mcSuccessTarget}% target. Spending meaningfully
                            more would push the plan below it. The comparison below has the
                            details.
                        </p>
                    </div>
                )
            ) : result.improved ? (
                <RecommendationCard result={result} />
            ) : (
                <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-6">
                    <p className="text-base font-bold text-emerald-900">Your current plan already looks good</p>
                    <p className="mt-1.5 text-sm text-emerald-800">
                        We couldn't find changes that meaningfully increase your estate. Your
                        RRSP withdrawals, withdrawal order and CPP/OAS start ages are already
                        close to the best for leaving the largest estate. The comparison below
                        has the details.
                    </p>
                </div>
            )}

            {!actionsInCard && actions}

            {showComparison && (
                <>
                    {isSavings && (
                        <p className="text-sm text-slate-600 leading-relaxed">
                            The comparison below puts your plan as it is today next to the same plan{' '}
                            {savingsComparisonPhrase(result)}. Differences in what’s left at the end and in
                            tax come mostly from the different savings, not from a better strategy.
                        </p>
                    )}

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
                </>
            )}

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
                    Saved as "{dialogName}". You'll find it in your plan list on the
                    dashboard, and your current plan is untouched.
                </p>
            </Dialog>
        </div>
    );
}

function RecommendationCard({ result }: { result: MeltdownResult }) {
    // The estate search owns the household withdrawal order too, and applying
    // writes it — so it gets its own row here, exactly as in max-spend mode.
    // Without it a changed order would be applied to the user's plan silently.
    const currentStrategy = result.baselineInputs.withdrawalStrategy ?? 'tax-efficient';
    const suggestedStrategy = result.recommendedInputs.withdrawalStrategy ?? currentStrategy;
    const householdRows = [
        {
            label: 'Withdrawal order',
            current: strategyLabel(currentStrategy),
            suggested: strategyLabel(suggestedStrategy),
            changed: suggestedStrategy !== currentStrategy,
        },
    ];

    return (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900">{objectiveLabel(result.objective)}</h3>

            <div className="mt-4">
                <SimpleChangeTable title="Household" rows={householdRows} />
            </div>

            <div className="mt-6 space-y-6">
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
                    label="Total tax paid"
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
                        This plan leaves a larger estate, but it runs out of money in more market
                        scenarios than your current plan. Check the success rates below before
                        you apply or save it.
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

function DecisionTable({ decision: d, showLabel, suggestedLabel }: {
    decision: PersonMeltdownDecision;
    showLabel: boolean;
    suggestedLabel?: string;
}) {
    const currentMeltStart = meltStartCell(d.originalMeltAmount, d.originalMeltStartAge);
    const suggestedMeltStart = meltStartCell(d.meltAmount, d.meltStartAge);

    const rows: { label: string; current: string; suggested: string; changed: boolean; tooltip?: string }[] = [
        {
            label: 'RRSP melt amount',
            current: meltCell(d.originalMeltAmount),
            suggested: meltCell(d.meltAmount),
            changed: d.originalMeltAmount !== d.meltAmount,
        },
        {
            label: 'RRSP melt start age',
            tooltip: 'Not searched — the melt always begins at your retirement age and runs to 71. Change your retirement age to move it.',
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

    // `rows` is already SimpleChangeTable's row shape, and the markup below the
    // title was byte-identical to it — so this delegates rather than keeping a
    // second copy of the same table in sync by hand.
    return <SimpleChangeTable title={showLabel ? d.label : undefined} rows={rows} suggestedLabel={suggestedLabel} />;
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
// The settings each goal changes, shown under the goal cards for the chosen one.
const OBJECTIVE_CHANGES: Record<Objective, string> = {
    'estate': 'Changes your RRSP meltdown, CPP/OAS start ages and withdrawal order. Your spending stays the same.',
    'max-spend': 'Changes your RRSP meltdown, CPP/OAS start ages and withdrawal order, plus your yearly spending.',
    'earliest-age': 'Changes your retirement age, RRSP meltdown, CPP/OAS start ages and withdrawal order. Your spending stays the same.',
    'savings-needed': 'Changes your savings (keeping your mix of accounts), plus your RRSP meltdown, CPP/OAS start ages and withdrawal order, to show what it takes. Your retirement age and spending stay the same.',
};

// Two text levels only: title and one sentence. `note` is for a reason the
// card can't be chosen, which belongs on the card itself.
function ObjectiveCard({
    selected, onSelect, title, sub, note, disabled = false,
}: { selected: boolean; onSelect: () => void; title: string; sub: string; note?: string; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            disabled={disabled}
            className={`text-left rounded-xl border p-4 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                    ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                    : 'border-slate-200 bg-white hover:border-slate-300 disabled:hover:border-slate-200'
            }`}
        >
            <p className={`text-sm font-semibold ${selected ? 'text-brand-700' : 'text-slate-800'}`}>{title}</p>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">{sub}</p>
            {note && <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{note}</p>}
        </button>
    );
}

// Generic current-vs-suggested table (household spending/strategy rows).
// `suggestedLabel` renames the second column where "Suggested" would be wrong
// (Savings Needed's amount is a finding, not a suggestion).
function SimpleChangeTable({
    title, rows, suggestedLabel = 'Suggested',
}: {
    title?: string;
    rows: { label: string; current: string; suggested: string; changed: boolean; tooltip?: string }[];
    suggestedLabel?: string;
}) {
    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-slate-200">
                            {/* Household / You / Spouse sits in the header row's otherwise
                                empty first cell rather than on a line of its own above the
                                table. Same information, one row of vertical space instead
                                of two — and on a results screen that stacks a table per
                                person, that adds up. */}
                            <th className="text-left font-semibold text-slate-800 py-1.5 pr-4 whitespace-nowrap">
                                {title}
                            </th>
                            <th className="text-right font-medium text-slate-500 py-1.5 pl-4 whitespace-nowrap">
                                Current plan
                            </th>
                            <th className="text-right font-medium text-slate-500 py-1.5 pl-4 whitespace-nowrap">
                                {suggestedLabel}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={row.label} className="border-b border-slate-100 last:border-0">
                                <td className="text-left text-slate-500 py-1.5 pr-4">
                                    {row.tooltip ? (
                                        <HelpTooltip text={row.tooltip}>
                                            <span className="cursor-help border-b border-dashed border-slate-400">{row.label}</span>
                                        </HelpTooltip>
                                    ) : row.label}
                                </td>
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
 * Earliest-age result: the answer box (age, odds, what the strategy changed,
 * the bad-markets line, disclosures), the trade-off table, the actions, then
 * the strategy detail as the same current-vs-suggested tables the other modes
 * use. The answer box and table are shared components, so the landing page
 * shows the same thing. Unreachable / unavailable results stop after the
 * answer box — there is no age to tabulate or apply.
 */
function EarliestAgeCard({ result, actions }: { result: MeltdownResult; actions: React.ReactNode }) {
    const ea = result.earliestAge!;
    const found = ea.status === 'found';
    const currentStrategy = result.baselineInputs.withdrawalStrategy ?? 'tax-efficient';
    // Only when there is something to apply: at the plan's own age with a
    // strategy that already clears the bar, the search's different pick is a
    // preference, and "To get there: …" would contradict "nothing to apply".
    const strategyNote = found && result.improved
        ? describeStrategyChanges(result.decisions, currentStrategy, ea.withdrawalStrategy)
        : null;

    const named = ea.people.length > 1 || ea.reportedWho === 'spouse';
    const householdRows = [
        ...ea.people.map(p => ({
            label: named ? `Retirement age (${p.label})` : 'Retirement age',
            current: String(p.planRetirementAge),
            suggested: String(p.answerRetirementAge ?? p.planRetirementAge),
            changed: p.answerRetirementAge !== p.planRetirementAge,
        })),
        ...ea.people.map(p => ({
            label: named ? `CPP years (${p.label})` : 'CPP years',
            tooltip: 'Years you paid into CPP move with your retirement age (only years before 65 count). A CPP Calculator estimate doesn’t move with your retirement age.',
            current: String(p.planCppYears),
            suggested: String(p.answerCppYears ?? p.planCppYears),
            changed: p.answerCppYears !== p.planCppYears,
        })),
        {
            label: 'Withdrawal order',
            current: strategyLabel(currentStrategy),
            suggested: strategyLabel(ea.withdrawalStrategy),
            changed: ea.strategyChanged,
        },
    ];

    return (
        <div className="flex flex-col gap-6">
            <EarliestAgeHeadline result={ea} strategyNote={strategyNote} />

            {found && (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                    <h3 className="text-lg font-bold text-slate-900">Retiring earlier or later</h3>
                    <p className="mt-1 text-sm text-slate-500">
                        How your odds and the numbers change around your answer, at the same spending.
                    </p>
                    <div className="mt-4">
                        <EarliestAgeTable result={ea} />
                    </div>
                </div>
            )}

            {actions}

            {found && (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                    <h3 className="text-lg font-bold text-slate-900">{objectiveLabel(result.objective)}</h3>

                    <div className="mt-4">
                        <SimpleChangeTable title="Household" rows={householdRows} />
                    </div>

                    <div className="mt-6 space-y-6">
                        {result.decisions.map(d => (
                            <DecisionTable key={d.who} decision={d} showLabel={result.decisions.length > 1} />
                        ))}
                    </div>

                    <p className="mt-3 text-xs text-slate-500">
                        The melt runs each year from retirement until age 71 (RRIF conversion) or until the RRSP is empty.
                    </p>
                </div>
            )}
        </div>
    );
}

/*
 * Savings-needed result: the answer box and the table of nearby ages (both
 * shared with the landing page), the actions, then the detail behind the
 * amount as the same current-vs-answer tables the other modes use. There is no
 * Apply — balances are facts about the household, not settings — so the
 * tables' second column says what it holds rather than "Suggested". Results
 * with no amount that clears the bar skip the detail: there is no answer to
 * tabulate (the nearby ages still show when the solver estimated them).
 */
function SavingsNeededCard({ result, actions }: { result: MeltdownResult; actions: React.ReactNode }) {
    const sn = result.savingsNeeded!;
    const clears = savingsAnswerClears(sn);
    const column = 'With savings needed';
    const currentStrategy = result.baselineInputs.withdrawalStrategy ?? 'tax-efficient';
    const neededToday = roundCurrencyApprox(sn.neededSavings ?? 0);
    const householdRows = [
        {
            label: 'Savings today',
            current: formatCurrencyCAD(sn.currentSavings),
            suggested: formatCurrencyCAD(neededToday),
            changed: neededToday !== sn.currentSavings,
        },
        {
            label: 'Withdrawal order',
            current: strategyLabel(currentStrategy),
            suggested: strategyLabel(sn.withdrawalStrategy),
            changed: sn.strategyChanged,
        },
    ];

    return (
        <div className="flex flex-col gap-6">
            <SavingsNeededHeadline result={result} />

            {savingsAgeTableShown(sn) && (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                    <h3 className="text-lg font-bold text-slate-900">Retiring earlier or later</h3>
                    <p className="mt-1 text-sm text-slate-500">
                        How much you'd need at nearby ages, at the same spending.
                    </p>
                    <div className="mt-4">
                        <SavingsNeededTable result={sn} />
                    </div>
                </div>
            )}

            {actions}

            {clears && (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                    <h3 className="text-lg font-bold text-slate-900">{objectiveLabel(result.objective)}</h3>

                    <div className="mt-4">
                        <SimpleChangeTable title="Household" rows={householdRows} suggestedLabel={column} />
                    </div>

                    <div className="mt-6 space-y-6">
                        {result.decisions.map(d => (
                            <DecisionTable key={d.who} decision={d} showLabel={result.decisions.length > 1} suggestedLabel={column} />
                        ))}
                    </div>

                    <p className="mt-3 text-xs text-slate-500">
                        The melt runs each year from retirement until age 71 (RRIF conversion) or until the RRSP is empty.
                    </p>
                </div>
            )}
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
                        ? `We couldn’t find a spending level that meets your ${ms.mcSuccessTarget}% target`
                        : good
                            ? `You could spend ${sustainable}/yr — ${deltaAbs}/yr more than planned`
                            : `Your plan supports about ${sustainable}/yr — ${deltaAbs}/yr less than planned`}
                </p>
                <p className={`mt-1.5 text-sm ${good ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {!metTarget
                        ? `Even the lowest spending we tested, ${sustainable}/yr, only lasted in ${ms.achievedSuccessRate.toFixed(0)}% of market simulations. The spending that meets ${ms.mcSuccessTarget}% is lower than that. Run it again with a lower target to get a firm answer.`
                        : good
                            ? `That’s the most you can spend each year (the same amount, adjusted for inflation) while your money lasts in at least ${ms.mcSuccessTarget}% of market simulations.`
                            : `With a ${ms.mcSuccessTarget}% target, your savings can’t support your planned spending. Applying lowers your plan’s spending to the level they can support.`}
                </p>
                <p className={`mt-2 text-sm font-medium ${good ? 'text-emerald-800' : 'text-amber-800'}`}>
                    Monte Carlo success at this spending: {ms.achievedSuccessRate.toFixed(0)}%{' '}
                    {metTarget ? `(target ${ms.mcSuccessTarget}%)` : `— short of the ${ms.mcSuccessTarget}% target`}
                </p>
            </div>

            {actions}

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">{objectiveLabel(result.objective)}</h3>

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
                    This assumes you spend the same amount every year, adjusted for inflation.
                    Most retirees spend more in their early, active years and less later, so
                    this figure may be low for early retirement and high for later years.
                </p>
            </div>
        </div>
    );
}
