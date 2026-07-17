import { FinancialInput } from '../inputs/FinancialInput';
import { NonRegAccountsInput } from '../inputs/NonRegAccountsInput';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { HelpTooltip } from '../ui/HelpTooltip';
import { ValidationBanner } from '../ui/ValidationBanner';
import type { Person, NonRegisteredAccount } from '../../engine/types';
import { CHART_COLORS } from '../../constants/chartColors';
import { getValidationErrors } from '../../utils/personValidation';

interface PersonSectionProps {
    title: string;
    person: Person;
    onChange: (field: string, value: number | undefined) => void;
    onAccountChange: (account: 'rrsp' | 'tfsa', field: 'balance', value: number) => void;
    onNonRegChange: (accounts: NonRegisteredAccount[]) => void;
    /** One-line drift readout for this person's non-registered accounts */
    nonRegDriftSummary?: string | null;
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

export function PersonSection({
    title,
    person,
    onChange,
    onAccountChange,
    onNonRegChange,
    nonRegDriftSummary,
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
                <ValidationBanner errors={validationErrors} />

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

                {person.cppAnnualOverride == null && (
                    <HelpTooltip text="The plan estimates CPP simply as Years Contributed ÷ 40 of the maximum. The CPP Calculator estimates it from your actual yearly earnings (with drop-out and child-rearing provisions) and can feed the result back into this plan.">
                        <a
                            href="#cpp-calculator"
                            className="text-xs text-sky-600 hover:text-sky-800 underline decoration-dotted cursor-help"
                        >
                            Want a more accurate CPP estimate? Try the CPP Calculator →
                        </a>
                    </HelpTooltip>
                )}

                {person.cppAnnualOverride != null && (
                    <div className="flex items-center justify-between gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-sky-800">
                            Using CPP Calculator estimate:{' '}
                            <span className="font-bold">
                                {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(person.cppAnnualOverride)}/yr
                            </span>{' '}
                            (Years Contributed is ignored)
                        </p>
                        <button
                            onClick={() => onChange('cppAnnualOverride', undefined)}
                            className="text-xs font-medium text-sky-600 hover:text-sky-800 underline decoration-dotted whitespace-nowrap"
                        >
                            Clear
                        </button>
                    </div>
                )}

                <FinancialInput label="Annual Income" value={person.currentIncome}
                    onChange={(e) => onChange('currentIncome', Number(e.target.value))} />

                <div className="grid grid-cols-2 gap-3">
                    <FinancialInput label="RRSP" value={person.rrsp.balance} accentColor={rrspColor}
                        onChange={(e) => onAccountChange('rrsp', 'balance', Number(e.target.value))} />
                    <FinancialInput label="TFSA" value={person.tfsa.balance} accentColor={tfsaColor}
                        onChange={(e) => onAccountChange('tfsa', 'balance', Number(e.target.value))} />
                </div>

                <NonRegAccountsInput
                    accounts={person.nonRegisteredAccounts}
                    onChange={onNonRegChange}
                    accentColor={nonRegColor}
                    driftSummary={nonRegDriftSummary}
                />

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
