import { FinancialInput } from '../inputs/FinancialInput';
import { AboutFields, BenefitsFields, AccountsFields, MeltdownFields } from '../inputs/PersonFields';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { HelpTooltip } from '../ui/HelpTooltip';
import { ValidationBanner } from '../ui/ValidationBanner';
import type { Person, NonRegisteredAccount } from '../../engine/types';
import { getValidationErrors } from '../../utils/personValidation';

// Dashboard label wording — terser than the wizard's sentence-case labels
// (see WIZARD_*_LABELS in ../onboarding/detailedSteps.tsx), since these sit in
// a dense sidebar of many fields rather than one wizard step at a time.
const ABOUT_LABELS = { age: 'Current Age', retirementAge: 'Retire Age', lifeExpectancy: 'Death Age' };
const BENEFITS_LABELS = { cppStartAge: 'CPP Start Age', yearsContributed: 'Years Contributed', oasStartAge: 'OAS Start Age' };
const MELTDOWN_LABELS = { meltStartAge: 'RRSP Melt Start Age', meltAmount: 'RRSP Melt Amount' };

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

    // Every shared field group patches the same person via one merge callback —
    // mirrors the wizard's patchPerson (see ../onboarding/detailedSteps.tsx),
    // adapted to this component's existing onChange/onAccountChange/onNonRegChange props.
    const onPatch = (patch: Partial<Person>) => {
        for (const [key, value] of Object.entries(patch)) {
            if (key === 'rrsp' || key === 'tfsa') {
                onAccountChange(key, 'balance', (value as { balance: number }).balance);
            } else if (key === 'nonRegisteredAccounts') {
                onNonRegChange(value as NonRegisteredAccount[]);
            } else {
                onChange(key, value as number | undefined);
            }
        }
    };

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

                <AboutFields person={person} onPatch={onPatch} labels={ABOUT_LABELS}
                    gridClassName="grid grid-cols-3 gap-2" />

                <BenefitsFields person={person} onPatch={onPatch} labels={BENEFITS_LABELS} />

                {person.cppAnnualOverride == null && (
                    <HelpTooltip text="The plan estimates CPP as Years Contributed ÷ 40 of the maximum. The CPP Calculator estimates it from your actual yearly earnings and can feed the result back into this plan.">
                        <a
                            href="/cpp-calculator/"
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

                <AccountsFields person={person} isSpouse={isSpouse} onPatch={onPatch}
                    driftSummary={nonRegDriftSummary} />

                <MeltdownFields person={person} isSpouse={isSpouse} onPatch={onPatch}
                    labels={MELTDOWN_LABELS} />
            </div>
        </CollapsibleSection>
    );
}
