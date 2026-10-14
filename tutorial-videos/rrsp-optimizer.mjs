// Tutorial: RRSP meltdown optimizer — what it is for, the goals it offers,
// running "Leave the largest estate" on Alex's plan and reading the result,
// then applying it and seeing the dashboard update.
// Output: out/rrsp-optimizer.mp4
//
// Recorded as scenes (see README): re-record one with
//   node rrsp-optimizer.mjs --scene results
//
// Starts on the dashboard with the same saved plan as the other tutorials
// (fixtures/dashboard-alex.json: no RRSP melt, CPP and OAS at 65, RRSP last).
// Every scene starts from a fresh page load of that plan, so scenes that begin
// inside the optimizer re-open it (and re-run the search, about a second) in
// `before`, under the black cover, and jump to where the previous scene ended.
//
// Don't toggle Show Today's Dollars here: the captions quote the nominal
// figures, and the delta tiles and comparison table both follow the toggle.

import { recordScenes, BASE_URL, SIZE } from './lib/recorder.mjs';
import { ALEX, field, guidedSetup, quickStartPlan } from './lib/app.mjs';
import { ensureFixture } from './lib/fixture.mjs';

const storage = await ensureFixture('dashboard-alex', (page) => quickStartPlan(page, ALEX), {
    baseUrl: BASE_URL,
    size: SIZE,
    refresh: process.argv.includes('--refresh-fixture'),
});

// Dashboard: gutter between the inputs column and the charts.
const PARK_X = 427;
// Optimizer: right margin, outside the centred setup card (x 193–1087).
const MARGIN_X = 1170;

// Scroll positions shared by a scene's end and the next scene's `before`.
const GOALS_Y = 440;    // setup screen with the goal cards under the header
const ACTIONS_Y = 230;  // results with the delta tiles and the action buttons

/** How long a caption stays up: long enough to read twice at a calm pace. */
const readMs = (text) => Math.max(2300, 700 + text.length * 46);

const scrollY = (page) => page.evaluate(() => window.scrollY);

/** Smooth-scroll the window to an absolute position. */
async function scrollTo(t, page, y, { ms = 1200 } = {}) {
    const dy = y - (await scrollY(page));
    if (Math.abs(dy) > 1) await t.scroll(dy, { ms });
}

/** Glide onto an element (no scroll-into-view: the sticky bars would hide it). */
async function glide(t, locator, { dx = 0.5, dy = 0.5, ms } = {}) {
    const b = await locator.boundingBox();
    await t.move(b.x + b.width * dx, b.y + b.height * dy, ms ? { ms } : undefined);
}

/** Point at an element while its caption shows. */
async function explain(t, locator, text, { dwell, pos = 'bottom', ...g } = {}) {
    if (locator) await glide(t, locator, g);
    await t.caption(text, 0, { pos });
    await t.pause(dwell ?? readMs(text));
}

/** Click something and leave no focus ring behind. */
async function press(t, page, locator) {
    await t.click(locator, { highlight: false });
    await page.evaluate(() => document.activeElement?.blur?.());
}

/** A results-table row by its first cell's exact text. */
const row = (page, label) =>
    page.locator('tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*$`) }) }).first();

// --- Off-camera setup for scenes that start inside the optimizer ------------

async function openOptimizer(page) {
    await page.getByRole('button', { name: /Optimize Meltdown/ }).dispatchEvent('click');
    await page.getByText('What is an RRSP meltdown?').waitFor();
}

async function runEstate(page) {
    await openOptimizer(page);
    await page.getByRole('button', { name: 'Find my largest estate' }).dispatchEvent('click');
    await page.getByRole('button', { name: 'Apply to current plan' }).waitFor({ timeout: 120000 });
    await page.waitForTimeout(1200); // chart entry animation
    await expectResult(page);
}

/**
 * The captions quote the recommendation's deterministic numbers. If the app's
 * answer for Alex changes, fail rather than film captions that no longer match.
 */
async function expectResult(page) {
    const cell = (label) => row(page, label).locator('td').last().innerText();
    const got = [await cell('RRSP melt amount'), await cell('CPP start age'), await cell('OAS start age'), await cell('Withdrawal order'),
        await page.getByText('Net estate', { exact: true }).first().locator('xpath=following-sibling::p[1]').innerText()];
    const want = ['$56,750/yr', '70', '70', 'RRSP last', '+$400,002'];
    if (got.join('|') !== want.join('|')) throw new Error(`Optimizer result changed: ${got.join(' | ')} (captions expect ${want.join(' | ')})`);
}

const jump = (page, y) => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y);

await recordScenes({
    name: 'rrsp-optimizer',
    url: '/',
    storage,
    start: { x: PARK_X, y: 420 },
    title: { title: 'The RRSP meltdown optimizer', subtitle: 'Melt amount, CPP/OAS timing and withdrawal order, searched for you' },
    end: {
        title: 'Canadian Retirement Asset Planning Tool',
        subtitle: '100% free, private and secure',
        url: 'craptool.ca',
    },

    async ready(t, page) {
        await page.getByRole('heading', { name: 'Projected Net Worth' }).waitFor();
        await page.waitForLoadState('networkidle');
        if (await guidedSetup(page).count()) throw new Error('Guided Setup opened: the saved-plan fixture did not load');
        // No help tooltips while gliding (none is hovered on purpose here), and
        // no smooth scrolling under Tutor.scroll (see all-inputs.mjs).
        await page.addStyleTag({ content: '[role="tooltip"] { display: none !important; } html { scroll-behavior: auto !important; }' });
        // The optimizer's Monte Carlo pass draws from Math.random, so each
        // scene's re-run would show different success rates and the joins
        // would cross-fade between them. A seeded generator (mulberry32) makes
        // every scene's search return the same numbers.
        await page.evaluate(() => {
            let a = 20261014;
            Math.random = () => {
                a = (a + 0x6d2b79f5) | 0;
                let x = Math.imul(a ^ (a >>> 15), 1 | a);
                x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
                return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
            };
        });
        await t.pause(1600); // chart entry animations
    },

    scenes: [
        // --- 1. Alex's plan, and the two ways in ------------------------------
        {
            id: 'intro',
            async run(t, page) {
                await explain(t, page.getByText('Net Estate', { exact: true }).first(),
                    'Alex retires at 62 with a $320k RRSP, and melts none of it.', { pos: 'right', dx: 0.97, dy: 2.2 });
                await explain(t, null,
                    'Net estate: $2,310,089, after $432,757 of tax at death.', { pos: 'right' });
                await t.hideCaption();
                await explain(t, page.getByRole('button', { name: /Optimize Meltdown/ }),
                    'Optimize Meltdown, in Plan Manager, opens the optimizer.', { pos: 'right', dx: 0.45 });
                await t.hideCaption();
                await t.move(PARK_X, 470, { ms: 600 });

                const melt = field(page, 'RRSP Melt Amount');
                const top = (await melt.boundingBox()).y + (await scrollY(page));
                await scrollTo(t, page, top - 339, { ms: 1800 });
                await explain(t, melt,
                    'RRSP Melt Amount is $0: no early RRSP withdrawals in this plan.', { pos: 'right' });
                const link = page.getByRole('button', { name: /Not sure how much to melt/ });
                await explain(t, link,
                    'This link beside it opens the same optimizer.', { pos: 'right', dx: 0.4 });
                await t.hideCaption();
                await t.click(link, { highlight: false });
                await page.getByText('What is an RRSP meltdown?').waitFor();
                await t.pause(500);
                await t.move(MARGIN_X, 330, { ms: 700 });
                await scrollTo(t, page, 0, { ms: 1400 });
                await t.pause(300);
            },
        },

        // --- 2. What a meltdown is, and what the optimizer searches -----------
        {
            id: 'what',
            async before(t, page) {
                await openOptimizer(page);
                await jump(page, 0);
            },
            async run(t, page) {
                const p1 = page.getByText(/An RRSP meltdown means withdrawing/);
                await explain(t, p1, 'A meltdown draws down the RRSP early, while income is low.', { dx: 0.3, dy: 0.15 });
                await explain(t, p1, 'From 72, RRIF minimums are forced out on top of CPP and OAS.', { dx: 0.55, dy: 0.4 });
                await explain(t, p1, 'And whatever is left in the RRSP is taxed as income at death.', { dx: 0.7, dy: 0.85 });
                const p2 = page.getByText(/The optimizer tries a range/);
                await explain(t, p2, 'The optimizer tries melt amounts, CPP and OAS start ages, and withdrawal orders.', { dx: 0.35, dy: 0.25 });
                await explain(t, p2, 'The melt always starts at retirement and runs to 71.', { dx: 0.3, dy: 0.8 });
                await explain(t, page.getByText('Optimizing plan', { exact: true }),
                    'It works on the plan that’s active on the dashboard.', { dx: 0.9 });
                await t.hideCaption();
                await t.move(MARGIN_X, 420, { ms: 600 });
                await scrollTo(t, page, GOALS_Y, { ms: 1400 });
            },
        },

        // --- 3. The four goals ------------------------------------------------
        {
            id: 'goals',
            async before(t, page) {
                await openOptimizer(page);
                await jump(page, GOALS_Y);
            },
            async run(t, page) {
                const card = (title) => page.getByRole('button', { name: new RegExp(`^${title}`) });
                await explain(t, card('Leave the largest estate'),
                    'Four goals. Leave the largest estate cuts the tax owed at death.', { dx: 0.3, dy: 0.25 });
                await press(t, page, card('Spend the most in retirement'));
                await explain(t, null, 'Spend the most finds the highest yearly spending that lasts.');
                await explain(t, page.getByText(/How safe should that spending be/),
                    'It asks how sure: the share of market simulations that must last.', { dx: 0.2 });
                await glide(t, page.getByRole('button', { name: /Balanced \(85%\)/ }), { ms: 700 });
                await t.pause(1400);
                await explain(t, card('Retire as early as possible'),
                    'Retire as early as possible finds the earliest age that stays funded.', { dx: 0.3, dy: 0.25 });
                await explain(t, card('See how much you need'),
                    'See how much you need finds the savings your plan needs.', { dx: 0.3, dy: 0.25 });
                await explain(t, null, 'Those two also have their own pages, with their own videos.');
                await t.hideCaption();
                await press(t, page, card('Leave the largest estate'));
                await t.pause(300);
                await explain(t, page.getByText(/^Changes your RRSP meltdown, CPP\/OAS start ages and withdrawal order\. Your spending/),
                    'This goal changes melt, CPP/OAS ages and order. Spending stays put.', { dx: 0.35 });
                await explain(t, page.getByText('Optimize CPP/OAS timing (recommended)'),
                    'With this on, it tries CPP at 60, 65 or 70 and OAS at 65 or 70.', { dx: 0.4 });
                await t.hideCaption();
                await t.move(MARGIN_X, 560, { ms: 600 });
            },
        },

        // --- 4. Run it, and read the recommendation --------------------------
        {
            id: 'results',
            async before(t, page) {
                await openOptimizer(page);
                await jump(page, GOALS_Y);
            },
            async run(t, page) {
                const find = page.getByRole('button', { name: 'Find my largest estate' });
                await explain(t, find, 'Run it. The search takes seconds, entirely in your browser.');
                await t.hideCaption();
                await t.click(find, { highlight: false });
                await page.getByRole('button', { name: 'Apply to current plan' }).waitFor({ timeout: 120000 });
                await t.move(MARGIN_X + 60, 200, { ms: 700 });
                await t.pause(1200);

                const sugg = (label) => row(page, label).locator('td').last();
                await expectResult(page);
                await explain(t, sugg('RRSP melt amount'),
                    'Suggested: melt $56,750 a year from the RRSP...', { dx: 1.01 });
                await explain(t, sugg('RRSP melt start age'),
                    '...from retirement at 62 until 71, or until the RRSP is empty.', { dx: 1.01 });
                await explain(t, sugg('CPP start age'),
                    'Start CPP and OAS at 70 instead of 65, for larger payments for life.', { dx: 1.01 });
                await glide(t, sugg('OAS start age'), { dx: 1.01, ms: 500 });
                await t.pause(900);
                await explain(t, sugg('Withdrawal order'),
                    'Withdrawal order stays RRSP last.', { dx: 1.01 });
                await explain(t, sugg('CPP start age'),
                    'Why: from 62 to 70, before CPP and OAS start, Alex has little other income.', { dx: 1.01, ms: 700 });
                await explain(t, sugg('RRSP melt amount'),
                    'The melt is taxed in those years, at lower rates than later.', { dx: 1.01, ms: 700 });
                await t.hideCaption();

                await t.move(MARGIN_X + 60, 400, { ms: 500 });
                await scrollTo(t, page, ACTIONS_Y, { ms: 1000 });
                const tile = (label) => page.getByText(label, { exact: true }).first();
                await explain(t, tile('Net estate'),
                    'Net estate: $400,002 more left for heirs, after tax at death.', { dx: 0.85, dy: 1.6 });
                await explain(t, tile('Lifetime tax paid'),
                    'Lifetime tax paid, including at death: $293,175 less over the plan.', { dx: 0.85, dy: 1.6 });
                // Monte Carlo is random: the rates move a point or two between runs.
                const mc = (await tile('Monte Carlo success').locator('xpath=following-sibling::p[1]').innerText()).match(/(\d+)% → (\d+)%/);
                if (!mc) throw new Error('Monte Carlo tile not found');
                await explain(t, tile('Monte Carlo success'),
                    `Monte Carlo success: ${mc[2]}% of market simulations, against ${mc[1]}% now.`, { dx: 0.85, dy: 1.6 });
                await t.hideCaption();
                await t.move(MARGIN_X + 60, 520, { ms: 600 });
            },
        },

        // --- 5. The comparison: where the difference comes from --------------
        {
            id: 'compare',
            async before(t, page) {
                await runEstate(page);
                await jump(page, ACTIONS_Y);
            },
            async run(t, page) {
                const y0 = await scrollY(page);
                const abs = async (loc) => (await loc.boundingBox()).y + (await scrollY(page));

                const chartHead = page.locator('h2, h3, h4').filter({ hasText: /^Net Worth Comparison/ }).first();
                await scrollTo(t, page, (await abs(chartHead)) - 120, { ms: 1800 });
                await explain(t, chartHead,
                    'Net Worth Comparison: the current plan against Maximize Estate.', { dx: 0.7 });
                await explain(t, page.locator('.recharts-legend-wrapper').getByText('Maximize Estate', { exact: true }),
                    'Maximize Estate trails for years, then ends with more.');
                await t.hideCaption();
                await t.move(MARGIN_X + 80, 400, { ms: 600 });

                // Down past the summary cards to the Plan Comparison table.
                const at71 = row(page, 'RRSP/RRIF balance at 71');
                await scrollTo(t, page, (await abs(at71)) - 240, { ms: 2400 });
                await explain(t, at71.locator('td').nth(2),
                    'In the comparison table: at 71 the RRSP holds $654k, not $1.4M.', { pos: 'top', dx: 1.03 });
                await explain(t, null, 'A smaller RRIF means smaller forced withdrawals from 72.', { pos: 'top' });
                const estTax = row(page, 'Estate tax');
                await explain(t, estTax.locator('td').nth(2),
                    'Tax at death falls from $432,757 to $180,524.', { pos: 'top', dx: 1.03 });
                await t.hideCaption();

                const life = row(page, 'Lifetime tax paid');
                await scrollTo(t, page, (await abs(life)) - 260, { ms: 1400 });
                await explain(t, life.locator('td').nth(2),
                    'Lifetime tax paid, tax at death included, falls by $293,175.', { pos: 'top', dx: 1.03 });
                const cpp = row(page, 'CPP');
                await explain(t, cpp.locator('td').nth(2),
                    'Starting at 70, lifetime CPP and OAS rise by $176k and $89k.', { pos: 'top', dx: 1.03 });
                await glide(t, row(page, 'OAS').locator('td').nth(2), { dx: 1.03, ms: 500 });
                await t.pause(1200);
                await t.hideCaption();
                await t.move(MARGIN_X + 80, 420, { ms: 600 });
                await scrollTo(t, page, y0, { ms: 2200 });
            },
        },

        // --- 6. Apply, and the dashboard updates -------------------------------
        {
            id: 'apply',
            async before(t, page) {
                await runEstate(page);
                await jump(page, ACTIONS_Y);
            },
            async run(t, page) {
                await explain(t, page.getByText(/^Applying changes the RRSP melt amount/),
                    'Apply writes the melt, CPP/OAS ages and order into this plan.', { pos: 'top', dx: 0.3 });
                await explain(t, page.getByRole('button', { name: 'Save as new plan' }),
                    'Save as new plan keeps both. Compare Plans then shows them side by side.', { pos: 'top' });
                await t.hideCaption();
                await t.click(page.getByRole('button', { name: 'Apply to current plan' }));
                await explain(t, null, 'Applied. Nothing else in the plan changes.', { pos: 'top', dwell: 2600 });
                await t.hideCaption();

                // Back to Dashboard swaps the whole view under a still cursor,
                // which would pop a chart tooltip: show the click, fire it with
                // page hover off, glide to the gutter, then restore hover.
                const back = page.getByRole('button', { name: 'Back to Dashboard' });
                await t.moveTo(back);
                await t.pause(380);
                await t.clickEffect(null, { highlight: false });
                await page.evaluate(() => { document.body.style.pointerEvents = 'none'; });
                await back.dispatchEvent('click');
                await page.getByRole('heading', { name: 'Projected Net Worth' }).waitFor();
                const cpp = field(page, 'CPP Start Age');
                await page.waitForTimeout(150);
                const cppTop = (await cpp.boundingBox()).y + (await scrollY(page));
                await jump(page, cppTop - 330);
                await page.evaluate(() => window.__tut.press(false));
                await t.move(PARK_X, 470, { ms: 500 });
                await page.evaluate(() => { document.body.style.pointerEvents = ''; });
                await t.pause(1200); // chart entry animations

                await explain(t, cpp, 'Back on the dashboard, CPP and OAS now start at 70.', { pos: 'right' });
                await glide(t, field(page, 'OAS Start Age'), { ms: 600 });
                await t.pause(1000);
                await t.hideCaption();
                await t.move(PARK_X, 470, { ms: 500 });
                const melt = field(page, 'RRSP Melt Amount');
                const meltTop = (await melt.boundingBox()).y + (await scrollY(page));
                await scrollTo(t, page, meltTop - 339, { ms: 1600 });
                await explain(t, melt, 'RRSP Melt Amount is now $56,750 a year, from 62.', { pos: 'right' });
                await explain(t, page.getByText('Net Estate', { exact: true }).first(),
                    'Net estate is now $2,710,091, after $180,524 of tax at death.', { pos: 'right', dx: 0.97, dy: 2.2 });
                await explain(t, null, 'Change your plan later? Run the optimizer again.', { pos: 'right' });
                await t.hideCaption();
                await t.move(PARK_X, 470, { ms: 700 });
            },
        },
    ],
});
