import { FAQ_ITEMS } from './how-it-works-faq';

export function HowItWorks() {
    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20">
            {/* Header Section */}
            <section className="text-center space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Canadian Retirement Asset Planning tool</p>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">How it works</h1>
            </section>

            {/* Opening Section */}
            <section className="bg-indigo-50/50 rounded-3xl p-8 border border-indigo-100 space-y-6">
                <div className="prose prose-indigo max-w-none text-indigo-900/80 leading-relaxed space-y-4">
                    <p>
                        Saving for retirement is one problem. Spending it is another — and in Canada, decisions on how to invest and withdraw in retirement can make a meaningful difference. When you take CPP/OAS, which account you drain first, which account you reinvest in — these choices can lead to tens of thousands of dollars — sometimes more — in tax savings.
                    </p>
                    <p>
                        This tool exists to show you those differences and how you can increase your retirement income, your estate, or both.
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white/60 rounded-2xl p-5 border border-indigo-100 flex gap-3 items-start">
                        <svg className="w-6 h-6 flex-shrink-0 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <h4 className="font-bold text-indigo-900">Government benefit timing</h4>
                            <p className="text-sm text-indigo-900/80 leading-relaxed">
                                See what starting CPP or OAS earlier or later does to your outcome. A built-in CPP calculator estimates your entitlement from your earnings history.
                            </p>
                        </div>
                    </div>
                    <div className="bg-white/60 rounded-2xl p-5 border border-indigo-100 flex gap-3 items-start">
                        <svg className="w-6 h-6 flex-shrink-0 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                        </svg>
                        <div>
                            <h4 className="font-bold text-indigo-900">Withdrawal order</h4>
                            <p className="text-sm text-indigo-900/80 leading-relaxed">
                                Compare draining RRSP/RRIF, TFSA, and non-registered accounts in different sequences — including an early "RRSP melt" to avoid large forced withdrawals (and tax bills) later.
                            </p>
                        </div>
                    </div>
                    <div className="bg-white/60 rounded-2xl p-5 border border-indigo-100 flex gap-3 items-start">
                        <svg className="w-6 h-6 flex-shrink-0 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6h7.5m-7.5 0a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 008.25 21h7.5a2.25 2.25 0 002.25-2.25V8.25A2.25 2.25 0 0015.75 6m-7.5 0V4.5m7.5 1.5V4.5M8.258 11.25h.008v.008h-.008V11.25zm0 2.25h.008v.008h-.008V13.5zm0 2.25h.008v.008h-.008v-.008zm2.498-4.5h.008v.008h-.008V11.25zm0 2.25h.008v.008h-.008V13.5zm0 2.25h.008v.008h-.008v-.008zm2.504-4.5h.008v.008h-.008V11.25zm0 2.25h.008v.008h-.008V13.5zm2.498-2.25h.008v.008h-.008V11.25z" />
                        </svg>
                        <div>
                            <h4 className="font-bold text-indigo-900">Real Canadian taxes</h4>
                            <p className="text-sm text-indigo-900/80 leading-relaxed">
                                Federal and provincial brackets for all 10 provinces and 3 territories, OAS clawback, capital gains with cost-base tracking, dividend credits, and automatic pension income splitting for couples.
                            </p>
                        </div>
                    </div>
                    <div className="bg-white/60 rounded-2xl p-5 border border-indigo-100 flex gap-3 items-start">
                        <svg className="w-6 h-6 flex-shrink-0 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v6.75c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                        </svg>
                        <div>
                            <h4 className="font-bold text-indigo-900">Uncertainty</h4>
                            <p className="text-sm text-indigo-900/80 leading-relaxed">
                                A Monte Carlo mode stress-tests your plan against volatile equity markets instead of assuming a smooth average return every year.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="prose prose-indigo max-w-none text-indigo-900/80 leading-relaxed space-y-4">
                    <p>
                        Everything runs entirely in your browser — no account, no server, none of your financial data ever leaves your device.
                    </p>
                    <p>
                        The output isn't a prediction — it's a comparison. Change one decision, hold everything else constant, and see whether it helps, hurts, or doesn't matter.
                    </p>
                </div>
            </section>

            {/* Important Disclaimer */}
            <section className="bg-amber-50 rounded-3xl p-8 border border-amber-200 space-y-4">
                <h2 className="text-xl font-bold text-amber-900 flex items-center gap-3">
                    <svg className="w-6 h-6 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    These are rough estimates — actual results will vary, often by a lot
                </h2>
                <div className="prose prose-amber max-w-none text-amber-900/80 leading-relaxed space-y-3">
                    <p>
                        Treat results as comparisons between plans, not forecasts. A small difference (even 1–2%) between assumed and actual returns, compounded over 20–30 years, will dwarf most tax optimizations. Use the tool to learn the direction and magnitude of your choices, then revisit your assumptions as your situation evolves.
                    </p>
                    <p>
                        The simulation also assumes today's rules stay in place. Future changes to tax rates and brackets, government programs like CPP and OAS, and other laws will affect real-world results in ways no projection can anticipate.
                    </p>
                    <p>
                        A plan is a snapshot of one moment, so keep it fresh: revisit your retirement plan every year or two to update account balances, spending, and start-age decisions as actual returns and life events diverge from the assumptions. The comparisons stay useful precisely because you keep feeding them current facts.
                    </p>
                </div>
            </section>

            {/* Section divider */}
            <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-sm font-semibold text-slate-400 uppercase tracking-widest whitespace-nowrap">Further details on how this works</span>
                <div className="flex-1 h-px bg-slate-200" />
            </div>

            {/* Modelling overview */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100">
                <p className="text-slate-600 leading-relaxed">
                    This tool attempts to model the tax impact of your choices as accurately as is practical for
                    a planning tool. Income from each source — employment, CPP/OAS, RRIF withdrawals, interest,
                    dividends, and capital gains — is taxed under its own rules, and government entitlements such
                    as OAS (including the clawback) and age-based credits are applied year by year. Expand the
                    sections below for details on each part of the model.
                </p>
            </section>

            {/* Core Methodology */}
            <details className="group bg-white rounded-3xl shadow-sm border border-slate-100">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 p-8">
                    <h2 className="text-2xl font-bold text-slate-900">Calculation logic</h2>
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 prose prose-slate max-w-none text-slate-600 leading-relaxed">
                    <p>
                        The engine performs a <strong>year-by-year cash flow simulation</strong> from your current age until your projected life expectancy (or your spouse's, whichever is later). Each year, the engine looks at:
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>Inflow:</strong> employment, CPP, OAS, mandatory RRIF minimums, optional RRSP melt withdrawals, investment income from non-registered accounts, and any one-time inflows.</li>
                        <li><strong>Gap analysis:</strong> compares net cash to your "Target Spend".</li>
                        <li><strong>Drawdown:</strong> pulls from accounts per your selected strategy if there's a deficit.</li>
                        <li><strong>Reinvestment:</strong> fills TFSA room, then RRSP room, then invests the rest in your designated non-registered surplus account.</li>
                        <li><strong>Growth:</strong> applies investment returns to remaining balances.</li>
                    </ul>
                    <p>
                        When a person dies in the simulation, assets roll over tax-free to a surviving spouse (keeping each account's cost base); with no survivor, the estate pays tax on a deemed disposition — the full remaining RRSP/RRIF is taxed as income, and unrealized capital gains are deemed realized.
                    </p>
                </div>
            </details>

            {/* Withdrawal Strategies */}
            <details className="group bg-white rounded-3xl shadow-sm border border-slate-100">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 p-8">
                    <h2 className="text-2xl font-bold text-slate-900">Withdrawal strategies</h2>
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 prose prose-slate max-w-none text-slate-600 leading-relaxed">
                    <p>
                        <strong>RRSP last (defer taxes):</strong> draws non-registered accounts first (lowest tax per dollar), then TFSA (zero tax), leaving RRSPs untouched to defer taxes as long as possible. Deferral isn't free: the RRSP keeps growing, forced RRIF withdrawals get larger after 72, and whatever remains is fully taxed at death — so this strategy may result in a higher tax bill for your estate and higher total lifetime tax.
                    </p>
                    <p>
                        <strong>RRSP first (early melt):</strong> draws from RRSPs first to "melt" the balance early at lower tax brackets, potentially reducing large tax bills at age 72 or at death.
                    </p>
                </div>
            </details>

            {/* Tax Logic */}
            <details className="group bg-white rounded-3xl shadow-sm border border-slate-100">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 p-8">
                    <h2 className="text-2xl font-bold text-slate-900">Taxation & government benefits</h2>
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 space-y-8">
                    <p className="text-slate-600 leading-relaxed">
                        The engine uses a built-in tax calculator for all 10 provinces and 3 territories.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div className="space-y-2">
                            <h4 className="font-bold text-slate-900">Income tax</h4>
                            <p className="text-slate-600 leading-relaxed">
                                Applies federal and provincial brackets, the Basic Personal Amount, Age Amount (65+), and Pension Income Credit (RRIF income, 65+). Brackets and credits are indexed to your projected inflation rate.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-bold text-slate-900">OAS clawback</h4>
                            <p className="text-slate-600 leading-relaxed">
                                If individual net income exceeds the threshold (~$95,300 in 2026), the engine deducts the 15% recovery tax.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-bold text-slate-900">Capital gains</h4>
                            <p className="text-slate-600 leading-relaxed">
                                Non-registered withdrawals use your <strong>Adjusted Cost Base (ACB)</strong>. Only 50% of the gain is taxable income.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-bold text-slate-900">Dividend tax credit</h4>
                            <p className="text-slate-600 leading-relaxed">
                                Eligible Canadian dividends are grossed up (38%) and receive federal and provincial credits for corporate tax already paid.
                            </p>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-slate-100">
                        <p className="text-sm text-slate-500 italic">
                            Note: this is a planning tool, not a tax return. Provincial amounts for the Age Amount and Pension Income Credit use simplified approximations.
                        </p>
                    </div>
                </div>
            </details>

            {/* Income Splitting Section */}
            <details className="group bg-white rounded-3xl shadow-sm border border-slate-100">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 p-8">
                    <h2 className="text-2xl font-bold text-slate-900">Pension income splitting</h2>
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 prose prose-slate max-w-none text-slate-600 leading-relaxed">
                    <p>
                        For couples, the engine automatically calculates the optimal amount of eligible pension income (like RRIF withdrawals) to "split" with a lower-earning spouse.
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>Optimization:</strong> tests splitting percentages up to 50% to minimize the household's combined tax bill.</li>
                        <li><strong>OAS impact:</strong> considers whether splitting helps a spouse avoid or reduce OAS clawback.</li>
                        <li><strong>Credits:</strong> preserves credits like the Age Amount where beneficial.</li>
                    </ul>
                </div>
            </details>

            {/* Asset Growth */}
            <details className="group bg-white rounded-3xl shadow-sm border border-slate-100">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 p-8">
                    <h2 className="text-2xl font-bold text-slate-900">Investment growth</h2>
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 prose prose-slate max-w-none text-slate-600 leading-relaxed">
                    <p>
                        Assets grow based on the return rates set in the <strong>Returns</strong> panel. The engine separates <strong>Yield</strong> (Dividends/Interest) from <strong>Capital Growth</strong>.
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>RRSP/TFSA:</strong> each account grows at its own whole-account return, reinvested and tax-sheltered — no yield/gains split needed.</li>
                        <li><strong>Non-Registered:</strong> yield is paid out as cash (and taxed) each year. The Equity slice appreciates at the full Capital Growth rate. Dividend-paying stocks appreciate too — paying a dividend doesn't stop a share price rising, it just splits the return between cash and price — so the Canadian- and foreign-dividend slices grow at 85% of Capital Growth less their own yield, leaving them a slightly lower total return than pure growth equity. Bonds and cash are income-only: their principal doesn't move. Growth doesn't raise the ACB, so unrealized gains build up until realized by sales, Fund Turnover, or death.</li>
                    </ul>
                    <h3 className="text-lg font-bold text-slate-900 mt-6">Multiple non-registered accounts</h3>
                    <p>
                        Each person can hold several non-registered accounts (e.g. a GIC ladder, a dividend portfolio, a growth ETF account):
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>Withdrawals minimize realized gains:</strong> sells from the account with the highest cost-base ratio first — the least realized gain per dollar raised.</li>
                        <li><strong>Surplus goes to one account:</strong> leftover cash each year is invested into the account marked <strong>Surplus</strong>.</li>
                        <li><strong>At death:</strong> a surviving spouse inherits each account as-is, keeping its own ACB and mix.</li>
                    </ul>
                    <h3 className="text-lg font-bold text-slate-900 mt-6">Rebalancing vs. drift</h3>
                    <p>
                        The <strong>Rebalance Annually</strong> toggle controls each account's mix over time: <strong>on</strong> pulls it back to your chosen weights every year; <strong>off</strong> lets the equity share drift up, because the Equity slice compounds faster than the dividend slices and the bond/cash slices don't compound at all. The separate Fund Turnover input models the annual tax drag of funds that realize gains internally — it applies every year, whether or not rebalancing is on.
                    </p>
                </div>
            </details>

            {/* Privacy Section */}
            <section id="privacy" className="bg-emerald-50/50 rounded-3xl p-8 border border-emerald-100 space-y-4">
                <h2 className="text-2xl font-bold text-emerald-900">
                    Privacy & data security
                </h2>
                <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed">
                    <p>
                        Your privacy is built into the architecture of this tool.
                        <strong> All calculations are performed locally within your web browser.</strong>
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>No data transfer:</strong> personal financial information is never sent to a server.</li>
                        <li><strong>Local logic:</strong> the projection engine and tax models run entirely on your own device.</li>
                        <li><strong>Local storage only:</strong> saved plans are stored only in your browser's local storage.</li>
                        <li><strong>Anonymous analytics:</strong> Cloudflare Web Analytics monitors aggregate, non-identifiable traffic only.</li>
                    </ul>
                </div>
            </section>

            {/* FAQs */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900">Frequently asked questions</h2>
                <div className="space-y-6">
                    {FAQ_ITEMS.map(({ question, answer }) => (
                        <div key={question} className="space-y-2">
                            <h4 className="font-bold text-slate-900">{question}</h4>
                            <p className="text-slate-600 leading-relaxed">{answer}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Full Legal Disclaimer (site footer is shared via AppLayout) */}
            <section id="full-disclaimer" className="pt-12 border-t border-slate-200">
                <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
                    <p className="text-sm text-slate-500 uppercase tracking-widest font-bold mb-4">Important legal disclaimer</p>
                    <div className="text-xs text-slate-500 leading-relaxed space-y-4">
                        <p>
                            <strong>For informational purposes only:</strong> The Canadian Retirement Asset Planning (C.R.A.P.) tool is provided as a mathematical demonstration of retirement scenarios based on user-provided inputs and simplified tax/financial models. It does not constitute financial, investment, tax, or legal advice.
                        </p>
                        <p>
                            <strong>No guarantees:</strong> Projections are purely hypothetical and are not guarantees of future results. Investment returns, inflation rates, and tax laws are volatile and subject to change without notice. The software may contain errors or omissions in its underlying logic or data constants.
                        </p>
                        <p>
                            <strong>Limitation of liability:</strong> Under no circumstances shall the creators or distributors of this tool be liable for any financial losses, damages, or decisions made based on the information provided by this simulation. You assume full responsibility for any financial actions you take.
                        </p>
                        <p>
                            <strong>Professional advice required:</strong> Retirement planning is complex. You should not rely on this tool for making actual financial decisions. Always consult with a certified financial planner (CFP), qualified tax professional, or legal advisor before implementing any retirement or investment strategy.
                        </p>
                    </div>
                </div>
            </section>
        </div>
    );
}
