import { FAQ_ITEMS } from './how-it-works-faq';

export function HowItWorks() {
    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20">
            {/* Header Section */}
            <section className="text-center space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Canadian Retirement Asset Planning tool</p>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">How it works</h1>
            </section>

            {/* Opening Section */}
            <section className="bg-indigo-50/50 rounded-3xl p-8 border border-indigo-100 space-y-6">
                <div className="max-w-none text-base text-indigo-900/80 leading-relaxed space-y-4">
                    <p>
                        Saving for retirement is one problem; spending it well is another. When you start CPP and OAS, which account you draw from first, and where you reinvest leftover cash can change your lifetime tax bill by tens of thousands of dollars or more.
                    </p>
                    <p>
                        This tool shows you those differences so you can increase your retirement income, your estate, or both.
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
                                Compare drawing down RRSP/RRIF, TFSA, and non-registered accounts in different sequences — including an early RRSP meltdown to avoid large forced withdrawals (and tax bills) later.
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

                <div className="max-w-none text-base text-indigo-900/80 leading-relaxed space-y-4">
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
                <h2 className="text-2xl font-bold text-amber-900 flex items-center gap-3">
                    <svg className="w-6 h-6 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    These are rough estimates — actual results will vary, often by a lot
                </h2>
                <div className="max-w-none text-base text-amber-900/80 leading-relaxed space-y-3">
                    <p>
                        Treat results as comparisons between plans, not forecasts. A small difference (even 1–2%) between assumed and actual returns, compounded over 20–30 years, will dwarf most tax optimizations. Use the tool to see which way each choice moves the result, and by roughly how much.
                    </p>
                    <p>
                        The simulation also assumes today's rules stay in place. Future changes to tax rates and brackets, government programs like CPP and OAS, and other laws will affect real-world results in ways no projection can anticipate.
                    </p>
                    <p>
                        Revisit your plan every year or two and update your balances, spending and start ages. The comparisons are only as current as the numbers you give them.
                    </p>
                </div>
            </section>

            {/* Section divider */}
            <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-sm font-semibold text-slate-500 uppercase tracking-widest whitespace-nowrap">Further details on how this works</span>
                <div className="flex-1 h-px bg-slate-200" />
            </div>

            {/* Modelling overview */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100">
                <p className="text-base text-slate-600 leading-relaxed">
                    The tool models taxes as closely as a planning tool reasonably can. Each income source
                    — employment, CPP/OAS, RRIF withdrawals, interest, dividends and capital gains — is taxed
                    under its own rules, and OAS (including the clawback) and age-based credits are applied
                    each year. Expand the sections below for details on each part of the model.
                </p>
            </section>

            {/* Core Methodology */}
            <details className="group bg-white rounded-3xl shadow-sm border border-slate-100">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 p-8">
                    <h2 className="text-2xl font-bold text-slate-900">Calculation logic</h2>
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 max-w-none text-base text-slate-600 leading-relaxed">
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
                        When one spouse dies, their accounts pass to the survivor tax-free and keep their cost base. When the last person dies, the estate is taxed as if everything were sold: the remaining RRSP/RRIF counts as income, and unrealized capital gains are taxed.
                    </p>
                </div>
            </details>

            {/* Withdrawal Strategies */}
            <details className="group bg-white rounded-3xl shadow-sm border border-slate-100">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 p-8">
                    <h2 className="text-2xl font-bold text-slate-900">Withdrawal strategies</h2>
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 max-w-none text-base text-slate-600 leading-relaxed">
                    <p>
                        <strong>RRSP last (defer taxes):</strong> spends non-registered savings first, then TFSA, and leaves the RRSP for last. The RRSP grows tax-free for longer, but that makes the forced RRIF withdrawals from 72 bigger, and whatever is left is fully taxed at death.
                    </p>
                    <p>
                        <strong>RRSP first:</strong> spends the RRSP before the other accounts, while your income is lower. That shrinks later RRIF withdrawals and the tax at death, but the money leaves the tax shelter sooner.
                    </p>
                    <p>
                        Neither order always wins. Paying less tax over your lifetime doesn't guarantee a bigger estate — in our test plans, the order with the lowest total tax sometimes left less behind. The <strong>RRSP Meltdown Optimizer</strong> tries both on your own numbers.
                    </p>
                    <p>
                        These two options only set which account pays for your spending first. You change it with the <strong>Fund spending from RRSP first</strong> switch in Settings. They are not the RRSP meltdown. The meltdown is the separate <strong>RRSP Melt Amount</strong> for each person: a fixed withdrawal every year from its start age to 71, whether you need the money or not. You can use both. The meltdown comes out first, and anything still needed for spending is drawn in the order you picked.
                    </p>
                </div>
            </details>

            {/* Tax Logic */}
            <details className="group bg-white rounded-3xl shadow-sm border border-slate-100">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 p-8">
                    <h2 className="text-2xl font-bold text-slate-900">Taxation & government benefits</h2>
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 space-y-8">
                    <p className="text-base text-slate-600 leading-relaxed">
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
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 max-w-none text-base text-slate-600 leading-relaxed">
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
                    <svg className="w-5 h-5 flex-shrink-0 text-slate-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                </summary>
                <div className="px-8 pb-8 -mt-2 max-w-none text-base text-slate-600 leading-relaxed">
                    <p>
                        Assets grow based on the return rates set in the <strong>Rates of Return</strong> panel. The engine separates <strong>yield</strong> (dividends and interest, entered as the Non-Reg Dividend, Foreign and Cash Interest rates) from <strong>price growth</strong> (<strong>Non-Reg Growth (price only)</strong>).
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>RRSP/TFSA:</strong> each account grows at its own whole-account return, reinvested and tax-sheltered — no yield/gains split needed.</li>
                        <li>
                            <strong>Non-Registered:</strong>
                            <ul className="list-disc pl-6 space-y-1 mt-2">
                                <li>Dividends and interest are paid out as cash and taxed each year.</li>
                                <li>Equity grows at the full Non-Reg Growth rate.</li>
                                <li>Dividend stocks' prices grow at 85% of whatever the Non-Reg Growth rate is above their dividend yield. Counting the dividend, their total return is a little lower than pure growth equity.</li>
                                <li>Bonds and cash pay interest only; their value doesn't change.</li>
                                <li>Growth doesn't raise your ACB, so gains build up until a sale, Fund Turnover or death realizes them.</li>
                            </ul>
                        </li>
                    </ul>
                    <h3 className="text-lg font-bold text-slate-900 mt-6">Multiple non-registered accounts</h3>
                    <p>
                        Each person can hold several non-registered accounts (e.g. a GIC ladder, a dividend portfolio, a growth ETF account):
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>Withdrawals minimize realized gains:</strong> sells first from the account with the smallest unrealized gain relative to its value, so each dollar withdrawn triggers as little taxable gain as possible.</li>
                        <li><strong>Surplus goes to one account:</strong> leftover cash each year is invested into the account marked <strong>Surplus</strong>.</li>
                        <li><strong>At death:</strong> a surviving spouse inherits each account as-is, keeping its own ACB and mix.</li>
                    </ul>
                    <h3 className="text-lg font-bold text-slate-900 mt-6">Rebalancing vs. drift</h3>
                    <p>
                        With <strong>Rebalance Annually</strong> on, each account resets to your chosen mix every year. With it off, the mix drifts toward equity, because equity grows fastest and bonds and cash don't grow at all. <strong>Fund Turnover</strong> is separate: it models the yearly tax from funds that sell holdings internally, and it applies either way.
                    </p>
                </div>
            </details>

            {/* Privacy Section */}
            <section id="privacy" className="bg-emerald-50/50 rounded-3xl p-8 border border-emerald-100 space-y-4">
                <h2 className="text-2xl font-bold text-emerald-900">
                    Privacy & data security
                </h2>
                <div className="max-w-none text-base text-slate-600 leading-relaxed">
                    <p>
                        Your data stays on your device. <strong>All calculations run locally in your web browser.</strong>
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>Nothing sent to a server:</strong> the projection engine and tax models run entirely on your device, and your financial information never leaves it.</li>
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
                            <h3 className="font-bold text-slate-900">{question}</h3>
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
