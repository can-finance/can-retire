import { FinancialInput } from '../inputs/FinancialInput';
import type { Person } from '../../engine/types';

interface PersonSectionProps {
    title: string;
    person: Person;
    onChange: (field: string, value: number) => void;
    onAccountChange: (account: 'rrsp' | 'tfsa' | 'nonRegistered', field: 'balance' | 'adjustedCostBase', value: number) => void;
    showRemove?: boolean;
    onRemove?: () => void;
    colorTheme?: 'blue' | 'indigo' | 'slate';
}

const THEME_CLASSES = {
    blue: 'bg-blue-50/60 border-blue-100',
    indigo: 'bg-indigo-50/60 border-indigo-100',
    slate: 'bg-slate-50/60 border-slate-100'
};

export function PersonSection({
    title,
    person,
    onChange,
    onAccountChange,
    showRemove,
    onRemove,
    colorTheme = 'slate'
}: PersonSectionProps) {
    return (
        <section className={`rounded-2xl p-6 shadow-sm border space-y-4 ${THEME_CLASSES[colorTheme]}`}>
            <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-xl font-bold text-slate-900">{title}</h2>
                {showRemove && onRemove && (
                    <button
                        onClick={onRemove}
                        className="px-3 py-1 text-xs font-medium bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors"
                    >
                        Remove Spouse
                    </button>
                )}
            </div>

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

            <div className="grid grid-cols-2 gap-3">
                <FinancialInput
                    label="CPP Start Age"
                    prefix=""
                    value={person.cppStartAge}
                    onChange={(e) => onChange('cppStartAge', Number(e.target.value))}
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
                    helperText={title === 'You' ? "Original investment cost" : "Original amount invested"}
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <FinancialInput
                    label="Melt Start Age"
                    prefix=""
                    value={person.rrspMeltStartAge || person.retirementAge}
                    onChange={(e) => onChange('rrspMeltStartAge', Number(e.target.value))}
                />
                <FinancialInput
                    label="Melt Annual Amount"
                    value={person.rrspMeltAmount || 0}
                    onChange={(e) => onChange('rrspMeltAmount', Number(e.target.value))}
                />
            </div>
        </section>
    );
}
