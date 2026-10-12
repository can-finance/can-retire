import { useEffect, useMemo, useRef, useState } from 'react';
import LZString from 'lz-string';
import { FinancialInput } from '../inputs/FinancialInput';
import { Toggle } from '../ui/Toggle';
import { PROVINCES } from '../../constants/provinces';
import { DEFAULT_SPEND } from '../../utils/inputSanitizer';
import { optimizeMeltdown } from '../../utils/meltdownOptimizer';
import type { MeltdownResult } from '../../utils/meltdownOptimizer';
import { EarliestAgeHeadline } from '../optimizer/EarliestAgeHeadline';
import { EarliestAgeTable } from '../optimizer/EarliestAgeTable';
import { describeStrategyChanges } from '../optimizer/strategySummary';
import { SUCCESS_TARGETS, DEFAULT_SUCCESS_TARGET } from '../optimizer/successTargets';
import { WHEN_CAN_I_RETIRE_FAQ_ITEMS } from './when-can-i-retire-faq';
import { buildRetireInputs, initialRetireForm, retireFormErrors } from './when-can-i-retire-inputs';
import type { RetireForm } from './when-can-i-retire-inputs';

/*
 * The /when-can-i-retire/ landing page: a short form, the "When can I retire?"
 * search (the optimizer's earliest-age objective), and the same answer box and
 * trade-off table the in-app optimizer shows, then a link that opens the plan
 * in the full planner.
 *
 * Prerendered at build time (src/prerender/when-can-i-retire-ssr.tsx), so the
 * render path must not touch window or localStorage: the form starts from the
 * planner's sample plan, and everything browser-only happens in event handlers
 * and effects.
 */

// Same Monte Carlo size as the optimizer and the dashboard.
const MC_ITERATIONS = 200;

// Pointer for the "no age works" messages: this page has no "Spend the most in
// retirement" goal, but spending is right there in the form.
const SPEND_TIP = 'try lower spending after retirement';

interface Answer {
    result: MeltdownResult;
    // The form and confidence bar the answer was found with, to tell when the
    // visitor has changed something since.
    key: string;
    // The target the answer is compared with (null = none was given).
    targetAge: number | null;
}

type RunStatus = { kind: 'idle' } | { kind: 'running'; pct: number } | { kind: 'error' };

const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:border-brand-500 focus:ring-brand-500';

const primaryBtn =
    'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-brand-600 text-white font-semibold text-base hover:bg-brand-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';

/*
 * An age field that may be left blank. FinancialInput always shows a number,
 * so the optional target gets its own small field with the same look and the
 * same whole-number rule (digits only, committed on blur or Enter).
 */
function OptionalAgeInput({ id, label, hint, value, onChange }: {
    id: string;
    label: string;
    hint: string;
    value: number | null;
    onChange: (v: number | null) => void;
}) {
    const [text, setText] = useState(value === null ? '' : String(value));

    const commit = () => {
        const t = text.trim();
        const next = t === '' ? null : Math.round(Number(t));
        if (next !== value) onChange(next);
        setText(next === null ? '' : String(next));
    };

    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-semibold text-slate-700">{label}</label>
            <input
                id={id}
                type="text"
                inputMode="numeric"
                maxLength={3}
                placeholder="Optional"
                value={text}
                onChange={(e) => { if (/^[0-9]*$/.test(e.target.value)) setText(e.target.value); }}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className={inputClass}
            />
            <p className="text-xs text-slate-500">{hint}</p>
        </div>
    );
}

/** "Workplace pension? $___/yr from age ___", for you or your spouse. */
function PensionFields({ who, on, amount, startAge, onToggle, onAmount, onStartAge }: {
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

export function WhenCanIRetire() {
    const [form, setForm] = useState<RetireForm>(initialRetireForm);
    const [successTarget, setSuccessTarget] = useState(DEFAULT_SUCCESS_TARGET);
    const [status, setStatus] = useState<RunStatus>({ kind: 'idle' });
    const [answer, setAnswer] = useState<Answer | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Abort an in-flight search when the page goes away.
    useEffect(() => () => abortRef.current?.abort(), []);

    const update = (patch: Partial<RetireForm>) => setForm((f) => ({ ...f, ...patch }));

    // Adding or removing a spouse also moves the household spending defaults
    // (see DEFAULT_SPEND) — but only while they still sit at the other size's
    // default, exactly like the dashboard's spouse toggle.
    const toggleSpouse = (on: boolean) => {
        const from = on ? DEFAULT_SPEND.single : DEFAULT_SPEND.couple;
        const to = on ? DEFAULT_SPEND.couple : DEFAULT_SPEND.single;
        setForm((f) => ({
            ...f,
            includeSpouse: on,
            preRetirementSpend: f.preRetirementSpend === from.pre ? to.pre : f.preRetirementSpend,
            postRetirementSpend: f.postRetirementSpend === from.post ? to.post : f.postRetirementSpend,
        }));
    };

    const errors = useMemo(() => retireFormErrors(form), [form]);
    const formKey = JSON.stringify([form, successTarget]);
    const stale = answer !== null && answer.key !== formKey;

    const run = () => {
        if (errors.length > 0) return;
        // A new run replaces any run still going.
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const key = formKey;
        const targetAge = form.targetAge;
        setAnswer(null);
        setStatus({ kind: 'running', pct: 0 });

        optimizeMeltdown(buildRetireInputs(form), {
            objective: 'earliest-age',
            mcIterations: MC_ITERATIONS,
            mcSuccessTarget: successTarget,
            signal: controller.signal,
            onProgress: (done, total) => {
                if (controller.signal.aborted) return;
                setStatus({ kind: 'running', pct: total > 0 ? Math.round((done / total) * 100) : 0 });
            },
        })
            .then((result) => {
                if (controller.signal.aborted) return;
                abortRef.current = null;
                setAnswer({ result, key, targetAge });
                setStatus({ kind: 'idle' });
            })
            .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                console.error('Earliest retirement age search failed', err);
                setStatus({ kind: 'error' });
            });
    };

    const ea = answer?.result.earliestAge ?? null;
    const found = ea?.status === 'found';

    // "To get there: …" only when there is something to change — the same rule
    // the optimizer uses (result.improved).
    const strategyNote = useMemo(() => {
        if (!answer || !answer.result.earliestAge || answer.result.earliestAge.status !== 'found' || !answer.result.improved) return null;
        const r = answer.result;
        return describeStrategyChanges(
            r.decisions,
            r.baselineInputs.withdrawalStrategy ?? 'tax-efficient',
            r.earliestAge!.withdrawalStrategy,
        );
    }, [answer]);

    // Handoff to the full planner: the dashboard's #start= share-link import,
    // which opens the plan as a new saved plan and leaves existing plans alone.
    // The plan at the answer age when there is something to change; otherwise
    // the plan as entered (it already works, or there is no answer to apply).
    const planHref = useMemo(() => {
        if (!answer) return null;
        const r = answer.result;
        const inputs = r.improved ? r.recommendedInputs : r.baselineInputs;
        return `/#start=${LZString.compressToEncodedURIComponent(JSON.stringify(inputs))}`;
    }, [answer]);

    const targetBlurb = SUCCESS_TARGETS.find((t) => t.value === successTarget)?.ageBlurb;

    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20">
            {/* Hero */}
            <section className="text-center space-y-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Canadian Retirement Asset Planning tool</p>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">When can I retire?</h1>
                <p className="max-w-2xl mx-auto text-lg text-slate-600 leading-relaxed">
                    Find the earliest age you can stop working and still have your money last. Enter your
                    age, savings and spending. It includes Canadian taxes, CPP and OAS, and tests your plan
                    in good and bad markets.
                </p>
                <p className="text-sm text-slate-500">
                    Free · No account/login needed · Runs entirely in your browser
                </p>
            </section>

            {/* Inputs */}
            <section className="bg-white rounded-3xl p-5 sm:p-8 shadow-sm border border-slate-100 space-y-8">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">Your numbers</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Enter amounts as they are today. We add inflation for you. Everything else, like
                        investment returns and a plan that runs to age 90, uses the full planner's defaults.
                        You can change them there.
                    </p>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">About you</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FinancialInput
                            label="Current age"
                            prefix=""
                            value={form.age}
                            onChange={(e) => update({ age: Math.round(Number(e.target.value)) })} maxFractionDigits={0} inputMode="numeric"
                        />
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="wcir-province" className="text-sm font-semibold text-slate-700">Province</label>
                            <select
                                id="wcir-province"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                                value={form.province}
                                onChange={(e) => update({ province: e.target.value })}
                            >
                                {PROVINCES.map((p) => (
                                    <option key={p.code} value={p.code}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <FinancialInput
                            label="Income before tax"
                            tooltip="Your yearly pay before tax, in today's dollars. It rises with inflation each year until you retire."
                            value={form.currentIncome}
                            onChange={(e) => update({ currentIncome: Number(e.target.value) })}
                        />
                        <OptionalAgeInput
                            id="wcir-target"
                            label="Your target retirement age (to compare)"
                            hint="Leave blank if you don't have one."
                            value={form.targetAge}
                            onChange={(v) => update({ targetAge: v })}
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Your savings</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <FinancialInput label="RRSP" value={form.rrsp}
                            onChange={(e) => update({ rrsp: Number(e.target.value) })} />
                        <FinancialInput label="TFSA" value={form.tfsa}
                            onChange={(e) => update({ tfsa: Number(e.target.value) })} />
                        <FinancialInput
                            label="Non-registered"
                            tooltip="Taxable investment accounts. We assume half the balance is what you originally put in and half is growth. You can change this in the full planner."
                            value={form.nonReg}
                            onChange={(e) => update({ nonReg: Number(e.target.value) })}
                        />
                    </div>
                    <PensionFields
                        who="you"
                        on={form.hasPension}
                        amount={form.pensionAmount}
                        startAge={form.pensionStartAge}
                        onToggle={(v) => update({ hasPension: v })}
                        onAmount={(v) => update({ pensionAmount: v })}
                        onStartAge={(v) => update({ pensionStartAge: v })}
                    />
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Household spending per year</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FinancialInput label="Before retirement" value={form.preRetirementSpend}
                            onChange={(e) => update({ preRetirementSpend: Number(e.target.value) })} />
                        <FinancialInput
                            label="After retirement"
                            tooltip="What you plan to spend each year once retired, in today's dollars. It rises with inflation. The calculator keeps this the same and finds the age instead."
                            value={form.postRetirementSpend}
                            onChange={(e) => update({ postRetirementSpend: Number(e.target.value) })}
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <Toggle
                        checked={form.includeSpouse}
                        onChange={toggleSpouse}
                        label="Include a spouse / partner"
                    />
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

                {/* Confidence bar */}
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
                                onClick={() => setSuccessTarget(t.value)}
                                aria-pressed={successTarget === t.value}
                                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                                    successTarget === t.value
                                        ? 'bg-brand-600 text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-100'
                                }`}
                            >
                                {t.label} ({t.value}%)
                            </button>
                        ))}
                    </div>
                    {targetBlurb && <p className="text-xs text-slate-500">{targetBlurb}</p>}
                </div>

                {errors.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert">
                        <ul className="space-y-1 text-sm text-amber-900">
                            {errors.map((e) => <li key={e}>{e}</li>)}
                        </ul>
                    </div>
                )}

                <div className="space-y-3">
                    <button type="button" onClick={run} disabled={errors.length > 0} className={primaryBtn}>
                        Find my earliest retirement age
                    </button>
                    {status.kind === 'running' ? (
                        <div className="max-w-md">
                            <p className="text-sm font-medium text-slate-700">Searching for your earliest retirement age…</p>
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
                    ) : status.kind === 'error' ? (
                        <p className="text-sm text-rose-600">Something went wrong running the calculator. Please try again.</p>
                    ) : (
                        <p className="text-xs text-slate-500">Takes a few seconds.</p>
                    )}
                </div>
            </section>

            {/* Answer */}
            {answer && ea && (
                <section className="space-y-6" aria-live="polite">
                    <h2 className="text-2xl font-bold text-slate-900">Your answer</h2>
                    {stale && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                            You've changed your numbers since this answer. Run the calculator again to update it.
                        </div>
                    )}
                    <div className={`space-y-6 ${stale ? 'opacity-60' : ''}`}>
                        <EarliestAgeHeadline
                            result={ea}
                            strategyNote={strategyNote}
                            compareTo={answer.targetAge !== null ? 'target' : 'none'}
                            spendTip={SPEND_TIP}
                        />

                        {found && (
                            <div className="rounded-2xl bg-white p-5 sm:p-6 shadow-sm border border-slate-100">
                                <h3 className="text-lg font-bold text-slate-900">Retiring earlier or later</h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    How your odds and the numbers change around your answer, at the same spending.
                                </p>
                                <div className="mt-4">
                                    <EarliestAgeTable
                                        result={ea}
                                        planLabel={answer.targetAge !== null ? 'your target' : null}
                                    />
                                </div>
                            </div>
                        )}

                        {planHref && (
                            <div className="space-y-2">
                                <a href={planHref} className={primaryBtn}>
                                    {found ? 'See the full plan' : 'Open in the full planner'}
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                                    </svg>
                                </a>
                                <p className="text-xs text-slate-500">
                                    Opens this plan in the full planner as a new plan, with charts and a
                                    year-by-year table. Plans you already have there stay as they are.
                                </p>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {/* How this works */}
            <section className="bg-white rounded-3xl p-5 sm:p-8 shadow-sm border border-slate-100 space-y-4">
                <h2 className="text-2xl font-bold text-slate-900">How this works</h2>
                <div className="max-w-none text-base text-slate-600 leading-relaxed space-y-4">
                    <p>
                        The calculator builds a full retirement plan from your numbers and works through it one
                        year at a time, with federal and provincial tax, CPP, OAS and the OAS clawback. Then it
                        looks for your age in two steps:
                    </p>
                    <ol className="list-decimal pl-6 space-y-2">
                        <li>
                            <strong>Average returns first.</strong> It finds the earliest age at which your money
                            lasts to the end of the plan if investments earn their average return every year. At
                            each age it tries different choices:
                            <ul className="list-disc pl-6 mt-1 space-y-1">
                                <li>when to start CPP</li>
                                <li>when to start OAS</li>
                                <li>early RRSP withdrawals</li>
                                <li>which accounts to take money from first</li>
                            </ul>
                            <span className="block mt-1">
                                It keeps the mix that works and leaves the most at the end.
                            </span>
                        </li>
                        <li>
                            <strong>Then market simulations.</strong> Real returns go up and down. It runs that age
                            through hundreds of market simulations. If your money doesn't last in enough of them
                            to meet the confidence you chose, it tries later ages (up to 75) until it does.
                        </li>
                    </ol>
                    <p>A few things to know:</p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li>Retirement ages are whole years.</li>
                        <li>
                            Your CPP moves with your retirement age. Retiring earlier means fewer years paying
                            in, and only years before 65 count.
                        </li>
                        <li>
                            A workplace pension is held as you entered it. It doesn't get smaller if you retire
                            earlier, so check your pension statement for the amount at the age you're looking at.
                        </li>
                        <li>Your spending stays the same every year of retirement, rising with inflation.</li>
                        <li>With a spouse, both retirement ages move by the same number of years.</li>
                    </ul>
                </div>
            </section>

            {/* FAQ */}
            <section className="bg-white rounded-3xl p-5 sm:p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900">Frequently asked questions</h2>
                <div className="space-y-6">
                    {WHEN_CAN_I_RETIRE_FAQ_ITEMS.map(({ question, answer: text }) => (
                        <div key={question} className="space-y-2">
                            <h3 className="font-bold text-slate-900">{question}</h3>
                            <p className="text-slate-600 leading-relaxed">{text}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Disclaimer */}
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
        </div>
    );
}
