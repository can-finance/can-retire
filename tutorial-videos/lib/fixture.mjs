// Saved-app-state fixtures: a JSON dump of localStorage that a tutorial loads
// before the first paint, so it can start on the dashboard with a plan already
// saved instead of replaying Guided Setup.
//
// A fixture is built once by driving the real app (no video, no pacing) and
// dumped to fixtures/<name>.json. Delete the file, or pass --refresh-fixture to
// a tutorial, to rebuild it after the app's storage shape changes.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(HERE, '..', 'fixtures');

/**
 * Return the fixture's { key: value } map, building it first when it is missing
 * (or when `refresh` is set).
 * @param {string} name   fixtures/<name>.json
 * @param {(page: import('playwright').Page) => Promise<void>} build  drives the app into the wanted state
 * @param {{ baseUrl: string, size: {width:number,height:number}, refresh?: boolean }} o
 */
export async function ensureFixture(name, build, o) {
    const file = path.join(FIXTURE_DIR, `${name}.json`);
    if (!o.refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));

    console.log(`building fixture ${name} ...`);
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({ viewport: o.size, locale: 'en-CA', timezoneId: 'America/Toronto' });
        const page = await context.newPage();
        await page.goto(new URL('/', o.baseUrl).href, { waitUntil: 'domcontentloaded' });
        await build(page);
        const storage = await page.evaluate(() => {
            const out = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                out[k] = localStorage.getItem(k);
            }
            return out;
        });
        mkdirSync(FIXTURE_DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(storage, null, 2) + '\n');
        console.log(`wrote ${file} (${Object.keys(storage).length} keys)`);
        return storage;
    } finally {
        await browser.close();
    }
}

/** Load a { key: value } map into localStorage before any app script runs. */
export async function seedStorage(context, storage) {
    await context.addInitScript((s) => {
        try {
            // Only on a fresh origin: never stomp on state the tutorial itself
            // changes and then reloads.
            if (sessionStorage.getItem('tut-seeded')) return;
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
            sessionStorage.setItem('tut-seeded', '1');
        } catch { /* storage blocked: the app falls back to defaults */ }
    }, storage);
}
