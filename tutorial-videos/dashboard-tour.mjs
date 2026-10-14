// Tutorial: Dashboard guided tour — the Projected Net Worth chart, Annual Cash
// Flow (with a year's full breakdown), how a surplus in retirement is
// reinvested, and the Year-by-Year Breakdown. Output: out/dashboard-tour.mp4
//
// Recorded as scenes (see README): re-record one with
//   node dashboard-tour.mjs --scene cashflow
//
// Starts on the dashboard with a saved plan (fixtures/dashboard-alex.json,
// built from Guided Setup's Quick start on first run). Persona: the pilot's
// Alex, except retirement spending is $40,000 rather than $52,000 so that
// RRIF minimums from 72 exceed spending and a retirement surplus appears.

import { recordScenes, BASE_URL, SIZE } from './lib/recorder.mjs';
import { ALEX, chartCard, chartPoint, guidedSetup, quickStartPlan, yearDrawer } from './lib/app.mjs';
import { ensureFixture } from './lib/fixture.mjs';

const PERSONA = ALEX;

const storage = await ensureFixture('dashboard-alex', (page) => quickStartPlan(page, PERSONA), {
    baseUrl: BASE_URL,
    size: SIZE,
    refresh: process.argv.includes('--refresh-fixture'),
});

// Once the page scrolls, the summary cards stick under the app header and cover
// the top ~220px; a card scrolled to this top sits just below them.
const CARD_TOP = 232;

/**
 * Glide onto an element without Tutor.moveTo's scroll-into-view: chart legends
 * sit low enough that it would scroll the page.
 */
async function glideTo(t, locator) {
    const b = await locator.boundingBox();
    await t.move(b.x + b.width / 2, b.y + b.height / 2);
}

/** Smoothly scroll the year drawer's body so a section heading sits near its top. */
async function drawerScrollTo(t, drawer, heading) {
    const body = drawer.locator('.overflow-y-auto');
    const el = drawer.getByRole('heading', { name: heading, exact: true });
    const dy = await el.evaluate((h, b) => h.getBoundingClientRect().top - b.getBoundingClientRect().top - 16, await body.elementHandle());
    await t.scroll(dy, { ms: 1600, target: body });
}

/** Close the year drawer and leave nothing behind (focus ring, hover tooltip). */
async function closeDrawer(t, page, drawer) {
    // Guided Setup's tooltip lives under the Close button, and Chrome re-hovers
    // whatever is under a still cursor the moment the drawer goes, faster than
    // any glide away. So: show the click, but switch page hover off and fire
    // the button's click directly, glide off the header, then restore hover.
    const close = drawer.getByRole('button', { name: 'Close' });
    await t.moveTo(close);
    await t.pause(380);
    await t.clickEffect(null, { highlight: false });
    await page.evaluate(() => { document.body.style.pointerEvents = 'none'; });
    await close.dispatchEvent('click');
    await t.pause(90);
    await page.evaluate(() => window.__tut.press(false));
    await t.move(t.x, 245, { ms: 200 });
    await t.move(1150, 245, { ms: 350 });
    await page.evaluate(() => { document.body.style.pointerEvents = ''; });
    await drawer.waitFor({ state: 'detached' });
    // The drawer hands focus back to the chart bar (an SVG <g>, so not an
    // HTMLElement), which then shows a focus ring. The hand-back lands a moment
    // after the drawer leaves the DOM, so wait for it before blurring.
    await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body, null, { timeout: 1000 }).catch(() => {});
    await page.evaluate(() => document.activeElement?.blur?.());
}

await recordScenes({
    name: 'dashboard-tour',
    url: '/',
    storage,
    start: { x: 1160, y: 258 }, // in the gap above the charts: no tooltip as the title card lifts
    title: { title: 'Your dashboard, explained', subtitle: 'Charts, cash flow and the year-by-year breakdown' },
    end: {
        title: 'Canadian Retirement Asset Planning Tool',
        subtitle: '100% free, private and secure',
        url: 'craptool.ca',
    },

    async ready(t, page) {
        await page.getByRole('heading', { name: 'Projected Net Worth' }).waitFor();
        await page.waitForLoadState('networkidle');
        if (await guidedSetup(page).count()) throw new Error('Guided Setup opened: the saved-plan fixture did not load');
        await t.pause(1600); // chart entry animations
    },

    scenes: [
        // --- 1. Projected Net Worth -----------------------------------------
        {
            id: 'networth',
            async run(t, page) {
                const card = chartCard(page, 'Projected Net Worth');
                await t.scrollToTop(card, CARD_TOP, { ms: 1000 });
                await t.caption('Projected Net Worth simulates your plan year by year, to age 90.', 0, { pos: 'top' });
                let p = await chartPoint(card, 47, 0.85);
                await t.move(p.x, p.y);
                await t.pause(2600);
                await t.caption('Until retirement at 62, savings and growth build every account.', 0, { pos: 'top' });
                p = await chartPoint(card, 61, 0.62);
                await t.move(p.x, p.y, { ms: 2600 });
                await t.pause(1600);
                await t.caption('After 62, withdrawals fund your spending; what’s left keeps growing.', 0, { pos: 'top' });
                p = await chartPoint(card, 66, 0.62);
                await t.move(p.x, p.y, { ms: 1400 });
                await t.pause(2800);
                await t.caption('Hover any age to see each account’s balance that year.', 0, { pos: 'top' });
                p = await chartPoint(card, 75, 0.55);
                await t.move(p.x, p.y, { ms: 1400 });
                await t.pause(1200);
                p = await chartPoint(card, 80, 0.5);
                await t.move(p.x, p.y, { ms: 1600 });
                await t.pause(2200);
                await t.hideCaption();
                // Off the plot so no tooltip is left up for the next scene.
                await t.move(1150, 245);
            },
        },

        // --- 2. Annual Cash Flow + a year's breakdown ------------------------
        {
            id: 'cashflow',
            async run(t, page) {
                const card = chartCard(page, 'Annual Cash Flow (Net)');
                await t.scrollToTop(card, CARD_TOP, { ms: 1500 });
                await t.caption('Annual Cash Flow shows where each year’s after-tax money comes from.', 0, { pos: 'top' });
                let p = await chartPoint(card, 50, 0.35);
                await t.move(p.x, p.y);
                await t.pause(2400);
                p = await chartPoint(card, 66, 0.45);
                await t.move(p.x, p.y, { ms: 1800 });
                await t.pause(1400);
                // Point at legend entries rather than the plot, so no tooltip
                // covers the bars or line being described.
                const legend = card.locator('.recharts-legend-wrapper');
                await t.caption('Red bars below zero are the tax paid that year.', 0, { pos: 'top' });
                await glideTo(t, legend.getByText('Taxes Paid', { exact: true }));
                await t.pause(2800);
                await t.caption('The black line is your target spending, rising with inflation.', 0, { pos: 'top' });
                await glideTo(t, legend.getByText('Target Spend', { exact: true }));
                await t.pause(3000);
                await t.caption('Each bar opens that year’s full breakdown.', 0, { pos: 'top' });
                p = await chartPoint(card, 65, 0.5);
                await t.move(p.x, p.y, { ms: 900 });
                await t.pause(1400);
                await t.hideCaption();
                await t.clickAt(p.x, p.y);

                const drawer = yearDrawer(page);
                await drawer.waitFor();
                await t.pause(300);
                await t.caption('Gross income and withdrawals, then the tax on each.', 0, { pos: 'left' });
                await t.moveTo(drawer.getByText('Total cash in (pre-tax)', { exact: true }).first());
                await t.pause(3000);
                await t.caption('Then net income against your target spending.', 0, { pos: 'left' });
                await drawerScrollTo(t, drawer, 'Net income & spending');
                await t.moveTo(drawer.getByText('Cash available to spend', { exact: true }));
                await t.pause(3000);
                await t.caption('Each account: opening balance, flows, growth, closing balance.', 0, { pos: 'left' });
                await drawerScrollTo(t, drawer, 'Account balances');
                await t.moveTo(drawer.getByText('Investment growth', { exact: true }).first());
                await t.pause(3400);
                await t.hideCaption();
                await closeDrawer(t, page, drawer);
            },
        },

        // --- 3. Surplus in retirement ----------------------------------------
        {
            id: 'surplus',
            async run(t, page) {
                const flow = chartCard(page, 'Annual Cash Flow (Net)');
                await t.scrollToTop(flow, CARD_TOP, { ms: 600 });
                await t.caption('From 72, RRIF minimums push income above spending: a surplus.', 0, { pos: 'top' });
                // On the legend's RRSP entry (RRIF withdrawals are the blue bars),
                // so no tooltip hides the bars rising above the line.
                await glideTo(t, flow.locator('.recharts-legend-wrapper').getByText('RRSP', { exact: true }));
                await t.pause(3400);
                let p = await chartPoint(flow, 72, 0.5);
                await t.move(p.x, p.y, { ms: 1400 });
                await t.pause(400);
                await t.hideCaption();
                await t.clickAt(p.x, p.y);

                const drawer = yearDrawer(page);
                await drawer.waitFor();
                await t.pause(300);
                await t.caption('It’s required by law, needed or not.', 0, { pos: 'left' });
                await t.moveTo(drawer.getByText('Mandatory RRIF minimum', { exact: true }));
                await t.pause(3600);
                await t.caption('The extra isn’t spent. It’s reinvested in your accounts.', 0, { pos: 'left' });
                await drawerScrollTo(t, drawer, 'Net income & spending');
                await t.moveTo(drawer.getByText('Surplus reinvested', { exact: true }).first());
                await t.pause(3200);
                await t.hideCaption();
                await closeDrawer(t, page, drawer);

                const card = chartCard(page, 'Surplus Reinvestment');
                await t.scrollToTop(card, CARD_TOP, { ms: 1600 });
                await t.caption('Surplus fills your TFSA first, up to that year’s contribution limit.', 0, { pos: 'top' });
                p = await chartPoint(card, 72, 0.8);
                await t.move(p.x, p.y, { ms: 1000 });
                await t.pause(800);
                p = await chartPoint(card, 82, 0.8);
                await t.move(p.x, p.y, { ms: 1800 });
                await t.pause(1800);
                await t.caption('While working, RRSP room comes next; the rest goes to Non-Reg.', 0, { pos: 'top' });
                p = await chartPoint(card, 52, 0.82);
                await t.move(p.x, p.y, { ms: 1800 });
                await t.pause(3600);
                await t.hideCaption();
                // Leave by dropping straight below the plot, then along the
                // legend row: a diagonal to the park point crosses the empty
                // 62–71 band and pops an empty "Age 65" tooltip.
                const cb = await card.boundingBox();
                await t.move(p.x, cb.y + cb.height - 12, { ms: 500 });
                await t.move(1150, cb.y + cb.height - 12, { ms: 900 });
            },
        },

        // --- 4. Year-by-Year Breakdown ---------------------------------------
        {
            id: 'table',
            async run(t, page) {
                const table = page.locator('#year-by-year');
                await t.scrollToTop(table, CARD_TOP - 8, { ms: 2200 });
                await t.caption('Year-by-Year Breakdown: the numbers behind the charts, one row per year.', 0, { pos: 'top' });
                await t.moveTo(page.getByRole('heading', { name: 'Year-by-Year Breakdown' }));
                await t.pause(2800);
                await t.caption('Hover any column heading for how it’s calculated.', 0, { pos: 'top' });
                await t.moveTo(table.locator('th').filter({ hasText: 'Surplus' }).locator('span.cursor-help'));
                await t.pause(3800);
                await t.caption('Account details adds a balance column for each account.', 0, { pos: 'top' });
                await t.click(page.getByRole('button', { name: 'Account details' }));
                await t.pause(2600);
                await t.caption('Every row opens the same full breakdown for that year.', 0, { pos: 'top' });
                const box = table.locator('.overflow-auto');
                await t.move(560, 560);
                // Down to the RRIF years, where Surplus / Shortfall turns green again.
                const row = page.getByRole('row', { name: 'Open 2053 breakdown' });
                const dy = await row.evaluate((r, b) => r.getBoundingClientRect().top - b.getBoundingClientRect().top - 150, await box.elementHandle());
                await t.scroll(dy, { ms: 3000, target: box });
                await t.moveTo(row, { at: { x: 70, y: 20 } });
                await t.pause(2800);
                await t.hideCaption();
            },
        },
    ],
});
