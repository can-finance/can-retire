import { useMemo, useState, useEffect, useRef } from 'react';
import LZString from 'lz-string';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useScenarios } from '../../hooks/useScenarios';
import type { SavedScenario } from '../../hooks/useScenarios';
import { FinancialInput } from '../inputs/FinancialInput';
import { OneTimeSpendingInput } from '../inputs/OneTimeSpendingInput';
import { AssumptionsFields } from '../inputs/AssumptionsFields';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { Toggle } from '../ui/Toggle';
import { WealthChart } from '../charts/WealthChart';
import { SpendingChart } from '../charts/SpendingChart';
import { MonteCarloChart } from '../charts/MonteCarloChart';
import { SurplusChart } from '../charts/SurplusChart';
import { YearlyBreakdownTable } from '../tables/YearlyBreakdownTable';
import { runSimulation, runMonteCarlo, blendedNonRegMix, totalNonRegBalance } from '../../engine/projection';
import type { SimulationInputs, SimulationResult, MonteCarloResult, NonRegisteredAccount, NonRegMix } from '../../engine/types';
import { createDefaultPerson, INITIAL_INPUTS, sanitizeSimulationInputs } from '../../utils/inputSanitizer';
import { SIM_KEY } from '../../utils/onboarding';
import { formatCurrencyCAD } from '../../utils/formatters';
import { SummaryHeader } from './SummaryHeader';
import { PersonSection } from './PersonSection';
import { ScenarioManager } from './ScenarioManager';

export function Dashboard() {
    const [inputs, setInputs] = usePersistentState<SimulationInputs>(SIM_KEY, INITIAL_INPUTS, sanitizeSimulationInputs);
    const { scenarios, saveScenario, updateScenario, deleteScenario } = useScenarios();
    const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
    const [isInflationAdjusted, setIsInflationAdjusted] = useState(false);
    const [isMonteCarlo, setIsMonteCarlo] = useState(false);

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
                    // applying, since setInputs persists it to localStorage.
                    const clean = sanitizeSimulationInputs(JSON.parse(json));
                    if (clean) {
                        setInputs(clean);
                    }
                }
            } catch (e) {
                console.error("Failed to hydrate from URL", e);
            }
            // Clear the hash either way so a reload doesn't keep overwriting user edits
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }, []); // Run once on mount

    const simulationResults = useMemo(() => {
        return runSimulation(inputs);
    }, [inputs]);

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
        if (!isMonteCarlo) {
            setMonteCarloResults(null);
            return;
        }

        // Clear any pending timer
        if (mcTimerRef.current) clearTimeout(mcTimerRef.current);

        mcTimerRef.current = setTimeout(() => {
            setMonteCarloResults(runMonteCarlo(inputs, 200));
        }, 500);

        return () => {
            if (mcTimerRef.current) clearTimeout(mcTimerRef.current);
        };
    }, [inputs, isMonteCarlo]);

    const updatePersonField = (who: 'person' | 'spouse', field: string, value: number | object | undefined) => {
        const target = who === 'person' ? inputs.person : inputs.spouse;
        if (!target) return;
        setInputs({ ...inputs, [who]: { ...target, [field]: value } });
    };

    const updateNestedAccount = (who: 'person' | 'spouse', account: 'rrsp' | 'tfsa', field: string, value: number) => {
        const target = who === 'person' ? inputs.person : inputs.spouse;
        if (!target) return;
        setInputs({
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
        setInputs({ ...inputs, [who]: { ...target, nonRegisteredAccounts: accounts } });
    };

    const toggleSpouse = () => {
        setInputs({ ...inputs, spouse: hasSpouse ? undefined : createDefaultPerson(true) });
    };

    const handleSaveScenario = (name: string) => {
        saveScenario(name, inputs);
    };

    const loadScenario = (savedScenario: SavedScenario) => {
        // Saved scenarios may predate schema changes — sanitize on the way in
        setInputs(sanitizeSimulationInputs(savedScenario.inputs) ?? INITIAL_INPUTS);
        setActiveScenarioId(savedScenario.id);
    };

    const handleUpdateScenario = (newName?: string) => {
        if (activeScenarioId) {
            updateScenario(activeScenarioId, inputs, newName);
        }
    };

    const handleCreateNew = () => {
        setInputs(INITIAL_INPUTS);
        setActiveScenarioId(null);
    };

    const metrics = useMemo(() => {
        // Guard: Return default metrics if no simulation results
        if (simulationResults.length === 0) {
            return {
                estate: 0,
                estateTax: 0,
                annualTaxRetirement: 0,
                effectiveTaxRateRetirement: 0,
                effectiveTaxRateEstate: 0,
                totalEffectiveTaxRate: 0,
                totalTaxPlusEstate: 0,
                totalRetirementIncome: 0,
                netRetirementIncome: 0,
                netEstateValue: 0,
                totalNetValue: 0,
                initialWithdrawalRate: 0,
                outOfMoneyAge: null as number | null,
                totalShortfall: 0
            };
        }

        const lastYear = simulationResults[simulationResults.length - 1];
        const retirementResults = simulationResults.filter(r => r.age >= inputs.person.retirementAge);

        // Inflation adjustment helper
        const adj = (val: number, factor: number) => isInflationAdjusted ? val / factor : val;

        const annualTaxRetirement = retirementResults.reduce((acc, curr) => acc + adj(curr.taxPaid, curr.inflationFactor), 0);
        const totalRetirementIncome = retirementResults.reduce((acc, curr) => acc + adj(curr.grossIncome, curr.inflationFactor), 0);

        // Terminal tax is now calculated by the engine and includes:
        // - Deemed disposition of RRSP/RRIF at death (if no surviving spouse)
        // - Capital gains on unrealized Non-Reg gains at death
        // - Proper spouse rollover logic (tax-free transfer if spouse survives)
        const estateTax = lastYear.totalTerminalTax || 0;

        // Convert final estate values to real dollars if needed
        const estateValue = adj(lastYear.grossEstateValue || lastYear.totalAssets, lastYear.inflationFactor);
        const adjustedEstateTax = adj(estateTax, lastYear.inflationFactor);

        const totalTaxPlusEstate = annualTaxRetirement + adjustedEstateTax;

        const effectiveTaxRateRetirement = totalRetirementIncome > 0 ? (annualTaxRetirement / totalRetirementIncome) * 100 : 0;
        // A shortfall year is one where the engine could not fund target spending
        const firstShortfallYear = simulationResults.find(r => r.shortfall > 1);
        const outOfMoneyAge = firstShortfallYear ? firstShortfallYear.age : null;
        const totalShortfall = simulationResults.reduce((acc, curr) => acc + adj(curr.shortfall, curr.inflationFactor), 0);

        const effectiveTaxRateEstate = estateValue > 0 ? (adjustedEstateTax / estateValue) * 100 : 0;
        const totalEffectiveTaxRate = (totalRetirementIncome + estateValue) > 0 ? (totalTaxPlusEstate / (totalRetirementIncome + estateValue)) * 100 : 0;

        // Withdrawal Rate Calculation
        let initialWithdrawalRate = 0;
        const retirementIndex = simulationResults.findIndex(r => r.age === inputs.person.retirementAge);

        // If retirementIndex > 0, use that year for withdrawals with previous year's assets as base.
        // Otherwise (already retired), use input balances as starting assets.
        if (retirementIndex > 0) {
            const firstRetYear = simulationResults[retirementIndex];
            const prevYear = simulationResults[retirementIndex - 1];
            const totalWithdrawal = firstRetYear.totalRRSPWithdrawal + firstRetYear.totalTFSAWithdrawal + firstRetYear.totalNonRegWithdrawal;
            if (prevYear.totalAssets > 0) {
                initialWithdrawalRate = (totalWithdrawal / prevYear.totalAssets) * 100;
            }
        } else {
            const firstRetYear = simulationResults[0];
            const personNonReg = totalNonRegBalance(inputs.person);
            const spouseNonReg = inputs.spouse ? totalNonRegBalance(inputs.spouse) : 0;
            const startAssets =
                inputs.person.rrsp.balance +
                inputs.person.tfsa.balance +
                personNonReg +
                (inputs.spouse ? (inputs.spouse.rrsp.balance + inputs.spouse.tfsa.balance + spouseNonReg) : 0);

            if (firstRetYear && startAssets > 0) {
                const totalWithdrawal = firstRetYear.totalRRSPWithdrawal + firstRetYear.totalTFSAWithdrawal + firstRetYear.totalNonRegWithdrawal;
                initialWithdrawalRate = (totalWithdrawal / startAssets) * 100;
            }
        }

        const netRetirementIncome = totalRetirementIncome - annualTaxRetirement;
        const netEstateValue = estateValue - adjustedEstateTax;
        const totalNetValue = netRetirementIncome + netEstateValue;

        return {
            estate: estateValue,
            annualTaxRetirement,
            estateTax: adjustedEstateTax,
            totalTaxPlusEstate,
            effectiveTaxRateRetirement,
            effectiveTaxRateEstate,
            totalEffectiveTaxRate,
            totalRetirementIncome,
            netRetirementIncome,
            netEstateValue,
            totalNetValue,
            outOfMoneyAge,
            initialWithdrawalRate,
            totalShortfall
        };
    }, [simulationResults, inputs.person.retirementAge, inputs.province, isInflationAdjusted, inputs.person.rrsp.balance, inputs.person.tfsa.balance, inputs.person.nonRegisteredAccounts, inputs.spouse]);

    const globalMaxY = useMemo(() => {
        if (simulationResults.length === 0) return 0;
        return Math.max(...simulationResults.map(r => {
            const factor = isInflationAdjusted ? r.inflationFactor : 1.0;
            const inflow = r.netEmploymentIncome + r.netCPPIncome + r.netOASIncome + r.netInvestmentIncome +
                r.netRRSPWithdrawal + r.netTFSAWithdrawal + r.netNonRegWithdrawal;
            return inflow / factor;
        }));
    }, [simulationResults, isInflationAdjusted]);

    return (
        <div className="flex flex-col gap-6">
            <SummaryHeader metrics={metrics} monteCarlo={monteCarloResults} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Sidebar / Inputs */}
                <div className="lg:col-span-4 space-y-6">

                    {/* Person 1 Profile */}
                    <PersonSection
                        title="You"
                        person={inputs.person}
                        onChange={(field, val) => updatePersonField('person', field, val)}
                        onAccountChange={(acct, field, val) => updateNestedAccount('person', acct, field, val)}
                        onNonRegChange={(accounts) => updateNonRegAccounts('person', accounts)}
                        nonRegDriftSummary={driftSummaries.person}
                        colorTheme="blue"
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
                        />
                    ) : (
                        <button
                            onClick={toggleSpouse}
                            className="w-full rounded-2xl p-6 border-2 border-dashed border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition-all group flex flex-col items-center gap-2 text-slate-400 hover:text-brand-500"
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
                                onChange={(e) => setInputs({ ...inputs, preRetirementSpend: Number(e.target.value) })}
                            />
                            <FinancialInput
                                label="Post-Retirement"
                                value={inputs.postRetirementSpend}
                                onChange={(e) => setInputs({ ...inputs, postRetirementSpend: Number(e.target.value) })}
                            />
                        </div>

                        <div className="pt-2 border-t border-emerald-200/50 mt-4">
                            <OneTimeSpendingInput
                                expenses={inputs.oneTimeExpenses || []}
                                onChange={(expenses) => setInputs({ ...inputs, oneTimeExpenses: expenses })}
                            />
                        </div>
                    </CollapsibleSection>

                    {/* Assumptions */}
                    <CollapsibleSection title="Assumptions" accent="slate" defaultOpen={false}>
                        <div className="space-y-4">
                            <AssumptionsFields
                                inputs={inputs}
                                onChange={(p) => setInputs({ ...inputs, ...p })}
                            />

                            {/* Monte Carlo Toggle & Volatility (view-only toggle — stays local) */}
                            <div className="space-y-3">
                                <Toggle
                                    checked={isMonteCarlo}
                                    onChange={setIsMonteCarlo}
                                    label="Monte Carlo Simulation"
                                    badge={<span className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded font-bold">BETA</span>}
                                />

                                {isMonteCarlo && (
                                    <div className="bg-indigo-50/50 p-3 rounded-lg space-y-2 border border-indigo-100">
                                        <FinancialInput
                                            label="Volatility (Risk)"
                                            prefix="%"
                                            minFractionDigits={1}
                                            maxFractionDigits={1}
                                            value={Number(((inputs.returnRates.volatility || 0.10) * 100).toFixed(1))}
                                            onChange={(e) => setInputs({
                                                ...inputs,
                                                returnRates: { ...inputs.returnRates, volatility: Number(e.target.value) / 100 }
                                            })}
                                            tooltip="Standard deviation of annual returns (e.g. 10% for equities)."
                                        />
                                    </div>
                                )}
                            </div>

                            <Toggle
                                checked={isInflationAdjusted}
                                onChange={setIsInflationAdjusted}
                                label="Show Real Dollars (Inflation Adjusted)"
                            />
                        </div>
                    </CollapsibleSection>

                    {/* Saved Scenarios */}
                    <ScenarioManager
                        scenarios={scenarios}
                        activeScenarioId={activeScenarioId}
                        currentInputs={inputs}
                        onSave={handleSaveScenario}
                        onUpdate={handleUpdateScenario}
                        onLoad={loadScenario}
                        onDelete={deleteScenario}
                        onCreateNew={handleCreateNew}
                    />
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
                    />
                    <SurplusChart
                        data={simulationResults}
                        inflationAdjusted={isInflationAdjusted}
                        domainMax={globalMaxY}
                    />

                    {isMonteCarlo && monteCarloResults && (
                        <MonteCarloChart
                            data={simulationResults}
                            monteCarlo={monteCarloResults}
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
                    />
                </div>
            </div>
        </div>
    );
}
