import { FinancialInput } from './FinancialInput';
import { NonRegAccountsInput } from './NonRegAccountsInput';
import { CHART_COLORS } from '../../constants/chartColors';
import type { Person, NonRegisteredAccount } from '../../engine/types';

// Shared per-person field groups, consumed by both the dashboard's PersonSection
// (src/components/dashboard/PersonSection.tsx) and the onboarding wizard's
// detailed-path steps (src/components/onboarding/detailedSteps.tsx). The two
// contexts use different label wording (dashboard: terse, all-caps-ish column
// headers; wizard: sentence case, spoken to the user one step at a time), so
// labels are passed in by the caller rather than hardcoded here.
//
// Each caller stays responsible for anything NOT listed below (validation
// banners, explanatory paragraphs, the CPP-calculator upsell, the income
// field, etc.) — these components are only the field grids themselves.

export interface AboutFieldsLabels {
    age: string;
    retirementAge: string;
    lifeExpectancy: string;
}

export function AboutFields({
    person,
    onPatch,
    labels,
    gridClassName = 'grid grid-cols-3 gap-3',
}: {
    person: Person;
    onPatch: (patch: Partial<Person>) => void;
    labels: AboutFieldsLabels;
    /** Dashboard and wizard use different grid gaps for this row. */
    gridClassName?: string;
}) {
    return (
        <div className={gridClassName}>
            <FinancialInput label={labels.age} prefix="" value={person.age}
                onChange={(e) => onPatch({ age: Number(e.target.value) })} />
            <FinancialInput label={labels.retirementAge} prefix="" value={person.retirementAge}
                onChange={(e) => onPatch({ retirementAge: Number(e.target.value) })} />
            <FinancialInput label={labels.lifeExpectancy} prefix="" value={person.lifeExpectancy}
                onChange={(e) => onPatch({ lifeExpectancy: Number(e.target.value) })}
                tooltip="The age the plan runs to. Assets are projected until this age, then estate/terminal tax is calculated." />
        </div>
    );
}

export interface BenefitsFieldsLabels {
    cppStartAge: string;
    yearsContributed: string;
    oasStartAge: string;
}

export function BenefitsFields({
    person,
    onPatch,
    labels,
}: {
    person: Person;
    onPatch: (patch: Partial<Person>) => void;
    labels: BenefitsFieldsLabels;
}) {
    return (
        <div className="grid grid-cols-3 gap-3">
            <FinancialInput label={labels.cppStartAge} prefix="" value={person.cppStartAge}
                onChange={(e) => onPatch({ cppStartAge: Number(e.target.value) })}
                tooltip="Between 60 and 70. Starting later increases the monthly amount." />
            <FinancialInput label={labels.yearsContributed} prefix="" value={person.cppContributedYears ?? 35}
                onChange={(e) => onPatch({ cppContributedYears: Number(e.target.value) })}
                tooltip="Years you paid into CPP. The plan estimates CPP as Years Contributed ÷ 40 of the maximum." />
            <FinancialInput label={labels.oasStartAge} prefix="" value={person.oasStartAge}
                onChange={(e) => onPatch({ oasStartAge: Number(e.target.value) })}
                tooltip="Between 65 and 70. Starting later increases the monthly amount." />
        </div>
    );
}

export function AccountsFields({
    person,
    isSpouse,
    onPatch,
    driftSummary,
}: {
    person: Person;
    isSpouse: boolean;
    onPatch: (patch: Partial<Person>) => void;
    /** One-line drift readout for this person's non-registered accounts (dashboard only). */
    driftSummary?: string | null;
}) {
    const rrspColor = isSpouse ? CHART_COLORS.spRrsp : CHART_COLORS.rrsp;
    const tfsaColor = isSpouse ? CHART_COLORS.spTfsa : CHART_COLORS.tfsa;
    const nonRegColor = isSpouse ? CHART_COLORS.spNonReg : CHART_COLORS.nonReg;
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <FinancialInput label="RRSP" value={person.rrsp.balance} accentColor={rrspColor}
                    onChange={(e) => onPatch({ rrsp: { ...person.rrsp, balance: Number(e.target.value) } })} />
                <FinancialInput label="TFSA" value={person.tfsa.balance} accentColor={tfsaColor}
                    onChange={(e) => onPatch({ tfsa: { ...person.tfsa, balance: Number(e.target.value) } })} />
            </div>
            <NonRegAccountsInput
                accounts={person.nonRegisteredAccounts}
                onChange={(accounts: NonRegisteredAccount[]) => onPatch({ nonRegisteredAccounts: accounts })}
                accentColor={nonRegColor}
                driftSummary={driftSummary}
            />
        </div>
    );
}

export interface MeltdownFieldsLabels {
    meltStartAge: string;
    meltAmount: string;
}

export function MeltdownFields({
    person,
    isSpouse,
    onPatch,
    labels,
}: {
    person: Person;
    isSpouse: boolean;
    onPatch: (patch: Partial<Person>) => void;
    labels: MeltdownFieldsLabels;
}) {
    const rrspColor = isSpouse ? CHART_COLORS.spRrsp : CHART_COLORS.rrsp;
    return (
        <div className="grid grid-cols-2 gap-4">
            <FinancialInput label={labels.meltStartAge} prefix="" accentColor={rrspColor}
                value={person.rrspMeltStartAge || person.retirementAge}
                onChange={(e) => onPatch({ rrspMeltStartAge: Number(e.target.value) })}
                tooltip="Age to begin deliberate early RRSP withdrawals. Melt automatically stops at age 71 (before mandatory RRIF conversion at 72)." />
            <FinancialInput label={labels.meltAmount} accentColor={rrspColor}
                value={person.rrspMeltAmount || 0}
                onChange={(e) => onPatch({ rrspMeltAmount: Number(e.target.value) })}
                tooltip="Annual amount to withdraw from RRSP from the start age until age 71." />
        </div>
    );
}
