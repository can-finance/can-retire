import { FinancialInput } from '../inputs/FinancialInput';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import type { Person } from '../../engine/types';
import { CHART_COLORS } from '../../constants/chartColors';

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

// Person avatar dot colors — distinct from all chart account colors.
// "You" → indigo, "Spouse" → cyan. Both gender-neutral.
const PERSON_AVATAR: Record<string, { dot: string; accent: 'indigo' | 'cyan' | 'slate' }> = {
    blue:   { dot: '#6366f1', accent: 'indigo' },
    purple: { dot: '#06b6d4', accent: 'cyan' },
    indigo: { dot: '#6366f1', accent: 'indigo' },
    slate:  { dot: '#94a3b8', accent: 'slate' },
};

function getValidationErrors(person: Person): string[] {
    const errors: string[] = [];

    if (person.age < 18 || person.age > 99)
        errors.push('Current age must be between 18 and 99');
    if (person.retirementAge < person.age)
        errors.push('Retirement age must be \u2265 current age');
    if (person.lifeExpectancy <= person.age)
        errors.push('Life expectancy must be > current age');
    if (person.lifeExpectancy <= person.retirementAge)
        errors.push('Life expectancy must be > retirement age');
    if (person.cppStartAge < 60 || person.cppStartAge > 70)
        errors.push('CPP start age must be between 60 and 70');
    if (person.oasStartAge < 65 || person.oasStartAge > 70)
        errors.push('OAS start age must be between 65 and 70');
    if (person.cppContributedYears < 0 || person.cppContributedYears > 47)
        errors.push('CPP years must be between 0 and 47');
    if (person.rrspMeltStartAge && person.rrspMeltStartAge < person.age)
        errors.push('RRSP melt start must be \u2265 current age');

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
    defaultOpen = true,
}: PersonSectionProps) {
    const validationErrors = getValidationErrors(person);
    const isSpouse = colorTheme === 'purple';
    const avatar = PERSON_AVATAR[colorTheme] ?? PERSON_AVATAR.slate;

    const rrspColor   = isSpouse ? CHART_COLORS.spRrsp   : CHART_COLORS.rrsp;
    const tfsaColor   = isSpouse ? CHART_COLORS.spTfsa   : CHART_COLORS.tfsa;
    const nonRegColor = isSpouse ? CHART_COLORS.spNonReg : CHART_COLORS.nonReg;

    const headerContent = (
        <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: avatar.dot }} />
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            {validationErrors.length > 0 && (
                <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">
                    {validationErrors.length} issue{validationErrors.length > 1 ? 's' : ''}
                </span>
            )}
        </div>
    );

    const removeButton = showRemove && onRemove ? (
        <span
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="px-3 py-1 text-xs font-medium bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors cursor-pointer"
        >
            Remove
        </span>
    ) : undefined;

    return (
        <CollapsibleSection
            title=""
            accent={avatar.accent}
            defaultOpen={defaultOpen}
            headerContent={headerContent}
            headerExtra={removeButton}
        >
            <div className="space-y-4">
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
                    <FinancialInput label="Current Age" prefix="" value={person.age}
                        onChange={(e) => onChange('age', Number(e.target.value))} />
                    <FinancialInput label="Retire Age" prefix="" value={person.retirementAge}
                        onChange={(e) => onChange('retirementAge', Number(e.target.value))} />
                    <FinancialInput label="Death Age" prefix="" value={person.lifeExpectancy}
                        onChange={(e) => onChange('lifeExpectancy', Number(e.target.value))} />
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <FinancialInput label="CPP Start Age" prefix="" value={person.cppStartAge}
                        onChange={(e) => onChange('cppStartAge', Number(e.target.value))} />
                    <FinancialInput label="Years Contributed" prefix="" value={person.cppContributedYears ?? 35}
                        onChange={(e) => onChange('cppContributedYears', Number(e.target.value))} />
                    <FinancialInput label="OAS Start Age" prefix="" value={person.oasStartAge}
                        onChange={(e) => onChange('oasStartAge', Number(e.target.value))} />
                </div>

                <FinancialInput label="Annual Income" value={person.currentIncome}
                    onChange={(e) => onChange('currentIncome', Number(e.target.value))} />

                <div className="grid grid-cols-2 gap-3">
                    <FinancialInput label="RRSP" value={person.rrsp.balance} accentColor={rrspColor}
                        onChange={(e) => onAccountChange('rrsp', 'balance', Number(e.target.value))} />
                    <FinancialInput label="TFSA" value={person.tfsa.balance} accentColor={tfsaColor}
                        onChange={(e) => onAccountChange('tfsa', 'balance', Number(e.target.value))} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <FinancialInput label="Non-Reg Balance" value={person.nonRegistered.balance} accentColor={nonRegColor}
                        onChange={(e) => onAccountChange('nonRegistered', 'balance', Number(e.target.value))} />
                    <FinancialInput label="Non-Reg ACB" value={person.nonRegistered.adjustedCostBase} accentColor={nonRegColor}
                        onChange={(e) => onAccountChange('nonRegistered', 'adjustedCostBase', Number(e.target.value))}
                        tooltip={title === 'You' ? "Original investment cost" : "Original amount invested"} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FinancialInput label="RRSP Melt Start Age" prefix=""
                        value={person.rrspMeltStartAge || person.retirementAge} accentColor={rrspColor}
                        onChange={(e) => onChange('rrspMeltStartAge', Number(e.target.value))}
                        tooltip="Age to begin deliberate early RRSP withdrawals. Melt automatically stops at age 71 (before mandatory RRIF conversion at 72)." />
                    <FinancialInput label="RRSP Melt Amount"
                        value={person.rrspMeltAmount || 0} accentColor={rrspColor}
                        onChange={(e) => onChange('rrspMeltAmount', Number(e.target.value))}
                        tooltip="Annual amount to withdraw from RRSP from start age until age 71." />
                </div>
            </div>
        </CollapsibleSection>
    );
}
