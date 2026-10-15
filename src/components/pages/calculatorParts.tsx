import { useMemo, useState } from 'react';
import type { SimulationInputs } from '../../engine/types';
import { FinancialInput } from '../inputs/FinancialInput';
import { formatCurrencyApprox } from '../../utils/formatters';
import { preRetirementDeficit } from '../../utils/preRetirementDeficit';
import { Toggle } from '../ui/Toggle';
import { spendForSpouseToggle, spouseToggleSpendNote } from '../../utils/inputSanitizer';
import { SUCCESS_TARGETS } from '../optimizer/successTargets';
import type { CalculatorForm } from './when-can-i-retire-inputs';

/*
 * The pieces the landing-page calculators share (/when-can-i-retire/ and
 * /how-much-do-i-need-to-retire/): same fields, same words, so the two pages
 * can't drift apart. Everything here renders during prerender, so none of it
 * may touch window or localStorage.
 */

/** The big blue call-to-action button look (the Run button and the plan link). */
export const primaryBtn =
    'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-brand-600 text-white font-semibold text-base hover:bg-brand-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';

/** "Workplace pension? $___/yr from age ___", for you or your spouse. */
export function PensionFields({ who, on, amount, startAge, onToggle, onAmount, onStartAge }: {
    who: 'you' | 'spouse';
    on: boolean;
    amount: number;
    startAge: number;
    onToggle: (v: boolean) => void;
    onAmount: (v: number) => void;
    onStartAge: (v: number) => void;
}) {
    return (
        <div>
            <Toggle
                checked={on}
                onChange={onToggle}
                label={who === 'you' ? 'I have a workplace pension' : 'My spouse has a workplace pension'}
                tooltip="A defined benefit pension from an employer: a set amount paid every year for life. Leave this off for a group RRSP or a defined contribution plan, and add those savings to the RRSP box instead."
            />
            {on && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FinancialInput
                        label="Pension per year"
                        tooltip="Before tax, in today's dollars, at the age it starts. It's held as entered: it doesn't get smaller if you retire earlier."
                        value={amount}
                        onChange={(e) => onAmount(Number(e.target.value))}
                    />
                    <FinancialInput
                        label="Starts at age"
                        prefix=""
                        min={40}
                        max={80}
                        value={startAge}
                        onChange={(e) => onStartAge(Math.round(Number(e.target.value)))} maxFractionDigits={0} inputMode="numeric"
                    />
                </div>
            )}
        </div>
    );
}

type SpouseFormFields = Pick<CalculatorForm,
    | 'includeSpouse' | 'spouseAge' | 'spouseIncome'
    | 'spouseRrsp' | 'spouseTfsa' | 'spouseNonReg'
    | 'spouseHasPension' | 'spousePensionAmount' | 'spousePensionStartAge'
    | 'preRetirementSpend' | 'postRetirementSpend'>;

/**
 * The "Include a spouse / partner" switch and, when it's on, the spouse's
 * fields and note. Adding or removing a spouse also moves the household
 * spending defaults (see spendForSpouseToggle) — but only while both still sit
 * at the other size's defaults, exactly like the dashboard's spouse toggle —
 * and says so under the switch until either spending figure is edited.
 */
export function SpouseSection({ form, update }: {
    form: SpouseFormFields;
    update: (patch: Partial<SpouseFormFields>) => void;
}) {
    const [spendNote, setSpendNote] = useState<{ pre: number; post: number; text: string } | null>(null);
    const toggleSpouse = (on: boolean) => {
        const spend = spendForSpouseToggle(form.preRetirementSpend, form.postRetirementSpend, on);
        setSpendNote(spend.swapped ? { pre: spend.pre, post: spend.post, text: spouseToggleSpendNote(on) } : null);
        update({
            includeSpouse: on,
            preRetirementSpend: spend.pre,
            postRetirementSpend: spend.post,
        });
    };
    // Shown only while both figures still equal what the toggle set.
    const showSpendNote = spendNote !== null
        && form.preRetirementSpend === spendNote.pre
        && form.postRetirementSpend === spendNote.post;

    return (
        <div className="space-y-4">
            <Toggle
                checked={form.includeSpouse}
                onChange={toggleSpouse}
                label="Include a spouse / partner"
            />
            {showSpendNote && (
                <div role="status" className="flex items-start justify-between gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-sky-800">{spendNote!.text}</p>
                    <button
                        type="button"
                        onClick={() => setSpendNote(null)}
                        className="text-xs font-medium text-sky-600 hover:text-sky-800 underline decoration-dotted whitespace-nowrap"
                    >
                        Dismiss
                    </button>
                </div>
            )}
            {form.includeSpouse && (
                <div className="space-y-4 rounded-2xl bg-slate-50 border border-slate-100 p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FinancialInput
                            label="Spouse's age"
                            prefix=""
                            value={form.spouseAge}
                            onChange={(e) => update({ spouseAge: Math.round(Number(e.target.value)) })} maxFractionDigits={0} inputMode="numeric"
                        />
                        <FinancialInput
                            label="Spouse's income before tax"
                            value={form.spouseIncome}
                            onChange={(e) => update({ spouseIncome: Number(e.target.value) })}
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <FinancialInput label="Spouse's RRSP" value={form.spouseRrsp}
                            onChange={(e) => update({ spouseRrsp: Number(e.target.value) })} />
                        <FinancialInput label="Spouse's TFSA" value={form.spouseTfsa}
                            onChange={(e) => update({ spouseTfsa: Number(e.target.value) })} />
                        <FinancialInput label="Spouse's non-registered" value={form.spouseNonReg}
                            onChange={(e) => update({ spouseNonReg: Number(e.target.value) })} />
                    </div>
                    <PensionFields
                        who="spouse"
                        on={form.spouseHasPension}
                        amount={form.spousePensionAmount}
                        startAge={form.spousePensionStartAge}
                        onToggle={(v) => update({ spouseHasPension: v })}
                        onAmount={(v) => update({ spousePensionAmount: v })}
                        onStartAge={(v) => update({ spousePensionStartAge: v })}
                    />
                    <p className="text-xs text-slate-500 leading-relaxed">
                        If your spouse has income, we assume they stop working at the same age as you
                        (or now, if they're already past it). If they have no income, we treat them as
                        already retired. You can set different ages in the full planner.
                    </p>
                </div>
            )}
        </div>
    );
}

/**
 * "How sure do you want to be?": the Some risk / Balanced / Very safe bar
 * (the Monte Carlo success target). `blurb` is the one-line explanation of the
 * selected option, in the page's own framing (see successTargets.ts).
 */
export function ConfidencePicker({ value, onChange, blurb }: {
    value: number;
    onChange: (v: number) => void;
    blurb?: string;
}) {
    return (
        <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">How sure do you want to be?</p>
            <p className="text-xs text-slate-500">
                We run your plan through hundreds of market simulations, some good and some bad. In
                what share of them should your money last?
            </p>
            <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-fit max-w-full">
                {SUCCESS_TARGETS.map((t) => (
                    <button
                        key={t.value}
                        type="button"
                        onClick={() => onChange(t.value)}
                        aria-pressed={value === t.value}
                        className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                            value === t.value
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        {t.label} ({t.value}%)
                    </button>
                ))}
            </div>
            {blurb && <p className="text-xs text-slate-500">{blurb}</p>}
        </div>
    );
}

/** Below this, spending over take-home pay is rounding, not worth a note. */
const SPEND_OVER_PAY_MIN = 1_000;

/**
 * A soft note under "Before retirement" when that spending is more than the
 * household's take-home pay: the calculator draws the difference from savings
 * every working year. Not an error — the run still goes ahead. `plan` is null
 * while the form has errors.
 */
export function SpendOverPayNote({ plan }: { plan: SimulationInputs | null }) {
    const d = useMemo(() => (plan ? preRetirementDeficit(plan) : null), [plan]);
    if (!d || d.deficit <= SPEND_OVER_PAY_MIN) return null;
    return (
        <p className="text-xs text-amber-800 leading-relaxed">
            That's about {formatCurrencyApprox(d.deficit)} more than your take-home pay of
            about {formatCurrencyApprox(d.takeHome)}. The calculator takes the difference from your
            savings each year until you retire.
        </p>
    );
}

export type RunStatus = { kind: 'idle' } | { kind: 'running'; pct: number } | { kind: 'error' };

/**
 * What sits under the Run button: a progress bar while the search runs, an
 * error line if it failed, otherwise a short hint. `runningLabel` is the
 * sentence above the bar ("Searching for your earliest retirement age…").
 */
export function RunStatusBlock({ status, runningLabel, idleHint = 'Takes a few seconds.' }: {
    status: RunStatus;
    runningLabel: string;
    idleHint?: string;
}) {
    if (status.kind === 'running') {
        return (
            <div className="max-w-md">
                <p className="text-sm font-medium text-slate-700">{runningLabel}</p>
                <div
                    className="mt-2 h-2.5 w-full rounded-full bg-slate-100 overflow-hidden"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={status.pct}
                    aria-label="Search progress"
                >
                    <div
                        className="h-full rounded-full bg-brand-500 transition-all duration-150"
                        style={{ width: `${status.pct}%` }}
                    />
                </div>
                <p className="mt-1 text-xs text-slate-500">{status.pct}%</p>
            </div>
        );
    }
    if (status.kind === 'error') {
        return <p className="text-sm text-rose-600">Something went wrong running the calculator. Please try again.</p>;
    }
    return <p className="text-xs text-slate-500">{idleHint}</p>;
}

/** The "Educational information, not advice" box at the foot of each page. */
export function EducationalDisclaimer() {
    return (
        <section className="pt-8 border-t border-slate-200">
            <div className="bg-slate-50 rounded-2xl p-5 sm:p-8 border border-slate-200">
                <p className="text-sm text-slate-500 uppercase tracking-widest font-bold mb-4">Educational information, not advice</p>
                <div className="text-xs text-slate-500 leading-relaxed space-y-4">
                    <p>
                        This page and calculator are provided for general educational and informational purposes
                        only. They do not constitute financial, investment, tax, or legal advice, and no
                        personalized recommendation is being made to you. The tool uses simplified models that
                        may not reflect your full situation.
                    </p>
                    <p>
                        Projections are hypothetical and are not guarantees of future results. Tax rules, contribution
                        and benefit thresholds, and government programs change over time. Always consult a certified
                        financial planner, qualified tax professional, or legal advisor before making retirement
                        decisions.{' '}
                        <a
                            href="/how-it-works/#full-disclaimer"
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-700 transition-colors"
                        >
                            Full disclaimer
                        </a>
                    </p>
                </div>
            </div>
        </section>
    );
}
