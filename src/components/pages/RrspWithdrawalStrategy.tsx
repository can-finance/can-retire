import { RRSP_STRATEGY_FAQ_ITEMS } from './rrsp-withdrawal-strategy-faq';

// Primary in-app CTA: opens the meltdown optimizer on the dashboard. The
// `?optimize=1` param is captured once, synchronously, by Dashboard.tsx (mirrors
// the ?setup=1 pattern in App.tsx) and stripped immediately.
const OPTIMIZE_HREF = '/?optimize=1';

export function RrspWithdrawalStrategy() {
    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20">
            {/* Hero */}
            <section className="text-center space-y-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Canadian Retirement Asset Planning tool</p>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">RRSP Withdrawal Strategy Calculator</h1>
                <p className="max-w-2xl mx-auto text-lg text-slate-600 leading-relaxed">
                    Find the RRSP withdrawal schedule — the decumulation plan — that fits your goal: the
                    most you can safely spend each year, or the largest after-tax estate you can leave.
                    This free calculator models the RRSP meltdown strategy year by year to help you decide
                    when to withdraw from your RRSP, and how much.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                    <a
                        href={OPTIMIZE_HREF}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 text-white font-semibold text-base hover:bg-brand-700 transition-colors shadow-sm"
                    >
                        Find my withdrawal strategy
                        <span className="bg-white/20 text-white text-xs px-1.5 py-0.5 rounded font-bold">BETA</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                    </a>
                </div>
                <p className="text-sm text-slate-500">
                    Free · No account · Runs entirely in your browser — your data never leaves your device
                </p>
            </section>

            {/* Why deferral backfires */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-4">
                <h2 className="text-2xl font-bold text-slate-900">Why "withdraw as late as possible" often backfires</h2>
                <div className="max-w-none text-base text-slate-600 leading-relaxed space-y-4">
                    <p>
                        The instinct with an RRSP is to defer tax for as long as possible — leave it untouched, let
                        it grow, and worry about withdrawals later. That instinct can be expensive. Deferral is not
                        free: the longer you wait, the bigger the account grows, and the bigger the eventual tax
                        bill on the way out.
                    </p>
                    <p>
                        You must convert your RRSP to a RRIF by the end of the year you turn 71, and, starting the
                        year you turn 72, a rising minimum percentage must be withdrawn and taxed as income every
                        year — whether you need the money or not. Those <strong>RRIF minimum withdrawals</strong> land
                        on top of CPP and OAS, which by then are usually flowing too. Three income streams stacking
                        at once can push a retiree into a higher tax bracket than they ever paid while working.
                    </p>
                    <p>
                        Large forced withdrawals can also trigger the OAS clawback. Once individual net income passes roughly $95,300 (2026),
                        OAS is reduced by a 15% recovery tax — so a large forced RRIF withdrawal can quietly claw
                        back a chunk of a benefit you would otherwise keep.
                    </p>
                    <p>
                        The final bill comes at death. Whatever remains in the RRSP or RRIF is treated as income on
                        the final tax return and taxed all at once — often at the highest marginal rate — unless it
                        rolls over to a surviving spouse. A large deferred RRSP can hand a big share of the estate to
                        the CRA instead of to your heirs.
                    </p>
                </div>
            </section>

            {/* The meltdown strategy */}
            <section className="bg-indigo-50/50 rounded-3xl p-8 border border-indigo-100 space-y-4">
                <h2 className="text-2xl font-bold text-indigo-900">The RRSP meltdown strategy</h2>
                <div className="max-w-none text-base text-indigo-900/80 leading-relaxed space-y-4">
                    <p>
                        The RRSP meltdown strategy flips the default. Instead of deferring, you deliberately draw the
                        RRSP down during your <strong>low-income years</strong> — typically the window between
                        retiring and starting CPP and OAS — while your marginal tax rate is low and there is room in
                        the lower brackets.
                    </p>
                    <p>
                        Melting the RRSP down early does two things at once. It taxes those dollars at low rates now
                        instead of high rates later, and it shrinks the RRIF balance before mandatory minimums begin,
                        so the forced withdrawals after 72 are smaller and less likely to trigger the OAS clawback.
                    </p>
                    <p>
                        The strategy often pairs with delaying CPP and OAS to age 70. Delaying helps twice over:
                        it permanently raises the guaranteed, inflation-indexed benefit you receive for life,
                        and it widens the low-income window — giving you more years to melt down the RRSP at low tax
                        rates before government benefits start. The goal is not to pay the least tax in any single
                        year, but the least tax across your whole retirement, so more is left over at the end.
                    </p>
                </div>
            </section>

            {/* When it helps / doesn't */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900">When a meltdown helps — and when it doesn't</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="bg-emerald-50/60 rounded-2xl p-5 border border-emerald-100 space-y-2">
                        <h3 className="font-bold text-emerald-900">It tends to help when…</h3>
                        <ul className="list-disc pl-5 space-y-1.5 text-sm text-emerald-900/80 leading-relaxed">
                            <li>you have a large RRSP or RRIF balance relative to your other savings;</li>
                            <li>your other income is low in early retirement, leaving room in the lower tax brackets;</li>
                            <li>you care about the after-tax estate you leave behind.</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-2">
                        <h3 className="font-bold text-slate-900">It does little when…</h3>
                        <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-600 leading-relaxed">
                            <li>your retirement income is already high every year, so there are no low-tax years to withdraw into;</li>
                            <li>a defined-benefit pension or other income already fills the lower brackets.</li>
                        </ul>
                    </div>
                </div>
                <div className="bg-amber-50 rounded-2xl p-5 border border-amber-200 flex gap-3 items-start">
                    <svg className="w-6 h-6 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div className="space-y-1">
                        <h3 className="font-bold text-amber-900">Caution for lower-income retirees</h3>
                        <p className="text-sm text-amber-900/80 leading-relaxed">
                            If you could qualify for the Guaranteed Income Supplement (GIS), be careful: GIS is
                            income-tested, and extra RRSP withdrawals can reduce it. This tool does <strong>not</strong> model
                            GIS, so if you are near GIS eligibility, talk to a qualified advisor before melting down
                            your RRSP.
                        </p>
                    </div>
                </div>
            </section>

            {/* How the optimizer works */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-4">
                <h2 className="text-2xl font-bold text-slate-900">How the optimizer works</h2>
                <div className="max-w-none text-base text-slate-600 leading-relaxed space-y-4">
                    <p>
                        The calculator does not guess. It runs a full <strong>year-by-year simulation</strong> of
                        your retirement using real Canadian tax rules, then searches for the schedule that best
                        delivers the goal you choose. Under the hood it:
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li>Simulates each year from now to life expectancy, applying federal and provincial income tax brackets for all provinces and territories, the OAS clawback, and mandatory RRIF minimums.</li>
                        <li>Searches across many annual RRSP withdrawal amounts — and, if you let it, across CPP and OAS start ages from 60 to 70 — to see which combination performs best.</li>
                        <li>Optimizes for the goal you choose: the largest <strong>net estate</strong> — the after-tax value left at the end, after the final return's terminal tax on any remaining registered assets — or the highest annual spending your plan can sustain.</li>
                        <li>Never proposes a plan that runs you out of money — schedules that leave you short are discarded, not recommended.</li>
                        <li>Validates the winner against Monte Carlo market scenarios, so you can see whether a plan that looks great on average still holds up when markets misbehave.</li>
                    </ul>
                    <p>
                        The output is a comparison, not a prediction. It shows your current plan beside the suggested
                        meltdown so you can see the direction and size of the difference, then decide for yourself.
                    </p>
                </div>
            </section>

            {/* Accuracy */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-4">
                <h2 className="text-2xl font-bold text-slate-900">How accurate is this calculation?</h2>
                <div className="max-w-none text-base text-slate-600 leading-relaxed space-y-4">
                    <p>
                        Exactly as accurate as its inputs — which are a mix of things you know and things nobody
                        knows. Your ages, current account balances, and today's tax rules are known precisely, and
                        the arithmetic built on them — brackets, OAS clawback, RRIF minimums — is exact. Future
                        investment returns are the opposite: they vary widely from year to year and will almost
                        certainly not follow the smooth path any simulation assumes. Spending, tax rules, and
                        government benefits drift over the decades too.
                    </p>
                    <p>
                        That is why the results are best read as a <strong>comparison between strategies</strong>,
                        not a forecast of your actual balance decades from now. The direction of the recommendation —
                        melting down beats deferring, and by roughly this much — is far more durable than any single
                        dollar figure attached to it.
                    </p>
                    <p>
                        A plan is a snapshot, so keep it fresh: <strong>revisit your retirement plan every year or
                        two</strong> — update balances, spending, and start-age decisions as real returns and real
                        life diverge from the projection, and re-run the optimizer on the new numbers. The advice
                        that matters is always the one computed from your current situation, not the one from three
                        years ago.
                    </p>
                </div>
            </section>

            {/* FAQ */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900">Frequently asked questions</h2>
                <div className="space-y-6">
                    {RRSP_STRATEGY_FAQ_ITEMS.map(({ question, answer }) => (
                        <div key={question} className="space-y-2">
                            <h3 className="font-bold text-slate-900">{question}</h3>
                            <p className="text-slate-600 leading-relaxed">{answer}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Closing CTA */}
            <section className="bg-indigo-50/50 rounded-3xl p-8 border border-indigo-100 text-center space-y-4">
                <h2 className="text-2xl font-bold text-indigo-900">See your own numbers</h2>
                <p className="max-w-2xl mx-auto text-base text-indigo-900/80 leading-relaxed">
                    Every situation is different. Run the optimizer on your own balances, income, and province to
                    see whether an RRSP meltdown could cut your lifetime tax bill and leave more behind — all
                    calculated privately in your browser.
                </p>
                <div className="flex justify-center">
                    <a
                        href={OPTIMIZE_HREF}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 text-white font-semibold text-base hover:bg-brand-700 transition-colors shadow-sm"
                    >
                        Find my withdrawal strategy
                        <span className="bg-white/20 text-white text-xs px-1.5 py-0.5 rounded font-bold">BETA</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                    </a>
                </div>
            </section>

            {/* Disclaimer */}
            <section className="pt-8 border-t border-slate-200">
                <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
                    <p className="text-sm text-slate-500 uppercase tracking-widest font-bold mb-4">Educational information, not advice</p>
                    <div className="text-xs text-slate-500 leading-relaxed space-y-4">
                        <p>
                            This page and calculator are provided for general educational and informational purposes
                            only. They do not constitute financial, investment, tax, or legal advice, and no
                            personalized recommendation is being made to you. An RRSP meltdown is not right for
                            everyone, and the tool uses simplified models that may not reflect your full situation.
                        </p>
                        <p>
                            Projections are hypothetical and are not guarantees of future results. Tax rules, contribution
                            and benefit thresholds, and government programs change over time. Always consult a certified
                            financial planner, qualified tax professional, or legal advisor before making retirement or
                            withdrawal decisions.{' '}
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
