/* eslint-disable react-refresh/only-export-components -- step-factory module: buildDetailedSteps returns JSX-producing steps built from local field groups; not a Fast-Refresh component module. */
import type { Dispatch, SetStateAction, ReactNode } from 'react';
import { FinancialInput } from '../inputs/FinancialInput';
import { OneTimeSpendingInput } from '../inputs/OneTimeSpendingInput';
import { AssumptionsFields } from '../inputs/AssumptionsFields';
import {
    AboutFields as SharedAboutFields,
    BenefitsFields as SharedBenefitsFields,
    AccountsFields as SharedAccountsFields,
    MeltdownFields as SharedMeltdownFields,
    PensionFields as SharedPensionFields,
} from '../inputs/PersonFields';
import { Toggle } from '../ui/Toggle';
import { getValidationErrors, type ValidationScope } from '../../utils/personValidation';
import type { Person, SimulationInputs } from '../../engine/types';

// Wizard label wording — sentence case, spoken to the user one step at a time
// (see ABOUT_LABELS etc. in ../dashboard/PersonSection.tsx for the dashboard's
// terser equivalents).
const WIZARD_ABOUT_LABELS = { age: 'Current age', retirementAge: 'Retirement age', lifeExpectancy: 'Life expectancy' };
const WIZARD_BENEFITS_LABELS = { cppStartAge: 'CPP start age', yearsContributed: 'Years contributed', oasStartAge: 'OAS start age' };
const WIZARD_MELTDOWN_LABELS = { meltStartAge: 'Melt start age', meltAmount: 'Melt amount per year' };
const WIZARD_PENSION_LABELS = {
    section: 'Workplace pension',
    annualAmount: 'Annual pension amount',
    startAge: 'Pension start age',
    indexed: 'Indexed to inflation',
    bridgeAmount: 'Bridge benefit',
    bridgeEndAge: 'Bridge ends at age',
};

type SetDraft = Dispatch<SetStateAction<SimulationInputs>>;
type Who = 'person' | 'spouse';
/** Turn the spouse on (restoring any stashed spouse) or off. Owned by OnboardingFlow. */
type ToggleSpouse = (on: boolean) => void;

export interface WizardStep {
    id: string;
    title: string;
    blurb: string;
    /**
     * Blocking inconsistencies for this step, given the draft. OnboardingFlow
     * both RENDERS these (one banner, above the step body) and GATES Next on
     * them, so the warning a user sees is by construction the thing stopping
     * them — the two can't drift apart the way per-field-group banners did.
     * Steps that collect nothing validatable return [].
     */
    errors: (draft: SimulationInputs) => string[];
    render: (draft: SimulationInputs, setDraft: SetDraft) => ReactNode;
}

/**
 * Person-step validator, scoped to the field group THIS step renders. Scoping is
 * load-bearing: a step must only block on problems the user can fix without
 * leaving it. Gating every person step on the whole person's errors instead
 * strands them — e.g. entering a current age of 70 on "About you" trips the melt
 * check against the default melt start of 60, whose field is four steps away.
 *
 * Nothing is lost by scoping: Save re-checks the whole draft and jumps to the
 * owning step, and every check belongs to exactly one scope.
 *
 * Spouse steps yield nothing when there's no spouse.
 */
const personErrors = (who: Who, scope: ValidationScope) => (d: SimulationInputs): string[] => {
    const target = who === 'person' ? d.person : d.spouse;
    return target ? getValidationErrors(target, scope) : [];
};

const noErrors = (): string[] => [];

// --- small update helpers bound to a person within the draft ------------------

function patchPerson(setDraft: SetDraft, who: Who, patch: Partial<Person>) {
    setDraft((d) => {
        const target = who === 'person' ? d.person : d.spouse;
        if (!target) return d;
        return { ...d, [who]: { ...target, ...patch } };
    });
}

// --- reusable per-person field groups (shared by person + spouse) -------------
// Each wraps the shared PersonFields.tsx group with this wizard's extras (income
// field, disclaimer/explanation copy) that don't belong in the shared component
// — see src/components/inputs/PersonFields.tsx and
// src/components/dashboard/PersonSection.tsx for the dashboard's equivalent
// wrapping of the same shared groups.
//
// Validation banners are deliberately NOT here: OnboardingFlow renders one
// banner per step from that step's `errors()`, which is the same function that
// gates Next. Adding a second banner inside a field group would reintroduce the
// drift where a step could warn about something that doesn't block, or block on
// something it never showed.

function AboutFields({ person, who, setDraft }: { person: Person; who: Who; setDraft: SetDraft }) {
    return (
        <div className="space-y-4">
            <SharedAboutFields person={person} labels={WIZARD_ABOUT_LABELS}
                onPatch={(patch) => patchPerson(setDraft, who, patch)} />
            <FinancialInput label="Annual income (before tax)" value={person.currentIncome}
                tooltip="Gross employment income in today's dollars, like your household spending. It is indexed at the plan's inflation rate for each year you keep working, so your pay holds its purchasing power rather than shrinking against rising costs."
                onChange={(e) => patchPerson(setDraft, who, { currentIncome: Number(e.target.value) })} />
        </div>
    );
}

function BenefitsFields({ person, who, setDraft }: { person: Person; who: Who; setDraft: SetDraft }) {
    return (
        <div className="space-y-4">
            <SharedBenefitsFields person={person} labels={WIZARD_BENEFITS_LABELS}
                onPatch={(patch) => patchPerson(setDraft, who, patch)} />
            <p className="text-xs text-slate-400">
                These are rough estimates. You can refine your CPP later with the CPP Calculator and feed the result back into your plan.
            </p>
        </div>
    );
}

function PensionFields({ person, who, setDraft }: { person: Person; who: Who; setDraft: SetDraft }) {
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-500">
                A defined-benefit pension pays a set amount for life from a former employer — common in
                government, healthcare, and education work. Leave the amount at 0 if you don't have one.
            </p>
            <SharedPensionFields person={person} labels={WIZARD_PENSION_LABELS} collapsible={false}
                onPatch={(patch) => patchPerson(setDraft, who, patch)} />
        </div>
    );
}

function AccountsFields({ person, who, setDraft }: { person: Person; who: Who; setDraft: SetDraft }) {
    return (
        <SharedAccountsFields person={person} isSpouse={who === 'spouse'}
            onPatch={(patch) => patchPerson(setDraft, who, patch)} />
    );
}

function SpouseToggleField({ draft, onToggleSpouse }: { draft: SimulationInputs; onToggleSpouse: ToggleSpouse }) {
    return (
        <div className="space-y-2 pt-2 border-t border-slate-100">
            <Toggle
                checked={!!draft.spouse}
                onChange={onToggleSpouse}
                label="Include a spouse / partner"
            />
            <p className="text-sm text-slate-500">
                {draft.spouse
                    ? "We've added a few extra steps later for your spouse's details. Turn this off to remove them."
                    : 'Leave this off to plan for just yourself.'}
            </p>
        </div>
    );
}

function MeltdownFields({ person, who, setDraft }: { person: Person; who: Who; setDraft: SetDraft }) {
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-500">
                An RRSP "meltdown" means deliberately withdrawing from your RRSP early — often between retirement and age 71 — to
                smooth out taxable income and avoid a large forced RRIF withdrawal later. Leave the amount at 0 to skip it.
            </p>
            <SharedMeltdownFields person={person} isSpouse={who === 'spouse'} labels={WIZARD_MELTDOWN_LABELS}
                onPatch={(patch) => patchPerson(setDraft, who, patch)} />
        </div>
    );
}

// --- the dynamic step list ----------------------------------------------------

/**
 * Build the ordered wizard steps for the detailed path. Spouse steps splice in
 * only when the draft has a spouse, so progress stays honest and toggling the
 * spouse on/off grows or shrinks the list. Rebuilt on every render (cheap), so
 * `draft` is only read here to decide the shape of the list; each step's
 * `render` receives the live draft + setter.
 */
export function buildDetailedSteps(draft: SimulationInputs, onToggleSpouse: ToggleSpouse): WizardStep[] {
    const steps: WizardStep[] = [
        {
            id: 'about-you',
            title: 'About you',
            blurb: 'Your age, when you plan to retire, and your income.',
            errors: personErrors('person', 'about'),
            render: (d, setDraft) => (
                <div className="space-y-4">
                    <AboutFields person={d.person} who="person" setDraft={setDraft} />
                    <SpouseToggleField draft={d} onToggleSpouse={onToggleSpouse} />
                </div>
            ),
        },
        {
            id: 'benefits-you',
            title: 'Government benefits',
            blurb: 'When you plan to start CPP and OAS.',
            errors: personErrors('person', 'benefits'),
            render: (d, setDraft) => <BenefitsFields person={d.person} who="person" setDraft={setDraft} />,
        },
        {
            id: 'pension-you',
            title: 'Workplace pension',
            blurb: 'A defined-benefit pension from an employer, if you have one.',
            errors: noErrors,
            render: (d, setDraft) => <PensionFields person={d.person} who="person" setDraft={setDraft} />,
        },
        {
            id: 'accounts-you',
            title: 'Your accounts',
            blurb: 'RRSP, TFSA, and any non-registered (taxable) accounts.',
            errors: noErrors,
            render: (d, setDraft) => <AccountsFields person={d.person} who="person" setDraft={setDraft} />,
        },
        {
            id: 'meltdown-you',
            title: 'Early RRSP withdrawals (optional)',
            blurb: 'Optionally draw down your RRSP early to smooth taxes.',
            errors: personErrors('person', 'meltdown'),
            render: (d, setDraft) => <MeltdownFields person={d.person} who="person" setDraft={setDraft} />,
        },
    ];

    if (draft.spouse) {
        steps.push(
            {
                id: 'about-spouse',
                title: 'About your spouse',
                blurb: "Your spouse's age, retirement age, and income.",
                errors: personErrors('spouse', 'about'),
                render: (d, setDraft) =>
                    d.spouse ? <AboutFields person={d.spouse} who="spouse" setDraft={setDraft} /> : null,
            },
            {
                id: 'benefits-spouse',
                title: "Spouse's government benefits",
                blurb: 'When your spouse plans to start CPP and OAS.',
                errors: personErrors('spouse', 'benefits'),
                render: (d, setDraft) =>
                    d.spouse ? <BenefitsFields person={d.spouse} who="spouse" setDraft={setDraft} /> : null,
            },
            {
                id: 'pension-spouse',
                title: "Spouse's workplace pension",
                blurb: "A defined-benefit pension from your spouse's employer, if they have one.",
                errors: noErrors,
                render: (d, setDraft) =>
                    d.spouse ? <PensionFields person={d.spouse} who="spouse" setDraft={setDraft} /> : null,
            },
            {
                id: 'accounts-spouse',
                title: "Spouse's accounts",
                blurb: "Your spouse's RRSP, TFSA, and non-registered accounts.",
                errors: noErrors,
                render: (d, setDraft) =>
                    d.spouse ? <AccountsFields person={d.spouse} who="spouse" setDraft={setDraft} /> : null,
            },
            {
                id: 'meltdown-spouse',
                title: "Spouse's early RRSP withdrawals (optional)",
                blurb: "Optionally draw down your spouse's RRSP early.",
                errors: personErrors('spouse', 'meltdown'),
                render: (d, setDraft) =>
                    d.spouse ? <MeltdownFields person={d.spouse} who="spouse" setDraft={setDraft} /> : null,
            },
        );
    }

    steps.push(
        {
            id: 'spending',
            title: 'Household spending',
            blurb: 'What you expect to spend each year, plus any one-time events.',
            errors: noErrors,
            render: (d, setDraft) => (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <FinancialInput label="Before retirement" value={d.preRetirementSpend}
                            onChange={(e) => setDraft((c) => ({ ...c, preRetirementSpend: Number(e.target.value) }))} />
                        <FinancialInput label="After retirement" value={d.postRetirementSpend}
                            onChange={(e) => setDraft((c) => ({ ...c, postRetirementSpend: Number(e.target.value) }))} />
                    </div>
                    <div className="pt-2 border-t border-slate-100">
                        <OneTimeSpendingInput
                            expenses={d.oneTimeExpenses || []}
                            onChange={(expenses) => setDraft((c) => ({ ...c, oneTimeExpenses: expenses }))}
                        />
                    </div>
                </div>
            ),
        },
        {
            id: 'assumptions',
            title: 'Assumptions',
            blurb: 'Sensible defaults — you can fine-tune them anytime.',
            errors: noErrors,
            render: (d, setDraft) => (
                <div className="space-y-4">
                    <AssumptionsFields inputs={d} onChange={(p) => setDraft((c) => ({ ...c, ...p }))} />
                </div>
            ),
        },
    );

    return steps;
}
