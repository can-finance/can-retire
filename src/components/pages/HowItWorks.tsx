
export function HowItWorks() {
    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20">
            {/* Header Section */}
            <section className="text-center space-y-4">
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">How the Canadian Retirement Asset Planning tool works</h1>

            </section>

            {/* Core Methodology */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                    Calculation logic
                </h2>
                <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed">
                    <p>
                        The engine performs a <strong>year-by-year cash flow simulation</strong> from your current age until your projected life expectancy (or your spouse's, whichever is later).
                    </p>
                    <p>
                        Each year, we look at:
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>Inflow:</strong> Collects baseline income from Employment, CPP, OAS, and mandatory RRIF minimums.</li>
                        <li><strong>Gap Analysis:</strong> Compares total net cash to your "Target Spend".</li>
                        <li><strong>Drawdown:</strong> If there's a deficit, it pulls funds from your accounts based on your selected strategy.</li>
                        <li><strong>Reinvestment:</strong> If there's a surplus, it automatically fills TFSA room, then RRSP room, then Non-Registered accounts.</li>
                        <li><strong>Growth:</strong> Finally, it applies investment returns to all remaining balances.</li>
                    </ul>
                </div>
            </section>

            {/* Withdrawal Strategies */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900">Withdrawal Strategies</h2>
                <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed">
                    <p>
                        <strong>Tax-Efficient:</strong> Draws from Non-Registered accounts first (lower tax), then TFSA (zero tax), and uses RRSPs last to defer taxes as long as possible.
                    </p>
                    <p>
                        <strong>RRSP First:</strong> Draws from RRSPs first to "melt" the balance early, potentially reducing huge tax bills at age 72 or at death.
                    </p>
                </div>
            </section>

            {/* Tax Logic */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-8">
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold text-slate-900">Taxation & Government Benefits</h2>
                    <p className="text-slate-600 text-sm">
                        The engine uses a built-in tax calculator for all 13 provinces and territories.
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        <h4 className="font-bold text-slate-900">Income Tax</h4>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            Applies federal and provincial brackets, including the Basic Personal Amount, Age Amount (65+), and Pension Income Credit.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-bold text-slate-900">OAS Clawback</h4>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            If your individual net income exceeds the threshold (~$91k in 2024), the engine calculates and deducts the 15% recovery tax.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-bold text-slate-900">Capital Gains</h4>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            Non-Registered withdrawals use your <strong>Adjusted Cost Base (ACB)</strong>. Only 50% of the gain portion is included in taxable income.
                        </p>
                    </div>
                </div>

                <div className="pt-6 border-t border-slate-100 flex items-center gap-4">
                    <div className="p-3 bg-slate-100 rounded-xl text-slate-600">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <p className="text-sm text-slate-500 italic">
                        Note: This is a planning tool, not a tax return. Calculations are approximations based on current tax law and do not account for all possible deductions or credits.
                    </p>
                </div>
            </section>

            {/* Asset Growth */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900">Investment Growth</h2>
                <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed">
                    <p>
                        Assets grow based on the "Return Rates" set in the Assumptions panel.
                        The engine separates <strong>Yield</strong> (Dividends/Interest) from <strong>Capital Growth</strong>.
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>In RRSP/TFSA:</strong> All returns are automatically reinvested and grow tax-free within the account.</li>
                        <li><strong>In Non-Registered:</strong> Yield is paid out as cash (and taxed) each year. Only the "Capital Growth" portion increases the account balance and ACB.</li>
                    </ul>
                </div>
            </section>

            {/* Privacy Section */}
            <section className="bg-emerald-50/50 rounded-3xl p-8 border border-emerald-100 space-y-4">
                <h2 className="text-2xl font-bold text-emerald-900 flex items-center gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 21a11.955 11.955 0 01-9.618-7.016m19.236 0a11.955 11.955 0 01-19.236 0" />
                    </svg>
                    Privacy & Data Security
                </h2>
                <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed">
                    <p>
                        Your privacy is built into the architecture of this tool.
                        <strong> All calculations are performed locally within your web browser.</strong>
                    </p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>No Data Transfer:</strong> None of your personal financial information is ever sent to a server.</li>
                        <li><strong>Local Logic:</strong> The projection engine and tax models run entirely on your own device.</li>
                        <li><strong>No Persistent Tracking:</strong> We do not use cookies or database systems to track your individual scenarios. Any "saved" scenarios are stored only in your browser's local storage.</li>
                    </ul>
                </div>
            </section>

            {/* Disclaimer Footer */}
            <footer className="pt-12 border-t border-slate-200 space-y-6">
                <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-4">Important Legal Disclaimer</p>
                    <div className="text-[11px] text-slate-500 leading-relaxed space-y-4">
                        <p>
                            <strong>For Informational Purposes Only:</strong> The Canadian Retirement Asset Planning (C.R.A.P.) tool is provided as a mathematical demonstration of retirement scenarios based on user-provided inputs and simplified tax/financial models. It does not constitute financial, investment, tax, or legal advice.
                        </p>
                        <p>
                            <strong>No Guarantees:</strong> Projections are purely hypothetical and are not guarantees of future results. Investment returns, inflation rates, and tax laws are volatile and subject to change without notice. The software may contain errors or omissions in its underlying logic or data constants.
                        </p>
                        <p>
                            <strong>Limitation of Liability:</strong> Under no circumstances shall the creators or distributors of this tool be liable for any financial losses, damages, or decisions made based on the information provided by this simulation. You assume full responsibility for any financial actions you take.
                        </p>
                        <p>
                            <strong>Professional Advice Required:</strong> Retirement planning is complex. You should not rely on this tool for making actual financial decisions. Always consult with a certified financial planner (CFP), qualified tax professional, or legal advisor before implementing any retirement or investment strategy.
                        </p>
                    </div>
                </div>
                <p className="text-[10px] text-slate-400 text-center">
                    &copy; {new Date().getFullYear()} Canadian Retirement Asset Planning tool. All rights reserved.
                </p>
            </footer>
        </div>
    );
}
