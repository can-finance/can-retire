import { useMemo, useState, useEffect } from 'react';
import LZString from 'lz-string';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useScenarios } from '../../hooks/useScenarios';
import type { SavedScenario } from '../../hooks/useScenarios';
import { FinancialInput } from '../inputs/FinancialInput';
import { AssetMixInput } from '../inputs/AssetMixInput';
import { OneTimeSpendingInput } from '../inputs/OneTimeSpendingInput';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { WealthChart } from '../charts/WealthChart';
import { SpendingChart } from '../charts/SpendingChart';
import { MonteCarloChart } from '../charts/MonteCarloChart';
import { SurplusChart } from '../charts/SurplusChart';
import { YearlyBreakdownTable } from '../tables/YearlyBreakdownTable';
import { runSimulation, runMonteCarlo } from '../../engine/projection';
import { AccountTypeVals } from '../../engine/types';
import type { Person, SimulationInputs, NonRegisteredAccount } from '../../engine/types';
import { calculateIncomeTax } from '../../engine/tax';
import { SummaryHeader } from './SummaryHeader';
import { PersonSection } from './PersonSection';
import { ScenarioManager } from './ScenarioManager';

const createDefaultPerson = (isSpouse = false): Person => ({
    age: isSpouse ? 45 : 48,
    retirementAge: 60,
    lifeExpectancy: 90,
    currentIncome: isSpouse ? 50000 : 85000,
    cppStartAge: 65,
    cppContributedYears: 35,
    oasStartAge: 65,
    rrspMeltStartAge: 55,
    rrspMeltAmount: isSpouse ? 10000 : 20000,
    rrsp: { type: AccountTypeVals.RRSP, balance: isSpouse ? 300000 : 500000 },
    tfsa: { type: AccountTypeVals.TFSA, balance: isSpouse ? 100000 : 150000 },
    nonRegistered: {
        type: 'NonRegistered',
        balance: isSpouse ? 100000 : 200000,
        adjustedCostBase: isSpouse ? 50000 : 100000,
        assetMix: { interest: 0.1, dividend: 0.3, capitalGain: 0.6 }
    } as NonRegisteredAccount
});

const INITIAL_INPUTS: SimulationInputs = {
    person: createDefaultPerson(),
    spouse: undefined,
    province: 'ON',
    inflationRate: 0.025,
    preRetirementSpend: 60000,
    postRetirementSpend: 55000,
    oneTimeExpenses: [],
    withdrawalStrategy: 'rrsp-first',
    useIncomeSplitting: true,
    returnRates: {
        interest: 0.02,
        dividend: 0.03,
        capitalGrowth: 0.05,
        volatility: 0.10
    }
};

export function Dashboard() {
    const [inputs, setInputs] = usePersistentState<SimulationInputs>('retirement_sim_v2', INITIAL_INPUTS);
    const { scenarios, saveScenario, updateScenario, deleteScenario } = useScenarios();
    const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
    const [hasSpouse, setHasSpouse] = useState(!!inputs.spouse);
    const [isInflationAdjusted, setIsInflationAdjusted] = useState(false);
    const [isMonteCarlo, setIsMonteCarlo] = useState(false);

    // Hydrate from URL Hash on mount
    useEffect(() => {
        const hash = window.location.hash;
        if (hash.startsWith('#start=')) {
            try {
                const compressed = hash.replace('#start=', '');
                const json = LZString.decompressFromEncodedURIComponent(compressed);
                if (json) {
                    const parsed = JSON.parse(json);
                    if (parsed && parsed.person) {
                        setInputs(parsed);
                    }
                }
            } catch (e) {
                console.error("Failed to hydrate from URL", e);
            }
        }
    }, []); // Run once on mount

    const simulationResults = useMemo(() => {
        return runSimulation(inputs);
    }, [inputs]);

    const monteCarloResults = useMemo(() => {
        if (!isMonteCarlo) return null;
        return runMonteCarlo(inputs, 250); // 250 iterations for responsiveness
    }, [inputs, isMonteCarlo]);

    const updatePerson = (field: string, value: number | object) => {
        setInputs({
            ...inputs,
            person: {
                ...inputs.person,
                [field]: value
            }
        });
    };

    const updateSpouse = (field: string, value: number | object) => {
        if (!inputs.spouse) return;
        setInputs({
            ...inputs,
            spouse: {
                ...inputs.spouse,
                [field]: value
            }
        });
    };

    const updateNestedAccount = (who: 'person' | 'spouse', account: 'rrsp' | 'tfsa' | 'nonRegistered', field: string, value: number) => {
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

    const toggleSpouse = () => {
        if (hasSpouse) {
            setHasSpouse(false);
            setInputs({ ...inputs, spouse: undefined });
        } else {
            setHasSpouse(true);
            setInputs({ ...inputs, spouse: createDefaultPerson(true) });
        }
    };

    const handleSaveScenario = (name: string) => {
        saveScenario(name, inputs);
    };

    const loadScenario = (savedScenario: SavedScenario) => {
        setInputs(savedScenario.inputs);
        setHasSpouse(!!savedScenario.inputs.spouse);
        setActiveScenarioId(savedScenario.id);
    };

    const handleUpdateScenario = () => {
        if (activeScenarioId) {
            updateScenario(activeScenarioId, inputs);
        }
    };

    const handleCreateNew = () => {
        setInputs(INITIAL_INPUTS);
        setHasSpouse(!!INITIAL_INPUTS.spouse);
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
                outOfMoneyAge: null
            };
        }

        const lastYear = simulationResults[simulationResults.length - 1];
        const retirementResults = simulationResults.filter(r => r.age >= inputs.person.retirementAge);

        // Inflation adjustment helper
        const adj = (val: number, factor: number) => isInflationAdjusted ? val / factor : val;

        const annualTaxRetirement = retirementResults.reduce((acc, curr) => acc + adj(curr.taxPaid, curr.inflationFactor), 0);
        const totalRetirementIncome = retirementResults.reduce((acc, curr) => acc + adj(curr.grossIncome, curr.inflationFactor), 0);

        // Terminal income is calculated at the end (death), so use lastYear's factor
        const rawTerminalIncome =
            lastYear.accounts.rrsp +
            (lastYear.spouseAccounts?.rrsp || 0) +
            (Math.max(0, lastYear.accounts.nonRegistered - lastYear.accounts.nonRegisteredACB) * 0.5) +
            (lastYear.spouseAccounts ? Math.max(0, lastYear.spouseAccounts.nonRegistered - lastYear.spouseAccounts.spouseNonRegisteredACB) * 0.5 : 0);

        const estateTax = calculateIncomeTax(rawTerminalIncome, inputs.province); // Tax is calculated on nominal amount

        // Convert final estate values to real dollars if needed
        const estateValue = adj(lastYear.totalAssets, lastYear.inflationFactor);
        const adjustedEstateTax = adj(estateTax, lastYear.inflationFactor);

        const totalTaxPlusEstate = annualTaxRetirement + adjustedEstateTax;

        const effectiveTaxRateRetirement = totalRetirementIncome > 0 ? (annualTaxRetirement / totalRetirementIncome) * 100 : 0;
        const outOfMoneyYear = simulationResults.find(r => r.totalAssets < 1000 && r.age >= inputs.person.retirementAge);
        const outOfMoneyAge = outOfMoneyYear ? outOfMoneyYear.age : null;

        const effectiveTaxRateEstate = estateValue > 0 ? (adjustedEstateTax / estateValue) * 100 : 0;
        const totalEffectiveTaxRate = (totalRetirementIncome + estateValue) > 0 ? (totalTaxPlusEstate / (totalRetirementIncome + estateValue)) * 100 : 0;

        // Withdrawal Rate Calculation
        let initialWithdrawalRate = 0;
        const retirementIndex = simulationResults.findIndex(r => r.age === inputs.person.retirementAge);

        // Determine the "First Year of Retirement" logic
        // If retirementIndex is -1 (started after retirement) or 0 (starting now), we use index 0 and Initial Inputs for assets
        // If retirementIndex > 0, we use that year for withdrawals, and the previous year's End Assets as the base

        if (retirementIndex > 0) {
            const firstRetYear = simulationResults[retirementIndex];
            const prevYear = simulationResults[retirementIndex - 1];
            const totalWithdrawal = firstRetYear.totalRRSPWithdrawal + firstRetYear.totalTFSAWithdrawal + firstRetYear.totalNonRegWithdrawal;
            // Use previous year's ending assets as the 'start of year' assets for the calculation
            // Adjust for inflation if needed? The rate is ratio, so if both nominal ok.
            // If inflation adjusted, both typically adjusted.
            // Let's use raw nominal for ratio to be safe, or both real. 
            // SimulationResults are nominal.
            if (prevYear.totalAssets > 0) {
                initialWithdrawalRate = (totalWithdrawal / prevYear.totalAssets) * 100;
            }
        } else {
            // Already retired or retiring immediately. Use inputs for initial assets.
            const firstRetYear = simulationResults[0];
            const startAssets =
                inputs.person.rrsp.balance +
                inputs.person.tfsa.balance +
                (inputs.person.nonRegistered.balance) +
                (inputs.spouse ? (inputs.spouse.rrsp.balance + inputs.spouse.tfsa.balance + inputs.spouse.nonRegistered.balance) : 0);

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
            initialWithdrawalRate
        };
    }, [simulationResults, inputs.person.retirementAge, inputs.province, isInflationAdjusted, inputs.person.rrsp.balance, inputs.person.tfsa.balance, inputs.person.nonRegistered.balance, inputs.spouse]);

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
                    {/* ... existing sidebar ... */}

                    {/* Person 1 Profile */}
                    <PersonSection
                        title="You"
                        person={inputs.person}
                        onChange={updatePerson}
                        onAccountChange={(acct, field, val) => updateNestedAccount('person', acct, field, val)}
                        colorTheme="blue"
                    />

                    {/* Spouse Toggle & Profile */}
                    {hasSpouse && inputs.spouse ? (
                        <PersonSection
                            title="Spouse"
                            person={inputs.spouse}
                            onChange={updateSpouse}
                            onAccountChange={(acct, field, val) => updateNestedAccount('spouse', acct, field, val)}
                            showRemove
                            onRemove={toggleSpouse}
                            colorTheme="purple"
                        />
                    ) : (
                        <section className="bg-slate-50/40 rounded-2xl p-6 shadow-sm border border-slate-100">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold text-slate-900">Spouse</h2>
                                <button
                                    onClick={toggleSpouse}
                                    className="px-3 py-1 text-sm rounded-full bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                                >
                                    Add Spouse
                                </button>
                            </div>
                            <p className="text-sm text-slate-500 italic mt-2">
                                No spouse configured. Click "Add Spouse" to include a partner in the simulation.
                            </p>
                        </section>
                    )}

                    {/* Household Spending */}
                    <CollapsibleSection
                        title="Household Spending"
                        className="bg-emerald-50/60 border-emerald-100"
                        headerClassName="bg-emerald-50/60"
                    >
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




                    {/* Asset Mix */}
                    <CollapsibleSection
                        title="Non-Reg Asset Mix"
                        className="bg-amber-50/60 border-amber-100"
                        headerClassName="bg-amber-50/60"
                        defaultOpen={false}
                    >
                        <AssetMixInput
                            mix={inputs.person.nonRegistered.assetMix}
                            onChange={(newMix) => setInputs({
                                ...inputs,
                                person: {
                                    ...inputs.person,
                                    nonRegistered: {
                                        ...inputs.person.nonRegistered,
                                        assetMix: newMix
                                    }
                                }
                            })}
                        />
                    </CollapsibleSection>

                    {/* Assumptions */}
                    <CollapsibleSection
                        title="Assumptions"
                        className="bg-rose-50/80 border-slate-200"
                        headerClassName="bg-rose-50/80"
                        defaultOpen={false}
                    >
                        <div className="space-y-4">
                            <div className="flex flex-col gap-1.5">
                                <label
                                    className="text-sm font-medium text-slate-700 cursor-help border-b border-dashed border-slate-300 w-fit"
                                    title="Determines provincial income tax rates, brackets, surtaxes (e.g. Ontario Health Premium), and tax credits used in the simulation."
                                >
                                    Province
                                </label>
                                <select
                                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                                    value={inputs.province}
                                    onChange={(e) => setInputs({ ...inputs, province: e.target.value })}
                                >
                                    <option value="AB">Alberta</option>
                                    <option value="BC">British Columbia</option>
                                    <option value="MB">Manitoba</option>
                                    <option value="NB">New Brunswick</option>
                                    <option value="NL">Newfoundland and Labrador</option>
                                    <option value="NS">Nova Scotia</option>
                                    <option value="NT">Northwest Territories</option>
                                    <option value="NU">Nunavut</option>
                                    <option value="ON">Ontario</option>
                                    <option value="PE">Prince Edward Island</option>
                                    <option value="QC">Quebec</option>
                                    <option value="SK">Saskatchewan</option>
                                    <option value="YT">Yukon</option>
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <FinancialInput
                                    label="Inflation Rate"
                                    prefix="%"
                                    minFractionDigits={1}
                                    maxFractionDigits={1}
                                    value={Number((inputs.inflationRate * 100).toFixed(1))}
                                    onChange={(e) => setInputs({ ...inputs, inflationRate: Number(e.target.value) / 100 })}
                                />
                                <FinancialInput
                                    label="Equity Returns"
                                    prefix="%"
                                    minFractionDigits={1}
                                    maxFractionDigits={1}
                                    value={Number((inputs.returnRates.capitalGrowth * 100).toFixed(1))}
                                    onChange={(e) => setInputs({
                                        ...inputs,
                                        returnRates: { ...inputs.returnRates, capitalGrowth: Number(e.target.value) / 100 }
                                    })}
                                />
                                <FinancialInput
                                    label="Dividend Yield"
                                    prefix="%"
                                    minFractionDigits={1}
                                    maxFractionDigits={1}
                                    value={Number((inputs.returnRates.dividend * 100).toFixed(1))}
                                    onChange={(e) => setInputs({
                                        ...inputs,
                                        returnRates: { ...inputs.returnRates, dividend: Number(e.target.value) / 100 }
                                    })}
                                />
                                <FinancialInput
                                    label="Interest Rate"
                                    prefix="%"
                                    minFractionDigits={1}
                                    maxFractionDigits={1}
                                    value={Number((inputs.returnRates.interest * 100).toFixed(1))}
                                    onChange={(e) => setInputs({
                                        ...inputs,
                                        returnRates: { ...inputs.returnRates, interest: Number(e.target.value) / 100 }
                                    })}
                                />
                            </div>

                            {/* Monte Carlo Toggle & Volatility */}
                            <div className="pt-2 border-t border-slate-100 space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                                        Monte Carlo Simulation
                                        <span className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded font-bold">BETA</span>
                                    </label>
                                    <div
                                        className={`w-11 h-6 flex items-center bg-slate-200 rounded-full p-1 cursor-pointer transition-colors ${isMonteCarlo ? 'bg-emerald-600' : ''}`}
                                        onClick={() => setIsMonteCarlo(!isMonteCarlo)}
                                    >
                                        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${isMonteCarlo ? 'translate-x-5' : ''}`}></div>
                                    </div>
                                </div>

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
                                            helperText="Standard deviation of annual returns (e.g. 10% for equities)."
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                <label className="text-sm font-medium text-slate-700">Use Pension Income Splitting</label>
                                <input
                                    type="checkbox"
                                    checked={inputs.useIncomeSplitting ?? true}
                                    onChange={(e) => setInputs({ ...inputs, useIncomeSplitting: e.target.checked })}
                                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                                />
                            </div>

                            <div
                                className="flex items-center justify-between pt-2 border-t border-slate-100"
                                title="If unchecked, withdrawals will come from Non-Registered accounts first (Tax-Efficient strategy), then TFSA, then RRSP."
                            >
                                <label className="text-sm font-medium text-slate-700 cursor-help border-b border-dashed border-slate-300">
                                    Withdraw from RRSP First
                                </label>
                                <input
                                    type="checkbox"
                                    checked={inputs.withdrawalStrategy === 'rrsp-first'}
                                    onChange={(e) => setInputs({
                                        ...inputs,
                                        withdrawalStrategy: e.target.checked ? 'rrsp-first' : 'tax-efficient'
                                    })}
                                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                                />
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                <label className="text-sm font-medium text-slate-700">Show Real Dollars (Inflation Adjusted)</label>
                                <input
                                    type="checkbox"
                                    checked={isInflationAdjusted}
                                    onChange={(e) => setIsInflationAdjusted(e.target.checked)}
                                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                                />
                            </div>
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
                    {/* Out of Money Warning */}

                    {metrics.outOfMoneyAge && (
                        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-start gap-3">
                            <div className="text-red-500 mt-0.5">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-red-800 font-bold">Projected Shortfall Detected</h3>
                                <p className="text-red-700 text-sm mt-1">
                                    Based on your current spending plan, liquid assets are projected to run out at age <strong>{metrics.outOfMoneyAge}</strong>.
                                    Consider reducing post-retirement spending or increasing savings.
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
                        hasSpouse={hasSpouse}
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

                    <YearlyBreakdownTable data={simulationResults} hasSpouse={hasSpouse} />
                </div>
            </div>
        </div >
    );
}
