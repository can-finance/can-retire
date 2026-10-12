import type { FaqItem } from './how-it-works-faq';

/**
 * Single source of truth for the When Can I Retire page FAQ.
 *
 * Rendered by the FAQ section in `WhenCanIRetire.tsx` AND consumed by the
 * build-time prerender script (`scripts/prerender.mjs`, via the SSR entry
 * `src/prerender/when-can-i-retire-ssr.tsx`) to emit a schema.org `FAQPage`
 * JSON-LD block into `dist/when-can-i-retire/index.html`.
 *
 * Keep answers as plain text: they feed both the on-page prose and the
 * structured-data `acceptedAnswer.text`, so editing here updates both and
 * prevents the two copies from drifting apart. Every claim here should match
 * what the calculator actually does (meltdownOptimizer.ts' earliest-age
 * search, retirementAgeSearch.ts, when-can-i-retire-inputs.ts). This is
 * educational information, not financial advice.
 */
export type { FaqItem };

export const WHEN_CAN_I_RETIRE_FAQ_ITEMS: FaqItem[] = [
    {
        question: 'When can I retire in Canada?',
        answer:
            'There is no set retirement age in Canada. You can stop working whenever your savings, pensions and government benefits can pay for the life you want. CPP can start any time from 60 to 70, and OAS from 65 to 70. This calculator finds the earliest age your own numbers support, at the spending you enter.',
    },
    {
        question: 'How much do I need to retire?',
        answer:
            'It depends on what you spend, when you stop working, and what CPP, OAS and any pension will pay. This calculator answers the age question: with what you have and plan to spend, how soon can you stop? The "Could spend" column shows the other side: about the most you could spend each year retiring at each age in the table. To see what your savings can support at a retirement age you choose, open the full planner and choose "Spend the most in retirement" in the optimizer.',
    },
    {
        question: 'What does 85% success mean?',
        answer:
            'The calculator runs your plan through hundreds of market simulations, where returns go up and down from year to year. 85% success means your money lasted to the end of the plan in 85% of them. You spent the same amount each year, rising with inflation. In the other 15%, money ran short at some point. Choosing 95% gives a later, safer retirement age. Choosing 75% gives an earlier one with more risk.',
    },
    {
        question: 'Does it include CPP and OAS?',
        answer:
            'Yes. We assume 35 years of CPP contributions if you work to your target age (or 65). Retire earlier and you have fewer years, so your CPP is a bit lower. Only years before 65 count. OAS is included, and so is the OAS clawback on higher incomes. At each age we also try starting CPP at 60, 65 or 70 and OAS at 65 or 70. We keep the mix that works and leaves the most at the end. For a closer CPP figure, use the CPP calculator and apply it in the full planner.',
    },
    {
        question: 'What about my workplace pension?',
        answer:
            'If you have a defined benefit pension, enter what it pays per year and the age it starts. It is held exactly as you enter it: the calculator does not lower it if you retire earlier, because it does not know your plan\'s rules. Most workplace pensions pay less for fewer years of service or an early start, so check your pension statement for the amount at the age you are considering. The pension is assumed to rise with inflation; you can change that in the full planner.',
    },
    {
        question: 'Can I include my spouse?',
        answer:
            'Yes. Turn on "Include a spouse" and add their age, income and savings, and their workplace pension if they have one. If your spouse has income, the calculator assumes they stop working at the same age as you (or now, if they are already past that age), and it moves both retirement ages together. If they have no income, we treat them as already retired. You can set different retirement ages in the full planner.',
    },
    {
        question: 'How accurate is the answer?',
        answer:
            'It is an estimate, not a promise. It uses the full planner\'s default assumptions: 2.5% inflation, about 5% average yearly growth on investments with random ups and downs, a plan that runs to age 90, and 2026 tax rules. Real markets, tax rules and your spending will differ. Use the answer as a starting point. See how much a year earlier or later changes things, and run it again every year or two.',
    },
    {
        question: 'Is my data private?',
        answer:
            'Yes. Everything runs locally in your browser. Your numbers are never sent to a server, there is no account to create, and none of your data leaves your device. The calculator is completely free with no ads.',
    },
];
