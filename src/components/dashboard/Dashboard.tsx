import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import LZString from 'lz-string';
import { usePersistentState } from '../../hooks/usePersistentState';
import { usePlans, uniquePlanName, DEFAULT_PLAN_NAME, PLANS_STORAGE_KEY, ACTIVE_PLAN_STORAGE_KEY } from '../../hooks/usePlans';
import type { SavedPlan } from '../../hooks/usePlans';
import { FinancialInput } from '../inputs/FinancialInput';
import { OneTimeSpendingInput } from '../inputs/OneTimeSpendingInput';
import { SettingsFields, ReturnsFields } from '../inputs/AssumptionsFields';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { Toggle } from '../ui/Toggle';
import { WealthChart } from '../charts/WealthChart';
import { SpendingChart } from '../charts/SpendingChart';
import { MonteCarloChart } from '../charts/MonteCarloChart';
import { SurplusChart } from '../charts/SurplusChart';
import { YearlyBreakdownTable } from '../tables/YearlyBreakdownTable';
import { YearAuditDrawer } from './YearAuditDrawer';
import { runSimulation, runMonteCarlo, blendedNonRegMix } from '../../engine/projection';
import type { SimulationInputs, SimulationResult, MonteCarloResult, NonRegisteredAccount, NonRegMix } from '../../engine/types';
import { createDefaultPerson, DEFAULT_SPEND, INITIAL_INPUTS, sanitizeSimulationInputs } from '../../utils/inputSanitizer';
import { SIM_KEY, hasSavedPlan } from '../../utils/onboarding';
import { formatCurrencyCAD } from '../../utils/formatters';
import { computeSummaryMetrics } from '../../utils/summaryMetrics';
import { SummaryHeader } from './SummaryHeader';
import { PersonSection } from './PersonSection';
import { PlanManager } from './PlanManager';
import { ComparisonView } from '../comparison/ComparisonView';
import { MeltdownOptimizerView } from '../optimizer/MeltdownOptimizerView';
import { applyMeltdownRecommendation } from '../../utils/meltdownOptimizer';

// Smallest 'Plan N' (N >= 2) whose name isn't already taken.
function nextPlanName(plans: SavedPlan[]): string {
    const taken = new Set(plans.map(p => p.name));
    let n = 2;
    while (taken.has(`Plan ${n}`)) n++;
    return `Plan ${n}`;
}

export function Dashboard() {
    const [inputs, setInputsRaw] = usePersistentState<SimulationInputs>(SIM_KEY, INITIAL_INPUTS, sanitizeSimulationInputs);
    const { plans, activePlanId, activePlan, createPlan, duplicatePlan, deletePlan, renamePlan, activatePlan, syncActiveInputs } = usePlans();
    const [isInflationAdjusted, setIsInflationAdjusted] = useState(false);
    const [isMonteCarlo, setIsMonteCarlo] = useState(false);
    const [isComparing, setIsComparing] = useState(false);
    // Year Audit drawer: an index into `simulationResults`, not a year — null when closed.
    const [selectedYearIndex, setSelectedYearIndex] = useState<number | null>(null);

    // Capture a deep-linked "open the meltdown optimizer" request via `?optimize=1`
    // ONCE, synchronously, at mount — mirroring the `setupRequested` capture in
    // App.tsx. This is how the /rrsp-withdrawal-strategy/ landing page's CTA
    // (`<a href="/?optimize=1">`) lands the visitor straight in the optimizer.
    // A #start= share link always wins: if the hash is a shared scenario we do
    // NOT open the optimizer (the mount effect below still needs to import it).
    // Either way the param is stripped immediately (preserving the hash) so that
    // a refresh — or the epoch-bump remount App performs after onboarding commits
    // — doesn't keep re-opening the optimizer.
    const [isOptimizing, setIsOptimizing] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const hadOptimizeParam = params.has('optimize');
        const requested = params.get('optimize') === '1' && !window.location.hash.startsWith('#start=');
        if (hadOptimizeParam) {
            window.history.replaceState(null, '', window.location.pathname + window.location.hash);
        }
        return requested;
    });

    // Whether a real (user-saved) plan exists, re-checked each time the optimizer
    // opens — a visitor who never edited anything is running on sample data, which
    // MeltdownOptimizerView warns about in its setup phase. hasSavedPlan() reads
    // localStorage directly (no reactive deps ESLint can see), so isOptimizing is
    // listed purely to force re-evaluation on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const optimizerHasRealPlan = useMemo(() => hasSavedPlan(), [isOptimizing]);

    // Every EDIT writes through to the active plan. Plan activation/loading uses
    // setInputsRaw directly — activating is not an edit and must not bump lastSaved.
    const updateInputs = (next: SimulationInputs) => {
        setInputsRaw(next);
        syncActiveInputs(next);
    };

    // Derived, not stored — keeps spouse UI in sync with every load path (hash, scenario, reset)
    const hasSpouse = !!inputs.spouse;

    // Hydrate from URL Hash on mount
    useEffect(() => {
        const hash = window.location.hash;
        if (hash.startsWith('#start=')) {
            try {
                const compressed = hash.replace('#start=', '');
                const json = LZString.decompressFromEncodedURIComponent(compressed);
                if (json) {
                    // Untrusted payload (often truncated by mail clients) — sanitize before
                    // applying, since setInputsRaw persists it to localStorage.
                    const clean = sanitizeSimulationInputs(JSON.parse(json));
                    if (clean) {
                        // Shared links land as a NEW plan instead of silently overwriting the
                        // active one. Deliberately NOT updateInputs: createPlan activates via a
                        // state update that hasn't committed yet, so syncActiveInputs in the same
                        // tick would write through to the PREVIOUS active plan.
                        createPlan('Shared plan', clean);
                        setInputsRaw(clean);
                    }
                }
            } catch (e) {
                console.error("Failed to hydrate from URL", e);
            }
            // Clear the hash either way so a reload doesn't keep overwriting user edits
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        // Run once on mount — setInputsRaw is a stable setter (see usePersistentState).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const simulationResults = useMemo(() => {
        return runSimulation(inputs);
    }, [inputs]);

    // The table/chart click handlers report a YEAR (not a row position — chart
    // payloads and table rows don't share an indexing guarantee), so this maps it
    // back to the matching index into `simulationResults` for the audit drawer.
    const handleSelectYear = useCallback((year: number) => {
        const idx = simulationResults.findIndex(r => r.year === year);
        if (idx !== -1) setSelectedYearIndex(idx);
    }, [simulationResults]);

    // One-line drift readout under each person's account list (only when at
    // least one of their accounts has rebalancing off). Start and end blend
    // only the drifting accounts, so selling or surplus shifting money between
    // accounts doesn't read as drift.
    const driftSummaries = useMemo(() => {
        const line = (
            accounts: NonRegisteredAccount[] | undefined,
            endMix: (r: SimulationResult) => NonRegMix | undefined,
            ageOf: (r: SimulationResult) => number | undefined
        ) => {
            if (!accounts) return null;
            const start = blendedNonRegMix(accounts.filter(a => a.rebalanceAnnually === false));
            if (!start) return null;
            // Last year this person still held accounts — they empty at death/rollover
            const last = [...simulationResults].reverse().find(r => endMix(r));
            if (!last) return null;
            const startEq = Math.round(start.capitalGain * 100);
            const endEq = Math.round(endMix(last)!.capitalGain * 100);
            if (startEq === endEq) return null;
            return `Mix drifts from ${startEq}% → ${endEq}% equity by age ${ageOf(last)}`;
        };
        return {
            person: line(inputs.person.nonRegisteredAccounts, r => r.nonRegDriftMix, r => r.age),
            spouse: line(inputs.spouse?.nonRegisteredAccounts, r => r.spouseNonRegDriftMix, r => r.spouseAge),
        };
    }, [inputs.person.nonRegisteredAccounts, inputs.spouse, simulationResults]);

    // Debounced Monte Carlo — waits 500ms after last input change before running
    const [monteCarloResults, setMonteCarloResults] = useState<MonteCarloResult | null>(null);
    const mcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!isMonteCarlo) return;

        // Clear any pending timer
        if (mcTimerRef.current) clearTimeout(mcTimerRef.current);

        mcTimerRef.current = setTimeout(() => {
            setMonteCarloResults(runMonteCarlo(inputs, 200));
        }, 500);

        return () => {
            if (mcTimerRef.current) clearTimeout(mcTimerRef.current);
        };
    }, [inputs, isMonteCarlo]);

    // Results are cleared the moment MC is switched off (see the Toggle's
    // onChange below) rather than in the effect above, so this is a plain
    // mirror of that state — never stale while isMonteCarlo is false.
    const displayedMonteCarloResults = isMonteCarlo ? monteCarloResults : null;

    const updatePersonField = (who: 'person' | 'spouse', field: string, value: number | object | undefined) => {
        const target = who === 'person' ? inputs.person : inputs.spouse;
        if (!target) return;
        updateInputs({ ...inputs, [who]: { ...target, [field]: value } });
    };

    const updateNestedAccount = (who: 'person' | 'spouse', account: 'rrsp' | 'tfsa', field: string, value: number) => {
        const target = who === 'person' ? inputs.person : inputs.spouse;
        if (!target) return;
        updateInputs({
            ...inputs,
            [who]: {
                ...target,
                [account]: {
                    ...target[account],
                    [field]: value
                }
            }
        });
    };

    const updateNonRegAccounts = (who: 'person' | 'spouse', accounts: NonRegisteredAccount[]) => {
        const target = who === 'person' ? inputs.person : inputs.spouse;
        if (!target) return;
        updateInputs({ ...inputs, [who]: { ...target, nonRegisteredAccounts: accounts } });
    };

    // Adding or removing a spouse also moves the household spending defaults
    // (see DEFAULT_SPEND) — but ONLY while they still sit at the other size's
    // default. Once the user has typed their own figure it is theirs to keep,
    // so a spouse toggle must never overwrite it.
    const toggleSpouse = () => {
        const from = hasSpouse ? DEFAULT_SPEND.couple : DEFAULT_SPEND.single;
        const to = hasSpouse ? DEFAULT_SPEND.single : DEFAULT_SPEND.couple;
        updateInputs({
            ...inputs,
            spouse: hasSpouse ? undefined : createDefaultPerson(true),
            preRetirementSpend: inputs.preRetirementSpend === from.pre ? to.pre : inputs.preRetirementSpend,
            postRetirementSpend: inputs.postRetirementSpend === from.post ? to.post : inputs.postRetirementSpend
        });
    };

    const loadPlanInputs = (p: SavedPlan) => setInputsRaw(sanitizeSimulationInputs(p.inputs) ?? INITIAL_INPUTS);

    const handleActivate = (id: string) => {
        if (id === activePlanId) return;
        const p = activatePlan(id);
        if (p) loadPlanInputs(p);
    };

    const handleRenameActive = (name: string) => {
        if (activePlanId) { renamePlan(activePlanId, name); return; }
        // Virtual plan: renaming materializes it. The clone below is load-bearing —
        // same-reference setState is dropped by React's Object.is bail-out and the
        // SIM_KEY persist effect would never fire, breaking the mirror invariant.
        createPlan(name, inputs);
        setInputsRaw({ ...inputs });
    };

    // Duplicate the active plan (or materialize-then-copy when still virtual).
    const handleDuplicateActive = () => {
        if (activePlanId) {
            const copy = duplicatePlan(activePlanId);
            if (copy) loadPlanInputs(copy);
            return;
        }
        // Virtual plan: materialize it first so the duplicate has a parent entry.
        const base = createPlan(DEFAULT_PLAN_NAME, inputs);
        setInputsRaw({ ...inputs }); // clone forces SIM_KEY persistence (see handleRenameActive)
        const copy = duplicatePlan(base.id);
        if (copy) loadPlanInputs(copy);
    };

    // "New Plan" = guided setup into a fresh plan: create a plan (named "Plan N")
    // seeded from default values (not the current plan), activate it, make sure
    // SIM_KEY is persisted, then relaunch the wizard via the existing ?setup=1
    // path so the user is walked through a clean slate. The wizard's Save commits
    // to SIM_KEY and reconciliation row 5 then updates this new plan. Skipping the
    // wizard leaves the plan at default values as-is (accepted trade-off).
    const handleNewPlanGuided = () => {
        const fresh = createPlan(nextPlanName(plans), INITIAL_INPUTS);
        setInputsRaw({ ...INITIAL_INPUTS });
        // usePersistentState/usePlans both persist via a plain `useEffect` (no
        // flushSync), and window.location.assign below unloads the page. Whether
        // a setTimeout(0) callback is guaranteed to run after those effects have
        // flushed is NOT something React's public API promises — in practice a
        // MessageChannel-scheduled passive-effect flush usually preempts a
        // same-tick setTimeout(0) (setTimeout carries timer overhead even at
        // delay 0), so the timer below is very likely safe, but "very likely" is
        // not good enough for a persisted write. Belt-and-braces: write the two
        // localStorage keys directly/synchronously here too, mirroring exactly
        // what the effects would write (see usePersistentState.ts / usePlans.ts).
        try {
            localStorage.setItem(SIM_KEY, JSON.stringify(INITIAL_INPUTS));
            localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify([...plans, fresh]));
            localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, fresh.id);
        } catch (e) {
            console.error('Failed to persist before guided setup navigation', e);
        }
        setTimeout(() => window.location.assign(window.location.pathname + '?setup=1'), 0);
    };

    const handleDelete = (id: string) => {
        const next = deletePlan(id);
        if (next) loadPlanInputs(next);
    };

    const metrics = useMemo(
        () => computeSummaryMetrics(simulationResults, inputs, isInflationAdjusted),
        // Deps intentionally list only the specific inputs.person fields this memo reads
        // (retirementAge, rrsp.balance, tfsa.balance, nonRegisteredAccounts — the latter is
        // all totalNonRegBalance() touches). Depending on the whole inputs.person object would
        // recompute on unrelated field changes (e.g. birth year, CPP start age) that don't
        // affect this result.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [simulationResults, inputs.person.retirementAge, inputs.province, isInflationAdjusted, inputs.person.rrsp.balance, inputs.person.tfsa.balance, inputs.person.nonRegisteredAccounts, inputs.spouse]
    );

    const globalMaxY = useMemo(() => {
        if (simulationResults.length === 0) return 0;
        return Math.max(...simulationResults.map(r => {
            const factor = isInflationAdjusted ? r.inflationFactor : 1.0;
            const inflow = r.netEmploymentIncome + r.netCPPIncome + r.netOASIncome + r.netPensionIncome + r.netInvestmentIncome +
                r.netRRSPWithdrawal + r.netTFSAWithdrawal + r.netNonRegWithdrawal;
            return inflow / factor;
        }));
    }, [simulationResults, isInflationAdjusted]);

    return (
        <div className="flex flex-col gap-6">
            {isComparing ? (
                <ComparisonView
                    plans={plans}
                    activePlanId={activePlanId}
                    liveInputs={inputs}
                    isInflationAdjusted={isInflationAdjusted}
                    onToggleInflation={setIsInflationAdjusted}
                    onExit={() => setIsComparing(false)}
                />
            ) : isOptimizing ? (
                <MeltdownOptimizerView
                    liveInputs={inputs}
                    hasRealPlan={optimizerHasRealPlan}
                    activePlanName={activePlan?.name ?? DEFAULT_PLAN_NAME}
                    isInflationAdjusted={isInflationAdjusted}
                    onToggleInflation={setIsInflationAdjusted}
                    onExit={() => setIsOptimizing(false)}
                    onSavePlan={(name, planInputs) => {
                        const uniqueName = uniquePlanName(name, plans.map(p => p.name));
                        createPlan(uniqueName, planInputs, false);
                        return uniqueName;
                    }}
                    onApply={(rec, objective) => updateInputs(applyMeltdownRecommendation(inputs, rec, objective))}
                />
            ) : (
                <>
            <SummaryHeader metrics={metrics} monteCarlo={displayedMonteCarloResults} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Sidebar / Inputs */}
                <div className="lg:col-span-4 space-y-6">

                    {/* Plans — the context for every input below, so it leads the column */}
                    <PlanManager
                        plans={plans}
                        activePlanId={activePlanId}
                        activePlanName={activePlan?.name ?? DEFAULT_PLAN_NAME}
                        activeLastSaved={activePlan?.lastSaved ?? null}
                        currentInputs={inputs}
                        onRenameActive={handleRenameActive}
                        onDuplicateActive={handleDuplicateActive}
                        onNewPlanGuided={handleNewPlanGuided}
                        onActivate={handleActivate}
                        onDelete={handleDelete}
                        onCompare={() => setIsComparing(true)}
                        onOptimize={() => setIsOptimizing(true)}
                    />

                    {/* Person 1 Profile */}
                    <PersonSection
                        title="You"
                        person={inputs.person}
                        onChange={(field, val) => updatePersonField('person', field, val)}
                        onAccountChange={(acct, field, val) => updateNestedAccount('person', acct, field, val)}
                        onNonRegChange={(accounts) => updateNonRegAccounts('person', accounts)}
                        nonRegDriftSummary={driftSummaries.person}
                        colorTheme="blue"
                        onOpenOptimizer={() => setIsOptimizing(true)}
                    />

                    {/* Spouse Toggle & Profile */}
                    {hasSpouse && inputs.spouse ? (
                        <PersonSection
                            title="Spouse"
                            person={inputs.spouse}
                            onChange={(field, val) => updatePersonField('spouse', field, val)}
                            onAccountChange={(acct, field, val) => updateNestedAccount('spouse', acct, field, val)}
                            onNonRegChange={(accounts) => updateNonRegAccounts('spouse', accounts)}
                            nonRegDriftSummary={driftSummaries.spouse}
                            showRemove
                            onRemove={toggleSpouse}
                            colorTheme="purple"
                            onOpenOptimizer={() => setIsOptimizing(true)}
                        />
                    ) : (
                        <button
                            onClick={toggleSpouse}
                            className="w-full rounded-2xl p-6 border-2 border-dashed border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition-all group flex flex-col items-center gap-2 text-slate-500 hover:text-brand-600"
                        >
                            <div className="w-10 h-10 rounded-full border-2 border-dashed border-current flex items-center justify-center group-hover:scale-110 transition-transform">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </div>
                            <span className="text-sm font-medium">Add Spouse</span>
                            <span className="text-xs opacity-70">Include a spouse's accounts and CPP/OAS in the simulation</span>
                        </button>
                    )}

                    {/* Household Spending */}
                    <CollapsibleSection title="Household Spending" accent="teal">
                        <div className="grid grid-cols-2 gap-4">
                            <FinancialInput
                                label="Pre-Retirement"
                                value={inputs.preRetirementSpend}
                                onChange={(e) => updateInputs({ ...inputs, preRetirementSpend: Number(e.target.value) })}
                            />
                            <FinancialInput
                                label="Post-Retirement"
                                value={inputs.postRetirementSpend}
                                onChange={(e) => updateInputs({ ...inputs, postRetirementSpend: Number(e.target.value) })}
                            />
                        </div>

                        <div className="pt-2 border-t border-emerald-200/50 mt-4">
                            <OneTimeSpendingInput
                                expenses={inputs.oneTimeExpenses || []}
                                onChange={(expenses) => updateInputs({ ...inputs, oneTimeExpenses: expenses })}
                            />
                        </div>
                    </CollapsibleSection>

                    {/* Settings */}
                    <CollapsibleSection title="Settings" accent="slate" defaultOpen={false}>
                        <div className="space-y-4">
                            <SettingsFields
                                inputs={inputs}
                                onChange={(p) => updateInputs({ ...inputs, ...p })}
                            />

                            <Toggle
                                checked={isInflationAdjusted}
                                onChange={setIsInflationAdjusted}
                                label="Show Today's Dollars (Inflation-Adjusted)"
                            />
                        </div>
                    </CollapsibleSection>

                    {/* Rates of Return */}
                    <CollapsibleSection title="Rates of Return" accent="slate" defaultOpen={false}>
                        <ReturnsFields
                            inputs={inputs}
                            onChange={(p) => updateInputs({ ...inputs, ...p })}
                        />
                    </CollapsibleSection>

                    {/* Monte Carlo */}
                    <CollapsibleSection title="Monte Carlo" accent="indigo" defaultOpen={false}>
                        <div className="space-y-3">
                            <Toggle
                                checked={isMonteCarlo}
                                onChange={(checked) => {
                                    setIsMonteCarlo(checked);
                                    if (!checked) setMonteCarloResults(null);
                                }}
                                label="Monte Carlo Simulation"
                                badge={<span className="bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0.5 rounded font-bold">BETA</span>}
                            />

                            {isMonteCarlo && (
                                <div className="bg-indigo-50/50 p-3 rounded-lg space-y-2 border border-indigo-100">
                                    <FinancialInput
                                        label="Volatility (Risk)"
                                        prefix="%"
                                        minFractionDigits={1}
                                        maxFractionDigits={1}
                                        value={Number(((inputs.returnRates.volatility || 0.10) * 100).toFixed(1))}
                                        onChange={(e) => updateInputs({
                                            ...inputs,
                                            returnRates: { ...inputs.returnRates, volatility: Number(e.target.value) / 100 }
                                        })}
                                        tooltip="How much returns swing from year to year (standard deviation) — roughly 15% for all-stock portfolios, 10% for a balanced 60/40 mix, 5% for bond-heavy."
                                    />
                                </div>
                            )}
                        </div>
                    </CollapsibleSection>
                </div>

                {/* Main Content / Charts */}
                <div className="lg:col-span-8 space-y-6">
                    {metrics.outOfMoneyAge && (
                        <div className="rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-4 flex items-start gap-4">
                            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center">
                                <svg className="w-5 h-5 text-red-600" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-red-900">Projected Shortfall at Age {metrics.outOfMoneyAge}</p>
                                <p className="text-sm text-red-700 mt-0.5">
                                    Spending can no longer be funded from income and accounts — {formatCurrencyCAD(metrics.totalShortfall)} of planned spending
                                    goes unfunded over the plan. Consider reducing post-retirement spending or increasing savings.
                                </p>
                            </div>
                        </div>
                    )}
                    <WealthChart
                        data={simulationResults}
                        hasSpouse={hasSpouse}
                        inflationAdjusted={isInflationAdjusted}
                    />
                    <SpendingChart
                        data={simulationResults}
                        inflationAdjusted={isInflationAdjusted}
                        domainMax={globalMaxY}
                        onSelectYear={handleSelectYear}
                    />
                    <SurplusChart
                        data={simulationResults}
                        inflationAdjusted={isInflationAdjusted}
                        domainMax={globalMaxY}
                    />

                    {displayedMonteCarloResults && (
                        <MonteCarloChart
                            data={simulationResults}
                            monteCarlo={displayedMonteCarloResults}
                            inflationAdjusted={isInflationAdjusted}
                        />
                    )}

                    <YearlyBreakdownTable
                        data={simulationResults}
                        hasSpouse={hasSpouse}
                        showMixDrift={
                            inputs.person.nonRegisteredAccounts.some(a => a.rebalanceAnnually === false) ||
                            !!inputs.spouse?.nonRegisteredAccounts.some(a => a.rebalanceAnnually === false)
                        }
                        onSelectYear={handleSelectYear}
                    />
                </div>
            </div>
                </>
            )}

            {/* Year Audit drawer — an overlay, not a content swap, so edits behind it
                keep working. Guarded against a stale index: an input edit while the
                drawer is open re-runs the simulation and can shrink the array. */}
            {selectedYearIndex !== null && selectedYearIndex < simulationResults.length && (
                <YearAuditDrawer
                    inputs={inputs}
                    results={simulationResults}
                    index={selectedYearIndex}
                    inflationAdjusted={isInflationAdjusted}
                    hasSpouse={hasSpouse}
                    onClose={() => setSelectedYearIndex(null)}
                    onNavigate={setSelectedYearIndex}
                />
            )}
        </div>
    );
}
