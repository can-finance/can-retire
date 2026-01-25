import { useMemo, useState } from 'react';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useScenarios } from '../../hooks/useScenarios';
import type { SavedScenario } from '../../hooks/useScenarios';
import { FinancialInput } from '../inputs/FinancialInput';
import { AssetMixInput } from '../inputs/AssetMixInput';
import { WealthChart } from '../charts/WealthChart';
import { SpendingChart } from '../charts/SpendingChart';
import { SurplusChart } from '../charts/SurplusChart';
import { YearlyBreakdownTable } from '../tables/YearlyBreakdownTable';
import { runSimulation } from '../../engine/projection';
import { AccountTypeVals } from '../../engine/types';
import type { Person, SimulationInputs, NonRegisteredAccount } from '../../engine/types';
import { calculateIncomeTax } from '../../engine/tax';
import { SummaryHeader } from './SummaryHeader';
import { PersonSection } from './PersonSection';

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
    spouse: createDefaultPerson(true),
    province: 'ON',
    inflationRate: 0.025,
    preRetirementSpend: 70000,
    postRetirementSpend: 80000,
    withdrawalStrategy: 'rrsp-first',
    useIncomeSplitting: true,
    returnRates: {
        interest: 0.02,
        dividend: 0.03,
        capitalGrowth: 0.05
    }
};

export function Dashboard() {
    const [inputs, setInputs] = usePersistentState<SimulationInputs>('retirement_sim_v2', INITIAL_INPUTS);
    const { scenarios, saveScenario, updateScenario, deleteScenario } = useScenarios();
    const [newScenarioName, setNewScenarioName] = useState('');
    const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
    const [hasSpouse, setHasSpouse] = useState(!!inputs.spouse);
    const [isInflationAdjusted, setIsInflationAdjusted] = useState(false);

    const simulationResults = useMemo(() => {
        return runSimulation(inputs);
    }, [inputs]);

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

    const handleSaveScenario = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newScenarioName.trim()) return;
        saveScenario(newScenarioName, inputs);
        setNewScenarioName('');
    };

    const loadScenario = (savedScenario: SavedScenario) => {
        setInputs(savedScenario.inputs);
        setHasSpouse(!!savedScenario.inputs.spouse);
        setActiveScenarioId(savedScenario.id);
        setNewScenarioName(savedScenario.name);
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
        setNewScenarioName('');
    };



    const metrics = useMemo(() => {
        const atRetirement = simulationResults.find(r => r.age === inputs.person.retirementAge);
        const lastYear = simulationResults[simulationResults.length - 1];
        const retirementResults = simulationResults.filter(r => r.age >= inputs.person.retirementAge);

        const annualTaxRetirement = retirementResults.reduce((acc, curr) => acc + curr.taxPaid, 0);
        const totalSpend = simulationResults.reduce((acc, curr) => acc + curr.spending, 0);
        const totalRetirementIncome = retirementResults.reduce((acc, curr) => acc + curr.grossIncome, 0);

        const terminalIncome =
            lastYear.accounts.rrsp +
            (lastYear.spouseAccounts?.rrsp || 0) +
            (Math.max(0, lastYear.accounts.nonRegistered - lastYear.accounts.nonRegisteredACB) * 0.5) +
            (lastYear.spouseAccounts ? Math.max(0, lastYear.spouseAccounts.nonRegistered - lastYear.spouseAccounts.spouseNonRegisteredACB) * 0.5 : 0);

        const estateTax = calculateIncomeTax(terminalIncome, inputs.province);
        const totalTaxPlusEstate = annualTaxRetirement + estateTax;

        const effectiveTaxRateRetirement = totalRetirementIncome > 0 ? (annualTaxRetirement / totalRetirementIncome) * 100 : 0;
        const outOfMoneyYear = simulationResults.find(r => r.totalAssets < 1000 && r.age >= inputs.person.retirementAge);
        const outOfMoneyAge = outOfMoneyYear ? outOfMoneyYear.age : null;

        const estateValue = lastYear.totalAssets;
        const effectiveTaxRateEstate = estateValue > 0 ? (estateTax / estateValue) * 100 : 0;
        const totalEffectiveTaxRate = (totalRetirementIncome + estateValue) > 0 ? (totalTaxPlusEstate / (totalRetirementIncome + estateValue)) * 100 : 0;

        return {
            nwRetirement: atRetirement ? atRetirement.totalAssets : 0,
            estate: estateValue,
            annualTaxRetirement,
            estateTax,
            totalTaxPlusEstate,
            totalSpend,
            totalRetirementIncome,
            effectiveTaxRateRetirement,
            effectiveTaxRateEstate,
            totalEffectiveTaxRate,
            outOfMoneyAge
        };
    }, [simulationResults, inputs.person.retirementAge, inputs.province]);

    return (
        <div className="flex flex-col gap-6">
            <SummaryHeader metrics={metrics} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Sidebar / Inputs */}
                <div className="lg:col-span-4 space-y-6">
                    {/* ... existing sidebar ... */}
                    {/* Saved Scenarios */}
                    <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                        <div className="flex items-center justify-between border-b pb-2">
                            <div className="flex flex-col">
                                <h2 className="text-xl font-bold text-slate-900 line-clamp-1">
                                    {activeScenarioId
                                        ? scenarios.find(s => s.id === activeScenarioId)?.name || 'Scenarios'
                                        : 'Scenarios'}
                                </h2>
                                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                                    {activeScenarioId ? 'Active Scenario' : ''}
                                </p>
                            </div>
                            <button
                                onClick={handleCreateNew}
                                className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded hover:bg-slate-200 transition-colors"
                            >
                                Reset to Defaults
                            </button>
                        </div>

                        <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Scenario name..."
                                    className="flex-1 text-sm rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-brand-500 outline-none"
                                    value={newScenarioName}
                                    onChange={(e) => setNewScenarioName(e.target.value)}
                                />
                                {activeScenarioId ? (
                                    <button
                                        onClick={handleUpdateScenario}
                                        className="bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors whitespace-nowrap"
                                    >
                                        Update
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleSaveScenario}
                                        className="bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors whitespace-nowrap"
                                    >
                                        Save
                                    </button>
                                )}
                            </div>
                            {activeScenarioId && (
                                <button
                                    onClick={handleSaveScenario}
                                    className="text-xs text-slate-400 hover:text-brand-600 text-center transition-colors"
                                >
                                    Save as copy instead
                                </button>
                            )}
                        </div>

                        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar pt-2 border-t">
                            {scenarios.length === 0 ? (
                                <p className="text-xs text-slate-400 italic text-center py-4">No saved scenarios yet.</p>
                            ) : (
                                scenarios.map(s => (
                                    <div
                                        key={s.id}
                                        className={`flex items-center justify-between p-2 rounded-lg group transition-all cursor-pointer ${activeScenarioId === s.id
                                            ? 'bg-brand-50 border border-brand-100'
                                            : 'bg-slate-50 border border-transparent hover:bg-slate-100'
                                            }`}
                                        onClick={() => loadScenario(s)}
                                    >
                                        <div className="flex-1">
                                            <p className={`text-sm font-medium truncate ${activeScenarioId === s.id ? 'text-brand-900' : 'text-slate-700'}`}>
                                                {s.name}
                                            </p>
                                            <p className="text-[10px] text-slate-400">{new Date(s.lastSaved).toLocaleDateString()}</p>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteScenario(s.id);
                                                if (activeScenarioId === s.id) setActiveScenarioId(null);
                                            }}
                                            className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                    </section>

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
                    <section className="bg-emerald-50/60 rounded-2xl p-6 shadow-sm border border-emerald-100 space-y-4">
                        <h2 className="text-xl font-bold text-slate-900 border-b border-emerald-200/50 pb-2">Household Spending</h2>
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
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-slate-700">Province</label>
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

                    </section>

                    {/* Asset Mix */}
                    <section className="bg-amber-50/60 rounded-2xl p-6 shadow-sm border border-amber-100 space-y-4">
                        <h2 className="text-xl font-bold text-slate-900 border-b border-amber-200/50 pb-2">Non-Reg Asset Mix</h2>
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
                    </section>

                    {/* Assumptions */}
                    <section className="bg-rose-50/80 rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
                        <h2 className="text-xl font-bold text-slate-900 border-b border-slate-200 pb-2">Assumptions</h2>

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
                            <label className="text-sm font-medium text-slate-700">Real Dollars (Inflation Adjusted)</label>
                            <input
                                type="checkbox"
                                checked={isInflationAdjusted}
                                onChange={(e) => setIsInflationAdjusted(e.target.checked)}
                                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                        </div>

                    </section>
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
                    <WealthChart data={simulationResults} hasSpouse={hasSpouse} inflationAdjusted={isInflationAdjusted} />
                    <SpendingChart data={simulationResults} hasSpouse={hasSpouse} inflationAdjusted={isInflationAdjusted} />
                    <SurplusChart data={simulationResults} inflationAdjusted={isInflationAdjusted} />
                    <YearlyBreakdownTable data={simulationResults} hasSpouse={hasSpouse} />
                </div>
            </div>
        </div>
    );
}
