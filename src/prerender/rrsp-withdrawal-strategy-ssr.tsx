import { renderToStaticMarkup } from 'react-dom/server';
import { StandaloneRrspWithdrawalStrategyPage } from '../rrsp-withdrawal-strategy-page';
import { RRSP_STRATEGY_FAQ_ITEMS } from '../components/pages/rrsp-withdrawal-strategy-faq';

/**
 * Build-time SSR entry for /rrsp-withdrawal-strategy/. Built alongside the
 * how-it-works SSR entry by `vite build --config vite.config.ssr.ts` into
 * `dist-ssr/rrsp-withdrawal-strategy-ssr.mjs`, then imported by
 * `scripts/prerender.mjs` after the main build to inject prerendered HTML and
 * FAQ JSON-LD into `dist/rrsp-withdrawal-strategy/index.html`.
 *
 * renderToStaticMarkup (not renderToString) because the page is never hydrated —
 * the client entry replaces #root wholesale on mount, so we don't want React's
 * hydration data-* markers in the crawlable HTML.
 */
export function render(): string {
    return renderToStaticMarkup(<StandaloneRrspWithdrawalStrategyPage />);
}

// Re-exported so the prerender script builds the FAQPage JSON-LD from the same
// source array the on-page FAQ renders from — no copy drift.
export const faqItems = RRSP_STRATEGY_FAQ_ITEMS;
