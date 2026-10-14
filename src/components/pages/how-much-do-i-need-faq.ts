import type { FaqItem } from './how-it-works-faq';

/**
 * Single source of truth for the How Much Do I Need to Retire page FAQ.
 *
 * Rendered by the FAQ section in `HowMuchDoINeed.tsx` AND consumed by the
 * build-time prerender script (`scripts/prerender.mjs`, via the SSR entry
 * `src/prerender/how-much-do-i-need-ssr.tsx`) to emit a schema.org `FAQPage`
 * JSON-LD block into `dist/how-much-do-i-need-to-retire/index.html`.
 *
 * Keep answers as plain text: they feed both the on-page prose and the
 * structured-data `acceptedAnswer.text`, so editing here updates both and
 * prevents the two copies from drifting apart. Every claim here should match
 * what the calculator actually does (the savings search in `savingsSearch.ts`
 * and `meltdownOptimizer.ts`, how-much-do-i-need-inputs.ts). This is
 * educational information, not financial advice.
 */
export type { FaqItem };

export const HOW_MUCH_DO_I_NEED_FAQ_ITEMS: FaqItem[] = [
    {
        question: 'How much do I need to retire in Canada?',
        answer:
            'There is no single number. It depends on what you spend, when you stop working, and what CPP, OAS and any pension pay. Enter the retirement age and yearly spending you want, and this calculator finds the savings that last to the end of the plan at the confidence you choose. It is an estimate that uses the full planner\'s defaults: 2.5% inflation, about 5% average yearly growth with random ups and downs, a plan that runs to age 90, and 2026 tax rules.',
    },
    {
        question: 'Why does the answer depend on which accounts my money is in?',
        answer:
            'Each account is taxed differently. RRSP withdrawals are taxable income, TFSA withdrawals are tax-free, and non-registered accounts pay tax on interest, dividends and capital gains. So the same total can fund different spending. The calculator keeps your current mix: if you have twice as much in your RRSP as your TFSA now, the answer does too.',
    },
    {
        question: 'What does "you have enough" mean?',
        answer:
            'It means the savings you entered already last to the end of the plan at the confidence you chose. The calculator then shows how much lower your savings could be before that stops being true. If CPP, OAS and a pension cover your spending on their own, the answer is $0.',
    },
    {
        question: 'How is this different from the 4% rule or a multiple of my spending?',
        answer:
            'Rules like the 4% rule (save 25 times your yearly spending) are quick guesses. They treat every dollar the same, so they ignore that RRSP withdrawals are taxed and TFSA withdrawals are not, when CPP and OAS start, and the OAS clawback. They also don\'t test poor markets early in retirement, which hurt far more than the same losses later. This calculator runs your plan year by year and checks it against hundreds of market simulations, so its answer can come out lower or higher than a simple multiple.',
    },
    {
        question: 'What confidence level should I pick?',
        answer:
            'Confidence is the share of market simulations in which your money lasts to the end of the plan. 85% (Balanced) is the recommended middle ground. 75% needs less in savings but risks more; 95% needs more but stays funded in almost every scenario. If you could cut spending when markets fall, a lower level may be enough.',
    },
    {
        question: 'What if the answer is more than I can save?',
        answer:
            'The answer is what your plan needs, not a promise you can reach it. If no amount works, the calculator says your spending is more than savings can fund. You can spend less after you retire or retire later: change either and run it again. To find the earliest age your current savings can support, use the When can I retire? calculator.',
        links: [{ text: 'When can I retire? calculator', href: '/when-can-i-retire/' }],
    },
    {
        question: 'Can I save it as I go instead?',
        answer:
            'Yes, if you\'re still working. Along with the amount, the calculator finds how much less you could spend each year before you retire, saving the difference. That yearly amount rises with inflation and goes into your TFSA first, then RRSP room, then non-registered savings. If even saving everything you spend before retiring isn\'t enough, the answer says so.',
    },
    {
        question: 'What does the table of nearby ages show?',
        answer:
            'It shows about how much you\'d need if you retired up to three years earlier or later, at the same spending, next to what you\'re on track for and your odds with what you have now. The row for your own age is the main answer. The other rows are estimates that keep your answer\'s CPP and OAS start ages, RRSP meltdown and withdrawal order, so they may come out a little high.',
    },
    {
        question: 'Does it include CPP and OAS?',
        answer:
            'Yes, along with the OAS clawback on higher incomes and any workplace pension you enter. At each amount it tries starting CPP at 60, 65 or 70 and OAS at 65 or 70, and keeps what works best. CPP uses the full planner\'s default for years of contributions, not your own record, so use the CPP calculator for a closer figure and apply it in the full planner. A workplace pension is held as you enter it, so check your statement for the amount at your retirement age.',
        links: [{ text: 'CPP calculator', href: '/cpp-calculator/' }],
    },
    {
        question: 'Is my data private?',
        answer:
            'Yes. Everything runs in your browser. Your numbers are never sent to a server, and there is no account to create. The calculator is free, with no ads.',
    },
];
