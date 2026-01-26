import { useState } from 'react';
import { FinancialInput } from '../inputs/FinancialInput';
import type { Person } from '../../engine/types';

interface PersonSectionProps {
    title: string;
    person: Person;
    onChange: (field: string, value: number) => void;
    onAccountChange: (account: 'rrsp' | 'tfsa' | 'nonRegistered', field: 'balance' | 'adjustedCostBase', value: number) => void;
    showRemove?: boolean;
    onRemove?: () => void;
    colorTheme?: 'blue' | 'indigo' | 'slate' | 'purple';
    defaultOpen?: boolean;
}

const THEME_CLASSES = {
    blue: 'bg-blue-50/60 border-blue-100',
    indigo: 'bg-indigo-50/60 border-indigo-100',
    slate: 'bg-slate-50/60 border-slate-100',
    purple: 'bg-purple-50/60 border-purple-100'
};

// Validation helper
function getValidationErrors(person: Person): string[] {
    const errors: string[] = [];

    if (person.age < 18 || person.age > 99) {
        errors.push('Current age must be between 18 and 99');
    }
    if (person.retirementAge < person.age) {
        errors.push('Retirement age must be ≥ current age');
    }
    if (person.lifeExpectancy <= person.age) {
        errors.push('Life expectancy must be > current age');
    }
    if (person.lifeExpectancy <= person.retirementAge) {
        errors.push('Life expectancy must be > retirement age');
    }
    if (person.cppStartAge < 60 || person.cppStartAge > 70) {
        errors.push('CPP start age must be between 60 and 70');
    }
    if (person.oasStartAge < 65 || person.oasStartAge > 70) {
        errors.push('OAS start age must be between 65 and 70');
    }
    if (person.cppContributedYears < 0 || person.cppContributedYears > 47) {
        errors.push('CPP years must be between 0 and 47');
    }
    if (person.rrspMeltStartAge && person.rrspMeltStartAge < person.age) {
        errors.push('RRSP melt start must be ≥ current age');
    }

    return errors;
}

export function PersonSection({
    title,
    person,
    onChange,
    onAccountChange,
    showRemove,
    onRemove,
    colorTheme = 'slate',
    defaultOpen = true
}: PersonSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const validationErrors = getValidationErrors(person);

    return (
        <section className={`rounded-2xl shadow-sm border overflow-hidden ${THEME_CLASSES[colorTheme]}`}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 text-left"
            >
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-slate-900">{title}</h2>
                    {validationErrors.length > 0 && (
                        <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">
                            {validationErrors.length} issue{validationErrors.length > 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {showRemove && onRemove && (
                        <span
                            onClick={(e) => { e.stopPropagation(); onRemove(); }}
                            className="px-3 py-1 text-xs font-medium bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors cursor-pointer"
                        >
                            Remove
                        </span>
                    )}
                    <svg
                        className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>
            <div className={`transition-all duration-200 ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                <div className="p-4 pt-0 space-y-4">
                    {validationErrors.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                            {validationErrors.map((error, i) => (
                                <p key={i} className="text-xs text-amber-700 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    {error}
                                </p>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-2">
                        <FinancialInput
                            label="Current Age"
                            prefix=""
                            value={person.age}
                            onChange={(e) => onChange('age', Number(e.target.value))}
                        />
                        <FinancialInput
                            label="Retire Age"
                            prefix=""
                            value={person.retirementAge}
                            onChange={(e) => onChange('retirementAge', Number(e.target.value))}
                        />
                        <FinancialInput
                            label="Death Age"
                            prefix=""
                            value={person.lifeExpectancy}
                            onChange={(e) => onChange('lifeExpectancy', Number(e.target.value))}
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <FinancialInput
                            label="CPP Start Age"
                            prefix=""
                            value={person.cppStartAge}
                            onChange={(e) => onChange('cppStartAge', Number(e.target.value))}
                        />
                        <FinancialInput
                            label="Years Contributed"
                            prefix=""
                            value={person.cppContributedYears ?? 35}
                            onChange={(e) => onChange('cppContributedYears', Number(e.target.value))}
                        />
                        <FinancialInput
                            label="OAS Start Age"
                            prefix=""
                            value={person.oasStartAge}
                            onChange={(e) => onChange('oasStartAge', Number(e.target.value))}
                        />
                    </div>

                    <FinancialInput
                        label="Annual Income"
                        value={person.currentIncome}
                        onChange={(e) => onChange('currentIncome', Number(e.target.value))}
                    />

                    <div className="grid grid-cols-2 gap-3">
                        <FinancialInput
                            label="RRSP"
                            value={person.rrsp.balance}
                            onChange={(e) => onAccountChange('rrsp', 'balance', Number(e.target.value))}
                        />
                        <FinancialInput
                            label="TFSA"
                            value={person.tfsa.balance}
                            onChange={(e) => onAccountChange('tfsa', 'balance', Number(e.target.value))}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <FinancialInput
                            label="Non-Reg Balance"
                            value={person.nonRegistered.balance}
                            onChange={(e) => onAccountChange('nonRegistered', 'balance', Number(e.target.value))}
                        />
                        <FinancialInput
                            label="Non-Reg ACB"
                            value={person.nonRegistered.adjustedCostBase}
                            onChange={(e) => onAccountChange('nonRegistered', 'adjustedCostBase', Number(e.target.value))}
                            tooltip={title === 'You' ? "Original investment cost" : "Original amount invested"}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <FinancialInput
                            label="RRSP Melt Start Age"
                            prefix=""
                            value={person.rrspMeltStartAge || person.retirementAge}
                            onChange={(e) => onChange('rrspMeltStartAge', Number(e.target.value))}
                            tooltip="Age to begin deliberate early RRSP withdrawals. Melt automatically stops at age 71 (before mandatory RRIF conversion at 72)."
                        />
                        <FinancialInput
                            label="RRSP Melt Annual Amount"
                            value={person.rrspMeltAmount || 0}
                            onChange={(e) => onChange('rrspMeltAmount', Number(e.target.value))}
                            tooltip="Annual amount to withdraw from RRSP from start age until age 71."
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}
