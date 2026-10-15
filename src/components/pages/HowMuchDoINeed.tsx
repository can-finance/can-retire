import { useEffect, useMemo, useRef, useState } from 'react';
import LZString from 'lz-string';
import { FinancialInput } from '../inputs/FinancialInput';
import { PROVINCES } from '../../constants/provinces';
import { buildStartHash } from '../../utils/shareLink';
import { optimizeMeltdown } from '../../utils/meltdownOptimizer';
import type { MeltdownResult } from '../../utils/meltdownOptimizer';
import { SavingsNeededHeadline } from '../optimizer/SavingsNeededHeadline';
import { SavingsNeededTable } from '../optimizer/SavingsNeededTable';
import { savingsAgeTableShown } from '../optimizer/savingsNeededSummary';
import { SUCCESS_TARGETS, DEFAULT_SUCCESS_TARGET } from '../optimizer/successTargets';
import {
    ConfidencePicker,
    EducationalDisclaimer,
    PensionFields,
    RunStatusBlock,
    SpendOverPayNote,
    SpouseSection,
    primaryBtn,
} from './calculatorParts';
import type { RunStatus } from './calculatorParts';
import { FaqAnswer } from './FaqAnswer';
import { HOW_MUCH_DO_I_NEED_FAQ_ITEMS } from './how-much-do-i-need-faq';
import { needHandoff, needSaveAsYouGoHandoff } from './how-much-do-i-need-handoff';
import type { NeedHandoff } from './how-much-do-i-need-handoff';
import { buildNeedInputs, initialNeedForm, needFormErrors } from './how-much-do-i-need-inputs';
import type { NeedForm } from './how-much-do-i-need-inputs';

/*
 * The /how-much-do-i-need-to-retire/ landing page: a short form with the
 * retirement age as an input, the "How much do I need?" search (the
 * optimizer's savings-needed objective) at the confidence the visitor picks,
 * the same answer box and table of nearby ages the in-app optimizer shows,
 * then a link that opens the plan in the full planner (and a second one for
 * the save-as-you-go plan, when saving as you go works). The sibling of
 * /when-can-i-retire/, which finds the age instead.
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

// The quieter look for the second hand-off link, beside primaryBtn.
const secondaryBtn =
    'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white text-brand-700 font-semibold text-base border border-brand-200 hover:bg-brand-50 transition-colors shadow-sm';

// A hand-off as a #start= link the full planner opens as a new plan.
function handoffLink(h: NeedHandoff | null): { href: string; label: string } | null {
    if (!h) return null;
    return {
        href: `/${buildStartHash(LZString.compressToEncodedURIComponent(JSON.stringify(h.inputs)), h.name)}`,
        label: h.buttonLabel,
    };
}

const arrow = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
);

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
    const spendPlan = useMemo(() => (errors.length > 0 ? null : buildNeedInputs(form)), [errors, form]);
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
    // Which plan, and its name, are needHandoff's call — and, for the second
    // link when saving as you go works, needSaveAsYouGoHandoff's.
    const handoff = useMemo(() => (answer ? handoffLink(needHandoff(answer.result)) : null), [answer]);
    const saveAsYouGoHandoff = useMemo(
        () => (answer ? handoffLink(needSaveAsYouGoHandoff(answer.result)) : null),
        [answer],
    );

    const sn = answer?.result.savingsNeeded ?? null;

    const targetBlurb = SUCCESS_TARGETS.find((t) => t.value === successTarget)?.savingsBlurb;

    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20">
            {/* Hero */}
            <section className="text-center space-y-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Canadian Retirement Asset Planning tool</p>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">How much do I need to retire?</h1>
                <p className="max-w-2xl mx-auto text-lg text-slate-600 leading-relaxed">
                    Find the savings you need to retire at the age you choose and still have your money
                    last. It includes Canadian taxes, CPP and OAS, and tests your plan in good and bad
                    markets.
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
                        Enter amounts as they are today. We add inflation for you. Returns, a plan to age 90
                        and other settings use the full planner's defaults, which you can change there.
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
                            tooltip="Your yearly pay before tax, until you retire."
                            value={form.currentIncome}
                            onChange={(e) => update({ currentIncome: Number(e.target.value) })}
                        />
                        <FinancialInput
                            label="Retirement age"
                            tooltip="The age you plan to stop working. Enter your current age to see what you'd need to retire now."
                            prefix=""
                            value={form.retirementAge}
                            onChange={(e) => update({ retirementAge: Math.round(Number(e.target.value)) })} maxFractionDigits={0} inputMode="numeric"
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">What you have saved now</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                        Leave a box at 0 if it doesn't apply, even all three.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <FinancialInput label="RRSP" value={form.rrsp}
                            onChange={(e) => update({ rrsp: Number(e.target.value) })} />
                        <FinancialInput label="TFSA" value={form.tfsa}
                            onChange={(e) => update({ tfsa: Number(e.target.value) })} />
                        <FinancialInput
                            label="Non-registered"
                            tooltip="Taxable investment accounts. We assume half the balance is what you put in and half is growth."
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
                        <div className="space-y-1.5">
                            <FinancialInput
                                label="Before retirement"
                                tooltip="What you spend each year while you're still working. Whatever is left of your pay after tax and this spending is saved."
                                value={form.preRetirementSpend}
                                onChange={(e) => update({ preRetirementSpend: Number(e.target.value) })}
                            />
                            <SpendOverPayNote plan={spendPlan} />
                        </div>
                        <FinancialInput
                            label="After retirement"
                            tooltip="What you plan to spend each year once retired. It stays the same every year, apart from inflation."
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

                        {savingsAgeTableShown(sn) && (
                            <div className="rounded-2xl bg-white p-5 sm:p-6 shadow-sm border border-slate-100">
                                <h3 className="text-lg font-bold text-slate-900">Retiring earlier or later</h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    What you'd need at nearby ages, at the same spending.
                                </p>
                                <div className="mt-4">
                                    <SavingsNeededTable result={sn} />
                                </div>
                            </div>
                        )}

                        {handoff && (
                            <div className="space-y-2">
                                <div className="flex flex-wrap gap-3">
                                    <a href={handoff.href} className={primaryBtn}>
                                        {handoff.label}
                                        {arrow}
                                    </a>
                                    {saveAsYouGoHandoff && (
                                        <a href={saveAsYouGoHandoff.href} className={secondaryBtn}>
                                            {saveAsYouGoHandoff.label}
                                            {arrow}
                                        </a>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500">
                                    Opens in the full planner as a new plan, with charts and a year-by-year
                                    table. Your existing plans there aren't touched.
                                    {saveAsYouGoHandoff && (
                                        <>
                                            {' '}The save-as-you-go plan keeps your savings as they are and
                                            spends less before you retire.
                                        </>
                                    )}
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
                        The calculator builds a full plan from your numbers, with federal and provincial tax,
                        CPP, OAS and the OAS clawback. Then it finds your savings in two steps:
                    </p>
                    <ol className="list-decimal pl-6 space-y-2">
                        <li>
                            <strong>Average returns first.</strong> It finds the smallest amount that lasts to the
                            end of the plan if investments earn their average return every year. At each amount it
                            tries different CPP and OAS start ages, early RRSP withdrawals (an{' '}
                            <a href="/rrsp-withdrawal-strategy/" className="underline decoration-dotted underline-offset-2 hover:text-slate-900">RRSP meltdown</a>)
                            and which accounts to take money from first, and keeps what works best.
                        </li>
                        <li>
                            <strong>Then market simulations.</strong> It tests that amount in hundreds of good and
                            bad markets, and raises it until your money lasts in enough of them to meet the
                            confidence you chose.
                        </li>
                    </ol>
                    <p>A few things to know:</p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li>
                            It keeps your current mix of RRSP, TFSA and non-registered savings. With no savings
                            entered, it assumes a TFSA first, up to the room you could have built up by now, then
                            an RRSP.
                        </li>
                        <li>
                            All amounts are in today's dollars. If you're still working, the amount you need by
                            retirement includes what you'll keep saving from your pay.
                        </li>
                        <li>
                            If you're still working and need more, it also shows how much less to spend each year
                            before you retire, saving the difference.
                        </li>
                        <li>
                            Your retirement age stays fixed. To find the earliest age instead, use the{' '}
                            <a href="/when-can-i-retire/" className="underline decoration-dotted underline-offset-2 hover:text-slate-900">when can I retire</a>{' '}
                            calculator.
                        </li>
                    </ul>
                </div>
            </section>

            {/* FAQ */}
            <section className="bg-white rounded-3xl p-5 sm:p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900">Frequently asked questions</h2>
                <div className="space-y-6">
                    {HOW_MUCH_DO_I_NEED_FAQ_ITEMS.map(({ question, answer, links }) => (
                        <div key={question} className="space-y-2">
                            <h3 className="font-bold text-slate-900">{question}</h3>
                            <p className="text-slate-600 leading-relaxed"><FaqAnswer answer={answer} links={links} /></p>
                        </div>
                    ))}
                </div>
            </section>

            <EducationalDisclaimer />
        </div>
    );
}
