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
} from '../inputs/PersonFields';
import { Toggle } from '../ui/Toggle';
import { ValidationBanner } from '../ui/ValidationBanner';
import { getValidationErrors } from '../../utils/personValidation';
import type { Person, SimulationInputs } from '../../engine/types';

// Wizard label wording — sentence case, spoken to the user one step at a time
// (see ABOUT_LABELS etc. in ../dashboard/PersonSection.tsx for the dashboard's
// terser equivalents).
const WIZARD_ABOUT_LABELS = { age: 'Current age', retirementAge: 'Retirement age', lifeExpectancy: 'Life expectancy' };
const WIZARD_BENEFITS_LABELS = { cppStartAge: 'CPP start age', yearsContributed: 'Years contributed', oasStartAge: 'OAS start age' };
const WIZARD_MELTDOWN_LABELS = { meltStartAge: 'Melt start age', meltAmount: 'Melt amount per year' };

type SetDraft = Dispatch<SetStateAction<SimulationInputs>>;
type Who = 'person' | 'spouse';
/** Turn the spouse on (restoring any stashed spouse) or off. Owned by OnboardingFlow. */
type ToggleSpouse = (on: boolean) => void;

export interface WizardStep {
    id: string;
    title: string;
    blurb: string;
    render: (draft: SimulationInputs, setDraft: SetDraft) => ReactNode;
}

// --- small update helpers bound to a person within the draft ------------------

function patchPerson(setDraft: SetDraft, who: Who, patch: Partial<Person>) {
    setDraft((d) => {
        const target = who === 'person' ? d.person : d.spouse;
        if (!target) return d;
        return { ...d, [who]: { ...target, ...patch } };
    });
}

// --- reusable per-person field groups (shared by person + spouse) -------------
// Each wraps the shared PersonFields.tsx group with this wizard's extras
// (validation banner, income field, disclaimer/explanation copy) that don't
// belong in the shared component — see src/components/inputs/PersonFields.tsx
// and src/components/dashboard/PersonSection.tsx for the dashboard's equivalent
// wrapping of the same shared groups.

function AboutFields({ person, who, setDraft }: { person: Person; who: Who; setDraft: SetDraft }) {
    return (
        <div className="space-y-4">
            <ValidationBanner errors={getValidationErrors(person)} />
            <SharedAboutFields person={person} labels={WIZARD_ABOUT_LABELS}
                onPatch={(patch) => patchPerson(setDraft, who, patch)} />
            <FinancialInput label="Annual income (before tax)" value={person.currentIncome}
                onChange={(e) => patchPerson(setDraft, who, { currentIncome: Number(e.target.value) })} />
        </div>
    );
}

function BenefitsFields({ person, who, setDraft }: { person: Person; who: Who; setDraft: SetDraft }) {
    return (
        <div className="space-y-4">
            <ValidationBanner errors={getValidationErrors(person)} />
            <SharedBenefitsFields person={person} labels={WIZARD_BENEFITS_LABELS}
                onPatch={(patch) => patchPerson(setDraft, who, patch)} />
            <p className="text-xs text-slate-400">
                These are rough estimates. You can refine your CPP later with the CPP Calculator and feed the result back into your plan.
            </p>
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
                    ? "We've added a few extra steps later on for your spouse's details. Turn this off to remove them."
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
            render: (d, setDraft) => <BenefitsFields person={d.person} who="person" setDraft={setDraft} />,
        },
        {
            id: 'accounts-you',
            title: 'Your accounts',
            blurb: 'RRSP, TFSA, and any non-registered (taxable) accounts.',
            render: (d, setDraft) => <AccountsFields person={d.person} who="person" setDraft={setDraft} />,
        },
        {
            id: 'meltdown-you',
            title: 'Early RRSP withdrawals (optional)',
            blurb: 'Optionally draw down your RRSP early to smooth taxes.',
            render: (d, setDraft) => <MeltdownFields person={d.person} who="person" setDraft={setDraft} />,
        },
    ];

    if (draft.spouse) {
        steps.push(
            {
                id: 'about-spouse',
                title: 'About your spouse',
                blurb: "Your spouse's age, retirement age, and income.",
                render: (d, setDraft) =>
                    d.spouse ? <AboutFields person={d.spouse} who="spouse" setDraft={setDraft} /> : null,
            },
            {
                id: 'benefits-spouse',
                title: "Spouse's government benefits",
                blurb: 'When your spouse plans to start CPP and OAS.',
                render: (d, setDraft) =>
                    d.spouse ? <BenefitsFields person={d.spouse} who="spouse" setDraft={setDraft} /> : null,
            },
            {
                id: 'accounts-spouse',
                title: "Spouse's accounts",
                blurb: "Your spouse's RRSP, TFSA, and non-registered accounts.",
                render: (d, setDraft) =>
                    d.spouse ? <AccountsFields person={d.spouse} who="spouse" setDraft={setDraft} /> : null,
            },
            {
                id: 'meltdown-spouse',
                title: "Spouse's early RRSP withdrawals (optional)",
                blurb: "Optionally draw down your spouse's RRSP early.",
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
            blurb: 'Defaults are reasonable — you can fine-tune anytime later.',
            render: (d, setDraft) => (
                <div className="space-y-4">
                    <AssumptionsFields inputs={d} onChange={(p) => setDraft((c) => ({ ...c, ...p }))} />
                </div>
            ),
        },
    );

    return steps;
}
