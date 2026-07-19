// Build-time prerender for /how-it-works/.
//
// Runs after `vite build` (client) and `vite build --config vite.config.ssr.ts`
// (SSR). Imports the SSR bundle, renders the page to static HTML, and injects it
// into dist/how-it-works/index.html so non-JS crawlers see the full prose. Also
// emits a schema.org FAQPage JSON-LD block generated from the same FAQ_ITEMS
// array the on-page FAQ renders from (imported via the SSR bundle's faqItems).
//
// The client entry still runs createRoot().render() on load and replaces #root
// wholesale — we do not hydrate, so the injected markup only needs to be valid,
// not byte-identical to the client render.

import { readFileSync, writeFileSync } from 'node:fs';

const ssrModuleUrl = new URL('../dist-ssr/how-it-works-ssr.mjs', import.meta.url);
const htmlUrl = new URL('../dist/how-it-works/index.html', import.meta.url);

const { render, faqItems } = await import(ssrModuleUrl);

let html = readFileSync(htmlUrl, 'utf-8');

// 1. Inject the prerendered page HTML into the empty #root container.
const rootAnchor = '<div id="root"></div>';
if (!html.includes(rootAnchor)) {
    throw new Error(`prerender: could not find "${rootAnchor}" in dist/how-it-works/index.html`);
}
const appHtml = render();
html = html.replace(rootAnchor, `<div id="root">${appHtml}</div>`);

// 2. Inject the FAQPage JSON-LD, generated from the shared FAQ array.
const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(({ question, answer }) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: {
            '@type': 'Answer',
            text: answer,
        },
    })),
};
const faqScript =
    '    <script type="application/ld+json">\n' +
    JSON.stringify(faqJsonLd, null, 2) +
    '\n    </script>\n  ';
if (!html.includes('</head>')) {
    throw new Error('prerender: could not find </head> in dist/how-it-works/index.html');
}
html = html.replace('</head>', `${faqScript}</head>`);

writeFileSync(htmlUrl, html);

console.log(
    `prerender: injected ${appHtml.length} chars of HTML into #root and a FAQPage ` +
    `JSON-LD block with ${faqItems.length} questions into dist/how-it-works/index.html`,
);
