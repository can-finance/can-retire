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
            'There is no single number. It depends on what you spend, when you stop working, and what CPP, OAS and any pension will pay. This calculator works it out from your own numbers. Enter the retirement age and yearly spending you want, and it finds the household savings you need for your money to last to the end of the plan, at the confidence you choose. Amounts are in today\'s dollars. It is an estimate, not a promise. It uses the full planner\'s default assumptions: 2.5% inflation, about 5% average yearly growth on investments with random ups and downs, a plan that runs to age 90, and 2026 tax rules.',
    },
    {
        question: 'Why does the answer depend on which accounts my money is in?',
        answer:
            'Because each account is taxed differently. RRSP withdrawals count as taxable income, so a dollar in an RRSP buys less spending than a dollar in a TFSA, which comes out tax-free. A non-registered account pays tax on its interest, dividends and capital gains. The same total can fund different spending depending on how it is split. The calculator keeps your current mix of accounts and scales it. If you have twice as much in your RRSP as your TFSA now, the answer keeps that ratio, and a non-registered account keeps the same share of its balance that is growth. If you enter no savings at all, it assumes new money goes to a TFSA first, up to the room you could have built up by now, then to an RRSP (split evenly between spouses).',
    },
    {
        question: 'What does "you have enough" mean?',
        answer:
            'It means the savings you entered already last to the end of the plan at the confidence you chose. The calculator then shows how much lower your savings could be before that stops being true. If CPP, OAS and a pension cover your spending on their own, the answer is $0: you don\'t need savings to fund that spending. "Enough" is measured against your confidence level. At 85%, it means your money lasted in at least 85% of the market simulations, not in every one.',
    },
    {
        question: 'How is this different from the 4% rule or a multiple of my spending?',
        answer:
            'Rules like the 4% rule, which says to save 25 times your yearly spending, are quick guesses. They treat every dollar the same, so they ignore that RRSP withdrawals are taxed and TFSA withdrawals are not. They ignore when CPP and OAS start, and the OAS clawback on higher incomes. They assume a fixed retirement length. They also don\'t test bad luck early in retirement, called sequence of returns risk: poor markets in the first years hurt far more than the same losses later. This calculator runs your plan one year at a time with federal and provincial tax, CPP, OAS and the clawback, then checks it against hundreds of market simulations. Its answer can come out lower or higher than a simple multiple.',
    },
    {
        question: 'What confidence level should I pick?',
        answer:
            'The confidence is the share of market simulations in which your money lasts to the end of the plan. 85% (Balanced) is the recommended middle ground. 75% needs less in savings but accepts more risk of falling short. 95% needs more in savings but stays funded in almost every scenario. If you could cut spending when markets fall, a lower level may be enough. If you couldn\'t, a higher level is safer.',
    },
    {
        question: 'What if the answer is more than I can save?',
        answer:
            'The answer is what your plan needs. It is not a promise you can reach it. If no amount of savings works, the calculator says your spending is more than savings can fund. Your main options are to spend less after you retire or to retire later. Change the spending or the retirement age and run it again. To find the earliest age your current savings can support instead, use the When can I retire? calculator.',
    },
    {
        question: 'Does it include CPP and OAS?',
        answer:
            'Yes. CPP and OAS are included, along with the OAS clawback on higher incomes and any workplace pension you enter. CPP uses the full planner\'s default for years of contributions, not your own record, so treat it as a rough figure. For a closer number, use the CPP calculator and apply it in the full planner. At each amount of savings, the calculator also tries starting CPP at 60, 65 or 70 and OAS at 65 or 70, and keeps the mix that works.',
    },
    {
        question: 'Is my data private?',
        answer:
            'Yes. Everything runs locally in your browser. Your numbers are never sent to a server, there is no account to create, and none of your data leaves your device. The calculator is completely free with no ads.',
    },
];
