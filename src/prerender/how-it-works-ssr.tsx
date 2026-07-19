import { renderToStaticMarkup } from 'react-dom/server';
import { StandaloneHowItWorksPage } from '../how-it-works-page';
import { FAQ_ITEMS } from '../components/pages/how-it-works-faq';

/**
 * Build-time SSR entry for /how-it-works/. Built with `vite build --config
 * vite.config.ssr.ts` into `dist-ssr/how-it-works-ssr.mjs`, then imported by
 * `scripts/prerender.mjs` after the main build to inject prerendered HTML and
 * FAQ JSON-LD into `dist/how-it-works/index.html`.
 *
 * renderToStaticMarkup (not renderToString) because the page is never hydrated —
 * the client entry replaces #root wholesale on mount, so we don't want React's
 * hydration data-* markers in the crawlable HTML.
 */
export function render(): string {
    return renderToStaticMarkup(<StandaloneHowItWorksPage />);
}

// Re-exported so the prerender script builds the FAQPage JSON-LD from the same
// source array the on-page FAQ renders from — no copy drift.
export const faqItems = FAQ_ITEMS;
