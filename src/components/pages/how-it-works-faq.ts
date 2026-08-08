/**
 * Single source of truth for the How It Works FAQ.
 *
 * Rendered by the FAQ section in `HowItWorks.tsx` AND consumed by the
 * build-time prerender script (`scripts/prerender.mjs`, via the SSR entry
 * `src/prerender/how-it-works-ssr.tsx`) to emit a schema.org `FAQPage`
 * JSON-LD block into `dist/how-it-works/index.html`.
 *
 * Keep answers as plain text: they feed both the on-page prose and the
 * structured-data `acceptedAnswer.text`, so editing here updates both and
 * prevents the two copies from drifting apart.
 */
export interface FaqItem {
    question: string;
    answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
    {
        question: 'Who made this?',
        answer:
            "I'm just a guy with some financial training and a Claude subscription. I originally made this to convert my own retirement planning spreadsheet into a web-based tool to explore different scenarios. It has since grown into a more fully featured product so I figured if it can help others, why not put it online.",
    },
    {
        question: 'Is it free?',
        answer:
            'Yes, completely free to use, with no ads. I may accept sponsors in the future, but all features will remain 100% free without any paywalls.',
    },
    {
        question: "What's with the name?",
        answer:
            "The Canadian Retirement Asset Planning tool's acronym is… intentional. Money, investing and retirement are serious business, but you can't take everything too seriously.",
    },
];
