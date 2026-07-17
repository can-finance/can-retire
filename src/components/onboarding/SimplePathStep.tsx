import { FinancialInput } from '../inputs/FinancialInput';
import { Toggle } from '../ui/Toggle';
import { HelpTooltip } from '../ui/HelpTooltip';
import { SectionCard } from '../ui/SectionCard';
import { ValidationBanner } from '../ui/ValidationBanner';
import { simpleAnswersErrors, type SimpleAnswers } from './simplePathMapping';
import { PROVINCES } from '../../constants/provinces';

interface SimplePathStepProps {
    /** 0 = "About your household", 1 = "Savings and spending" */
    step: 0 | 1;
    answers: SimpleAnswers;
    onChange: (partial: Partial<SimpleAnswers>) => void;
}

export function SimplePathStep({ step, answers, onChange }: SimplePathStepProps) {
    // Validate the RAW answers (not the clamped preview) so a typed inconsistency
    // — e.g. retirement age below current age — surfaces here instead of being
    // silently replaced by a clamp. Clamps still apply at commit as a safety net.
    const { person: personErrors, spouse: spouseErrors } = simpleAnswersErrors(answers);

    if (step === 0) {
        return (
            <SectionCard accent="sky" className="space-y-5">
                <div>
                    <h2 className="text-xl font-bold text-slate-900">About your household</h2>
                    <p className="text-sm text-slate-500 mt-1">
                        A few basics to get started. You can refine everything later on the dashboard.
                    </p>
                </div>

                <ValidationBanner errors={[...personErrors, ...spouseErrors]} />

                <div className="grid grid-cols-2 gap-4">
                    <FinancialInput
                        label="Your current age"
                        prefix=""
                        value={answers.age}
                        onChange={(e) => onChange({ age: Number(e.target.value) })}
                    />
                    <FinancialInput
                        label="Retirement age"
                        prefix=""
                        value={answers.retirementAge}
                        onChange={(e) => onChange({ retirementAge: Number(e.target.value) })}
                    />
                </div>

                <FinancialInput
                    label="Annual income (before tax)"
                    value={answers.currentIncome}
                    onChange={(e) => onChange({ currentIncome: Number(e.target.value) })}
                />

                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-slate-700">Province</label>
                    <select
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                        value={answers.province}
                        onChange={(e) => onChange({ province: e.target.value })}
                    >
                        {PROVINCES.map((p) => (
                            <option key={p.code} value={p.code}>{p.name}</option>
                        ))}
                    </select>
                </div>

                <Toggle
                    checked={answers.includeSpouse}
                    onChange={(val) => onChange({ includeSpouse: val })}
                    label="Include a spouse / partner"
                />

                {answers.includeSpouse && (
                    <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 border border-slate-100 p-3">
                        <FinancialInput
                            label="Spouse's age"
                            prefix=""
                            value={answers.spouseAge}
                            onChange={(e) => onChange({ spouseAge: Number(e.target.value) })}
                        />
                        <FinancialInput
                            label="Spouse's income"
                            value={answers.spouseIncome}
                            onChange={(e) => onChange({ spouseIncome: Number(e.target.value) })}
                        />
                    </div>
                )}
            </SectionCard>
        );
    }

    // step === 1
    return (
        <SectionCard accent="emerald" className="space-y-5">
            <div>
                <h2 className="text-xl font-bold text-slate-900">Savings and spending</h2>
                <p className="text-sm text-slate-500 mt-1">
                    Roughly what you have saved today, and what you expect to spend each year.
                </p>
            </div>

            <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-slate-700">Your accounts</h3>
                    <HelpTooltip text="For non-registered savings we assume half of the balance is your original investment (cost base). You can fine-tune this on the dashboard afterwards.">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-slate-300 hover:text-slate-500 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </HelpTooltip>
                </div>
                <div className="grid grid-cols-3 gap-3">
                    <FinancialInput label="RRSP" value={answers.rrsp}
                        onChange={(e) => onChange({ rrsp: Number(e.target.value) })} />
                    <FinancialInput label="TFSA" value={answers.tfsa}
                        onChange={(e) => onChange({ tfsa: Number(e.target.value) })} />
                    <FinancialInput label="Non-registered" value={answers.nonReg}
                        onChange={(e) => onChange({ nonReg: Number(e.target.value) })} />
                </div>
            </div>

            {answers.includeSpouse && (
                <div className="space-y-3 rounded-xl bg-slate-50 border border-slate-100 p-3">
                    <h3 className="text-sm font-semibold text-slate-700">Spouse's accounts</h3>
                    <div className="grid grid-cols-3 gap-3">
                        <FinancialInput label="RRSP" value={answers.spouseRrsp}
                            onChange={(e) => onChange({ spouseRrsp: Number(e.target.value) })} />
                        <FinancialInput label="TFSA" value={answers.spouseTfsa}
                            onChange={(e) => onChange({ spouseTfsa: Number(e.target.value) })} />
                        <FinancialInput label="Non-registered" value={answers.spouseNonReg}
                            onChange={(e) => onChange({ spouseNonReg: Number(e.target.value) })} />
                    </div>
                </div>
            )}

            <div className="space-y-3 pt-2 border-t border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700">Household spending per year</h3>
                <div className="grid grid-cols-2 gap-4">
                    <FinancialInput label="Before retirement" value={answers.preRetirementSpend}
                        onChange={(e) => onChange({ preRetirementSpend: Number(e.target.value) })} />
                    <FinancialInput label="After retirement" value={answers.postRetirementSpend}
                        onChange={(e) => onChange({ postRetirementSpend: Number(e.target.value) })} />
                </div>
            </div>
        </SectionCard>
    );
}
