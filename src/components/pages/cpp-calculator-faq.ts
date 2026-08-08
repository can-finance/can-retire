import type { FaqItem } from './how-it-works-faq';

/**
 * Single source of truth for the CPP Calculator page FAQ.
 *
 * Rendered by the FAQ section in `CppCalculator.tsx` AND consumed by the
 * build-time prerender script (`scripts/prerender.mjs`, via the JSON-LD-only SSR
 * entry `src/prerender/cpp-calculator-ssr.tsx`) to emit a schema.org `FAQPage`
 * JSON-LD block into `dist/cpp-calculator/index.html`.
 *
 * Unlike the how-it-works and rrsp-withdrawal-strategy pages, CppCalculator.tsx
 * reads `window.localStorage` during render and cannot be server-rendered, so the
 * SSR entry re-exports ONLY this array — no page HTML is injected, just the FAQ
 * structured data.
 *
 * Keep answers as plain text: they feed both the on-page prose and the
 * structured-data `acceptedAnswer.text`, so editing here updates both and
 * prevents the two copies from drifting apart. This is educational information,
 * not financial advice.
 */
export type { FaqItem };

export const CPP_CALCULATOR_FAQ_ITEMS: FaqItem[] = [
    {
        question: 'How much CPP will I get?',
        answer:
            'It depends on how much you earned and for how long. The maximum base pension at 65 is about $17,300 a year — roughly $1,440 a month in 2026 — but reaching it takes close to 40 years of earning at or above the annual ceiling (the YMPE), which most people never do. Because of gaps, lower-earning years, and part-time work, many retirees receive around half the maximum or less. This calculator scores your own earnings history and shows what share of the maximum you qualify for.',
    },
    {
        question: 'When can I start CPP?',
        answer:
            'Any time between 60 and 70. Starting before 65 permanently reduces your pension by 0.6% for each month early — take it at 60 and that is 36% less. Waiting past 65 permanently increases it by 0.7% for each month you defer, so starting at 70 pays 42% more. There is no benefit to waiting beyond 70. The Benefit by Start Age chart on this page shows your own amount at every age from 60 to 70.',
    },
    {
        question: 'Is it better to take CPP at 60 or 70?',
        answer:
            'There is no single right answer. Taking it early gives you money sooner but a smaller cheque for life; waiting gives you a much larger, inflation-indexed benefit that is guaranteed as long as you live. It comes down to your health, other savings, and how long you expect to live. Ignoring investment returns and taxes, this page highlights the start age that pays the most in total by 85, and the full retirement dashboard can test how each choice plays out against your own savings and tax situation.',
    },
    {
        question: 'How is CPP actually calculated?',
        answer:
            'This tool follows the Service Canada method. It looks at every year from age 18 until your pension starts, and scores each year as your earnings divided by that year\'s earnings ceiling (the YMPE), capped at 100%. It then drops your lowest years — the general drop-out removes the weakest 17% — and averages the rest. That average is multiplied by 25% of the recent five-year average YMPE to get your pension at 65, which is then adjusted up or down for your start age. The on-page walkthrough shows each step with your numbers.',
    },
    {
        question: 'What is the child-rearing provision?',
        answer:
            'When you were the primary caregiver of a child under 7, your earnings often dropped. The child-rearing provision lets those low years be set aside so they do not drag down your average. This calculator applies it when you turn it on and enter your children\'s birth years: each child protects the seven years from birth, and only years where you earned below your career average are excluded. It can meaningfully raise your estimate. Note that only one parent can claim each period.',
    },
    {
        question: 'Is CPP taxable?',
        answer:
            'Yes. CPP retirement benefits are fully taxable as ordinary income in the year you receive them, and they count toward the net income used for the OAS clawback, which begins around $95,300 in 2026. This calculator shows your estimated pension before tax, in today\'s dollars. To see how CPP interacts with your other income, taxes, and OAS, use the full retirement dashboard, which models all of that together.',
    },
    {
        question: 'Can this estimate replace my Service Canada statement?',
        answer:
            'No — treat it as an estimate, not the official figure. This calculator works from the earnings history you type in, and it uses whole years and base CPP only. Your actual contribution record lives in My Service Canada Account, where the Statement of Contributions lists your real pensionable earnings year by year. For the most accurate result, sign in, copy that table (you can paste it straight into the Year-by-Year mode here), and cross-check the number before making any decisions.',
    },
    {
        question: 'Is my data private?',
        answer:
            'Yes. Everything runs locally in your browser. Your earnings history and other inputs are never sent to a server, there is no account to create, and none of your data leaves your device. The tool is completely free with no ads.',
    },
];
