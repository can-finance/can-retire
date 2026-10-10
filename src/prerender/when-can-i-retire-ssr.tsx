import { renderToStaticMarkup } from 'react-dom/server';
import { StandaloneWhenCanIRetirePage } from '../when-can-i-retire-page';
import { WHEN_CAN_I_RETIRE_FAQ_ITEMS } from '../components/pages/when-can-i-retire-faq';

/**
 * Build-time SSR entry for /when-can-i-retire/. Built alongside the other SSR
 * entries by `vite build --config vite.config.ssr.ts` into
 * `dist-ssr/when-can-i-retire-ssr.mjs`, then imported by `scripts/prerender.mjs`
 * after the main build to inject prerendered HTML and FAQ JSON-LD into
 * `dist/when-can-i-retire/index.html`.
 *
 * The page is interactive, but its render path only reads React state seeded
 * from the planner's default plan — no window or localStorage — so it renders
 * here as the empty form plus the full prose and FAQ. The search itself only
 * runs from a click on the client.
 *
 * renderToStaticMarkup (not renderToString) because the page is never hydrated —
 * the client entry replaces #root wholesale on mount, so we don't want React's
 * hydration data-* markers in the crawlable HTML.
 */
export function render(): string {
    return renderToStaticMarkup(<StandaloneWhenCanIRetirePage />);
}

// Re-exported so the prerender script builds the FAQPage JSON-LD from the same
// source array the on-page FAQ renders from — no copy drift.
export const faqItems = WHEN_CAN_I_RETIRE_FAQ_ITEMS;
