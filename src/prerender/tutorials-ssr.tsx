import { renderToStaticMarkup } from 'react-dom/server';
import { StandaloneTutorialsPage } from '../tutorials-page';

/**
 * Build-time SSR entry for /tutorials/. Built alongside the other SSR entries by
 * `vite build --config vite.config.ssr.ts` into `dist-ssr/tutorials-ssr.mjs`,
 * then imported by `scripts/prerender.mjs` after the main build to inject
 * prerendered HTML into `dist/tutorials/index.html`.
 *
 * The page has no FAQ, so this entry exports no `faqItems` and the prerender
 * script skips the FAQPage JSON-LD step for it.
 *
 * renderToStaticMarkup (not renderToString) because the page is never hydrated —
 * the client entry replaces #root wholesale on mount.
 */
export function render(): string {
    return renderToStaticMarkup(<StandaloneTutorialsPage />);
}
