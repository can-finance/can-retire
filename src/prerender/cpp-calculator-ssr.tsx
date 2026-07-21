import { CPP_CALCULATOR_FAQ_ITEMS } from '../components/pages/cpp-calculator-faq';

/**
 * Build-time SSR entry for /cpp-calculator/ — JSON-LD ONLY.
 *
 * Unlike the how-it-works and rrsp-withdrawal-strategy entries, this one does NOT
 * export a `render` function. `CppCalculator.tsx` reads `window.localStorage`
 * during render (the `savedPlan` useMemo), so it cannot be server-rendered — and
 * this module deliberately imports ONLY the FAQ array, never CppCalculator.tsx or
 * anything that touches `window`.
 *
 * `scripts/prerender.mjs` detects the missing `render` export and skips the #root
 * HTML injection for this page, emitting just the FAQPage JSON-LD from the shared
 * FAQ array below — keeping the on-page FAQ and structured data in sync.
 */
export const faqItems = CPP_CALCULATOR_FAQ_ITEMS;
