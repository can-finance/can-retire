import { FinancialInput } from '../inputs/FinancialInput';
import { AboutFields, BenefitsFields, AccountsFields, MeltdownFields, PensionFields } from '../inputs/PersonFields';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { HelpTooltip } from '../ui/HelpTooltip';
import { ValidationBanner } from '../ui/ValidationBanner';
import type { Person, NonRegisteredAccount } from '../../engine/types';
import { getValidationErrors } from '../../utils/personValidation';

// Dashboard label wording — terser than the wizard's sentence-case labels
// (see WIZARD_*_LABELS in ../onboarding/detailedSteps.tsx), since these sit in
// a dense sidebar of many fields rather than one wizard step at a time.
const ABOUT_LABELS = { age: 'Current Age', retirementAge: 'Retirement Age', lifeExpectancy: 'Life Expectancy' };
const BENEFITS_LABELS = { cppStartAge: 'CPP Start Age', yearsContributed: 'CPP Years', oasStartAge: 'OAS Start Age' };
const MELTDOWN_LABELS = { meltStartAge: 'RRSP Melt Start Age', meltAmount: 'RRSP Melt Amount' };
const PENSION_LABELS = {
    section: 'Workplace Pension (DB)',
    annualAmount: 'Annual Amount',
    startAge: 'Start Age',
    indexed: 'Indexed to Inflation',
    bridgeAmount: 'Bridge Benefit',
    bridgeEndAge: 'Bridge End Age',
};

interface PersonSectionProps {
    title: string;
    person: Person;
    onChange: (field: string, value: number | object | undefined) => void;
    onAccountChange: (account: 'rrsp' | 'tfsa', field: 'balance', value: number) => void;
    onNonRegChange: (accounts: NonRegisteredAccount[]) => void;
    /** One-line drift readout for this person's non-registered accounts */
    nonRegDriftSummary?: string | null;
    showRemove?: boolean;
    onRemove?: () => void;
    colorTheme?: 'blue' | 'indigo' | 'slate' | 'purple';
    defaultOpen?: boolean;
    /** When provided, renders an upsell link under the meltdown fields that opens the optimizer. */
    onOpenOptimizer?: () => void;
}

// Per-person accent colour — distinct from all chart account colors.
// "You" → indigo, "Spouse" → cyan. Both gender-neutral. Carried by the card's
// left border alone; the header used to repeat it as a coloured dot, which was
// redundant next to that border.
const PERSON_AVATAR: Record<string, { accent: 'indigo' | 'cyan' | 'slate' }> = {
    blue:   { accent: 'indigo' },
    purple: { accent: 'cyan' },
    indigo: { accent: 'indigo' },
    slate:  { accent: 'slate' },
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
    onOpenOptimizer,
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
                onChange(key, value as number | object | undefined);
            }
        }
    };

    const headerContent = (
        <div className="flex items-center gap-3">
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
                    <HelpTooltip text="The plan estimates CPP as CPP Years ÷ 40 of the maximum. The CPP Calculator estimates it from your actual yearly earnings and can feed the result back into this plan.">
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
                            (CPP Years is ignored)
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
                    tooltip="Gross employment income in today's dollars, like your household spending. It is indexed at the plan's inflation rate for each year you keep working, so your pay holds its purchasing power rather than shrinking against rising costs."
                    onChange={(e) => onChange('currentIncome', Number(e.target.value))} />

                <AccountsFields person={person} isSpouse={isSpouse} onPatch={onPatch}
                    driftSummary={nonRegDriftSummary} />

                <MeltdownFields person={person} isSpouse={isSpouse} onPatch={onPatch}
                    labels={MELTDOWN_LABELS} />

                {onOpenOptimizer && (
                    <HelpTooltip text="Searches annual RRSP withdrawal amounts — and optionally CPP/OAS timing — for the combination that leaves the largest after-tax estate, then lets you apply it to this plan.">
                        <button
                            type="button"
                            onClick={onOpenOptimizer}
                            className="text-xs text-sky-600 hover:text-sky-800 underline decoration-dotted cursor-help"
                        >
                            Not sure how much or when to melt? Try the optimizer →
                            <span className="ml-1 inline-block bg-sky-100 text-sky-700 text-xs px-1.5 py-0.5 rounded font-bold align-middle">BETA</span>
                        </button>
                    </HelpTooltip>
                )}

                <PensionFields person={person} onPatch={onPatch} labels={PENSION_LABELS} />
            </div>
        </CollapsibleSection>
    );
}
