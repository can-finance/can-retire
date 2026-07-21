// Build-time prerender for the standalone MPA pages (/how-it-works/,
// /rrsp-withdrawal-strategy/, and /cpp-calculator/).
//
// Runs after `vite build` (client) and `vite build --config vite.config.ssr.ts`
// (SSR). For each page it imports the SSR bundle and injects a schema.org
// FAQPage JSON-LD block generated from the same FAQ array the on-page FAQ renders
// from (imported via each SSR bundle's faqItems).
//
// When the SSR bundle also exports a `render` function, the page is rendered to
// static HTML and injected into dist/<route>/index.html's empty #root so non-JS
// crawlers see the full prose. Some pages (e.g. /cpp-calculator/, which reads
// window.localStorage during render) cannot be server-rendered: their SSR entry
// exports faqItems but no `render`, so we skip the #root step and emit only the
// JSON-LD.
//
// The client entry still runs createRoot().render() on load and replaces #root
// wholesale — we do not hydrate, so the injected markup only needs to be valid,
// not byte-identical to the client render.

import { readFileSync, writeFileSync } from 'node:fs';

// Each page: the SSR bundle emitted by vite.config.ssr.ts (entryFileNames
// `<name>-ssr.mjs`) and the dist route folder whose index.html we inject into.
const PAGES = [
    { ssrModule: 'how-it-works-ssr.mjs', route: 'how-it-works' },
    { ssrModule: 'rrsp-withdrawal-strategy-ssr.mjs', route: 'rrsp-withdrawal-strategy' },
    { ssrModule: 'cpp-calculator-ssr.mjs', route: 'cpp-calculator' },
];

for (const { ssrModule, route } of PAGES) {
    const ssrModuleUrl = new URL(`../dist-ssr/${ssrModule}`, import.meta.url);
    const htmlUrl = new URL(`../dist/${route}/index.html`, import.meta.url);

    const { render, faqItems } = await import(ssrModuleUrl);

    let html = readFileSync(htmlUrl, 'utf-8');

    // 1. Inject the prerendered page HTML into the empty #root container — only
    //    for pages whose SSR entry exports a `render`. JSON-LD-only pages (no
    //    `render`) skip this step and leave #root empty for the client to fill.
    let appHtml = '';
    if (typeof render === 'function') {
        const rootAnchor = '<div id="root"></div>';
        if (!html.includes(rootAnchor)) {
            throw new Error(`prerender: could not find "${rootAnchor}" in dist/${route}/index.html`);
        }
        appHtml = render();
        html = html.replace(rootAnchor, `<div id="root">${appHtml}</div>`);
    }

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
        throw new Error(`prerender: could not find </head> in dist/${route}/index.html`);
    }
    html = html.replace('</head>', `${faqScript}</head>`);

    writeFileSync(htmlUrl, html);

    console.log(
        typeof render === 'function'
            ? `prerender: injected ${appHtml.length} chars of HTML into #root and a FAQPage ` +
              `JSON-LD block with ${faqItems.length} questions into dist/${route}/index.html`
            : `prerender: injected a FAQPage JSON-LD block with ${faqItems.length} questions ` +
              `into dist/${route}/index.html (JSON-LD only; #root left empty)`,
    );
}
