import { useEffect, useMemo, useRef, useState } from 'react';
import LZString from 'lz-string';
import { FinancialInput } from '../inputs/FinancialInput';
import { PROVINCES } from '../../constants/provinces';
import { buildStartHash } from '../../utils/shareLink';
import { optimizeMeltdown } from '../../utils/meltdownOptimizer';
import type { MeltdownResult } from '../../utils/meltdownOptimizer';
import { SavingsNeededHeadline } from '../optimizer/SavingsNeededHeadline';
import { SUCCESS_TARGETS, DEFAULT_SUCCESS_TARGET } from '../optimizer/successTargets';
import {
    ConfidencePicker,
    EducationalDisclaimer,
    PensionFields,
    RunStatusBlock,
    SpouseSection,
    primaryBtn,
} from './calculatorParts';
import type { RunStatus } from './calculatorParts';
import { HOW_MUCH_DO_I_NEED_FAQ_ITEMS } from './how-much-do-i-need-faq';
import { needHandoff } from './how-much-do-i-need-handoff';
import { buildNeedInputs, initialNeedForm, needFormErrors } from './how-much-do-i-need-inputs';
import type { NeedForm } from './how-much-do-i-need-inputs';

/*
 * The /how-much-do-i-need-to-retire/ landing page: a short form with the
 * retirement age as an input, the "How much do I need?" search (the
 * optimizer's savings-needed objective) at the confidence the visitor picks,
 * the same answer box the in-app optimizer shows, then a link that opens the
 * plan in the full planner. The sibling of /when-can-i-retire/, which finds the
 * age instead.
 *
 * Prerendered at build time (src/prerender/how-much-do-i-need-ssr.tsx), so the
 * render path must not touch window or localStorage: the form starts from the
 * planner's sample plan, and everything browser-only happens in event handlers
 * and effects.
 */

// Same Monte Carlo size as the optimizer and the dashboard.
const MC_ITERATIONS = 200;

// Pointer for the "no amount works" messages: this page has no optimizer
// goals to send people to, but spending and the retirement age are right there
// in the form.
const SPEND_TIP = 'try lower spending after retirement or a later retirement age';

interface Answer {
    result: MeltdownResult;
    // The form and confidence bar the answer was found with, to tell when the
    // visitor has changed something since.
    key: string;
}

export function HowMuchDoINeed() {
    const [form, setForm] = useState<NeedForm>(initialNeedForm);
    const [successTarget, setSuccessTarget] = useState(DEFAULT_SUCCESS_TARGET);
    const [status, setStatus] = useState<RunStatus>({ kind: 'idle' });
    const [answer, setAnswer] = useState<Answer | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Abort an in-flight search when the page goes away.
    useEffect(() => () => abortRef.current?.abort(), []);

    const update = (patch: Partial<NeedForm>) => setForm((f) => ({ ...f, ...patch }));

    const errors = useMemo(() => needFormErrors(form), [form]);
    const formKey = JSON.stringify([form, successTarget]);
    const stale = answer !== null && answer.key !== formKey;

    const run = () => {
        if (errors.length > 0) return;
        // A new run replaces any run still going.
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const key = formKey;
        setAnswer(null);
        setStatus({ kind: 'running', pct: 0 });

        optimizeMeltdown(buildNeedInputs(form), {
            objective: 'savings-needed',
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
                setAnswer({ result, key });
                setStatus({ kind: 'idle' });
            })
            .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                console.error('Savings needed search failed', err);
                setStatus({ kind: 'error' });
            });
    };

    // Handoff to the full planner: the dashboard's #start= share-link import,
    // which opens the plan as a new saved plan and leaves existing plans alone.
    // Which plan, and its name, are needHandoff's call.
    const handoff = useMemo(() => {
        if (!answer) return null;
        const h = needHandoff(answer.result);
        if (!h) return null;
        return {
            href: `/${buildStartHash(LZString.compressToEncodedURIComponent(JSON.stringify(h.inputs)), h.name)}`,
            label: h.buttonLabel,
        };
    }, [answer]);

    const sn = answer?.result.savingsNeeded ?? null;

    const targetBlurb = SUCCESS_TARGETS.find((t) => t.value === successTarget)?.savingsBlurb;

    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20">
            {/* Hero */}
            <section className="text-center space-y-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Canadian Retirement Asset Planning tool</p>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">How much do I need to retire?</h1>
                <p className="max-w-2xl mx-auto text-lg text-slate-600 leading-relaxed">
                    Find the savings you need to stop working at the age you choose and still have your
                    money last. Enter your age, retirement age and spending. It includes Canadian taxes,
                    CPP and OAS, and tests your plan in good and bad markets.
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
                            <label htmlFor="hmdin-province" className="text-sm font-semibold text-slate-700">Province</label>
                            <select
                                id="hmdin-province"
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
                        <FinancialInput
                            label="Retirement age"
                            tooltip="The age you plan to stop working. It stays fixed: the calculator finds the savings instead. Enter your current age to see what you would need to retire now."
                            prefix=""
                            value={form.retirementAge}
                            onChange={(e) => update({ retirementAge: Math.round(Number(e.target.value)) })} maxFractionDigits={0} inputMode="numeric"
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">What you have saved now</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                        Leave a box at 0 if it doesn't apply, even all three. The answer keeps the mix you
                        enter here.
                    </p>
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
                        <FinancialInput
                            label="Before retirement"
                            tooltip="What you spend each year while you're still working, in today's dollars. The planner saves whatever is left of your pay after tax and this spending."
                            value={form.preRetirementSpend}
                            onChange={(e) => update({ preRetirementSpend: Number(e.target.value) })}
                        />
                        <FinancialInput
                            label="After retirement"
                            tooltip="What you plan to spend each year once retired, in today's dollars. It rises with inflation. The calculator keeps this the same and finds the savings instead."
                            value={form.postRetirementSpend}
                            onChange={(e) => update({ postRetirementSpend: Number(e.target.value) })}
                        />
                    </div>
                </div>

                <SpouseSection form={form} update={update} />

                <ConfidencePicker value={successTarget} onChange={setSuccessTarget} blurb={targetBlurb} />

                {errors.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert">
                        <ul className="space-y-1 text-sm text-amber-900">
                            {errors.map((e) => <li key={e}>{e}</li>)}
                        </ul>
                    </div>
                )}

                <div className="space-y-3">
                    <button type="button" onClick={run} disabled={errors.length > 0} className={primaryBtn}>
                        Find how much I need
                    </button>
                    <RunStatusBlock status={status} runningLabel="Finding how much you need…" />
                </div>
            </section>

            {/* Answer */}
            {answer && sn && (
                <section className="space-y-6" aria-live="polite">
                    <h2 className="text-2xl font-bold text-slate-900">Your answer</h2>
                    {stale && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                            You've changed your numbers since this answer. Run the calculator again to update it.
                        </div>
                    )}
                    <div className={`space-y-6 ${stale ? 'opacity-60' : ''}`}>
                        <SavingsNeededHeadline
                            result={answer.result}
                            spendTip={SPEND_TIP}
                            fixLink={
                                <>
                                    To find the earliest age that works at this spending, use the{' '}
                                    <a href="/when-can-i-retire/" className="font-medium underline decoration-dotted underline-offset-2 hover:opacity-80">when can I retire</a>{' '}
                                    calculator.
                                </>
                            }
                        />

                        {handoff && (
                            <div className="space-y-2">
                                <a href={handoff.href} className={primaryBtn}>
                                    {handoff.label}
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
                        year at a time, with federal and provincial tax, CPP, OAS and the OAS clawback. It keeps
                        your retirement age and spending fixed and looks for the savings in two steps:
                    </p>
                    <ol className="list-decimal pl-6 space-y-2">
                        <li>
                            <strong>Average returns first.</strong> It finds the smallest savings at which your
                            money lasts to the end of the plan if investments earn their average return every year.
                            At each amount it tries different choices:
                            <ul className="list-disc pl-6 mt-1 space-y-1">
                                <li>when to start CPP</li>
                                <li>when to start OAS</li>
                                <li>
                                    early RRSP withdrawals, known as an{' '}
                                    <a href="/rrsp-withdrawal-strategy/" className="underline decoration-dotted underline-offset-2 hover:text-slate-900">RRSP meltdown</a>
                                </li>
                                <li>which accounts to take money from first</li>
                            </ul>
                            <span className="block mt-1">
                                It keeps the mix that works and leaves the most at the end.
                            </span>
                        </li>
                        <li>
                            <strong>Then market simulations.</strong> Real returns go up and down. It runs that
                            amount through hundreds of market simulations. If your money doesn't last in enough of
                            them to meet the confidence you chose, it tries larger amounts until it does.
                        </li>
                    </ol>
                    <p>A few things to know:</p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li>
                            It keeps your current mix of accounts and scales it. If you have twice as much in your
                            RRSP as your TFSA now, the answer keeps that ratio, and non-registered accounts keep
                            their share of growth. With no savings entered, it assumes new money goes to a TFSA
                            first, up to the room you could have built up by now, then an RRSP (split evenly
                            between spouses).
                        </li>
                        <li>
                            Amounts are in today's dollars, and so is the answer. If you're still working, it also
                            shows what that grows to by your retirement age: your savings plus what you keep saving
                            from your pay along the way. The planner automatically saves whatever is left of your
                            pay after tax and before-retirement spending.
                        </li>
                        <li>
                            If you already have enough, it says how much lower your savings could be. If CPP, OAS
                            and a pension cover your spending on their own, the answer is $0. If no amount works,
                            your spending is more than savings can fund, and the fix is lower spending or a later
                            retirement.
                        </li>
                        <li>
                            Your retirement age stays fixed. To find the earliest age instead, use the{' '}
                            <a href="/when-can-i-retire/" className="underline decoration-dotted underline-offset-2 hover:text-slate-900">when can I retire</a>{' '}
                            calculator.
                        </li>
                        <li>Your spending stays the same every year of retirement, rising with inflation.</li>
                        <li>
                            A workplace pension is held as you entered it. It doesn't get smaller if you retire
                            earlier, so check your pension statement for the amount at your retirement age.
                        </li>
                        <li>
                            CPP uses the full planner's default for years of contributions, not your own record. For
                            a closer figure, use the{' '}
                            <a href="/cpp-calculator/" className="underline decoration-dotted underline-offset-2 hover:text-slate-900">CPP calculator</a>{' '}
                            and apply it in the full planner.
                        </li>
                        <li>
                            With a spouse who has income, they stop working at the same age as you (or now, if
                            they're already past it). With no income, they count as already retired.
                        </li>
                    </ul>
                </div>
            </section>

            {/* FAQ */}
            <section className="bg-white rounded-3xl p-5 sm:p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900">Frequently asked questions</h2>
                <div className="space-y-6">
                    {HOW_MUCH_DO_I_NEED_FAQ_ITEMS.map(({ question, answer }) => (
                        <div key={question} className="space-y-2">
                            <h3 className="font-bold text-slate-900">{question}</h3>
                            <p className="text-slate-600 leading-relaxed">{answer}</p>
                        </div>
                    ))}
                </div>
            </section>

            <EducationalDisclaimer />
        </div>
    );
}
