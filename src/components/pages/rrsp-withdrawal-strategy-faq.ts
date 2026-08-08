import type { FaqItem } from './how-it-works-faq';

/**
 * Single source of truth for the RRSP Withdrawal Strategy page FAQ.
 *
 * Rendered by the FAQ section in `RrspWithdrawalStrategy.tsx` AND consumed by the
 * build-time prerender script (`scripts/prerender.mjs`, via the SSR entry
 * `src/prerender/rrsp-withdrawal-strategy-ssr.tsx`) to emit a schema.org
 * `FAQPage` JSON-LD block into `dist/rrsp-withdrawal-strategy/index.html`.
 *
 * Keep answers as plain text: they feed both the on-page prose and the
 * structured-data `acceptedAnswer.text`, so editing here updates both and
 * prevents the two copies from drifting apart. This is educational information,
 * not financial advice.
 */
export type { FaqItem };

export const RRSP_STRATEGY_FAQ_ITEMS: FaqItem[] = [
    {
        question: 'What is an RRSP meltdown?',
        answer:
            'An RRSP meltdown is a decumulation strategy that deliberately draws money out of your RRSP during your lower-income years — typically after you stop working but before CPP, OAS, and mandatory RRIF withdrawals all start stacking up. By withdrawing at low marginal tax rates instead of leaving the RRSP to grow, you can shrink the large tax bill that would otherwise land on the account later in retirement or at death, often leaving more for your estate.',
    },
    {
        question: 'When do I have to convert my RRSP to a RRIF?',
        answer:
            'You must convert your RRSP to a RRIF (or an annuity) by the end of the year you turn 71. Starting the following year — the year you turn 72 — a minimum percentage of the RRIF must be withdrawn and taxed as income every year, whether you need the cash or not. The minimum percentage rises with age, so a large RRIF can push mandatory income higher and higher over time.',
    },
    {
        question: 'How much tax is withheld on RRSP withdrawals?',
        answer:
            'Financial institutions apply withholding tax on RRSP withdrawals: outside Quebec it is 10% on amounts up to $5,000, 20% on $5,001 to $15,000, and 30% above $15,000. Quebec\'s federal withholding rates are lower, but provincial withholding is added on top. Important: withholding is not your final tax bill. The withdrawal is added to your income for the year and taxed at your actual marginal rate — you may owe more at tax time, or get some back as a refund.',
    },
    {
        question: 'Does an RRSP meltdown avoid OAS clawback?',
        answer:
            'It can help. OAS is reduced by a 15% recovery tax (the clawback) once your net income passes a threshold — about $95,300 in 2026. Drawing your RRSP down earlier, in years before OAS starts, can lower your RRIF minimums later and keep your taxable income under the clawback threshold once OAS is flowing. It does not always avoid the clawback entirely, but it can reduce how much OAS you lose.',
    },
    {
        question: 'Should I delay CPP and OAS to 70?',
        answer:
            'Delaying often pairs well with a meltdown, but it depends on your situation. Waiting past 65 permanently increases both CPP (about 0.7% more per month deferred) and OAS (0.6% per month), giving you a larger inflation-indexed, guaranteed-for-life benefit. Delaying also widens the low-income window in early retirement, creating more room to melt down the RRSP at low tax rates. The trade-off is spending your own savings sooner and needing to live long enough to come out ahead. The optimizer can test start ages from 60 to 70 for you.',
    },
    {
        question: 'What does decumulation mean?',
        answer:
            'Decumulation is the retirement phase of drawing down and spending the savings you built up during your working years — the opposite of accumulation. It covers which accounts you withdraw from and in what order, when you start CPP and OAS, and how you manage taxes as you spend. An RRSP meltdown is one decumulation strategy focused on the tax-efficient drawdown of registered savings.',
    },
    {
        question: 'When does an RRSP meltdown not make sense?',
        answer:
            'A meltdown helps most when you have a large RRSP, relatively low other income in early retirement, and want to leave a larger estate. It does little if your retirement income is already high every year, since you never get low-tax years to withdraw into. Be especially cautious if you are a lower-income retiree who may qualify for the Guaranteed Income Supplement (GIS): extra RRSP income is income-tested and can reduce GIS. This tool does not model GIS, so speak with an advisor before melting down near GIS eligibility.',
    },
    {
        question: 'Is my data private?',
        answer:
            'Yes. Everything runs locally in your browser. Your financial inputs are never sent to a server, there is no account to create, and none of your data leaves your device. The tool is completely free with no ads.',
    },
];
