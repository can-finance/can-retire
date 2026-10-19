// Tutorial: Compare plans — duplicate Maria's plan, rename the copy, change one
// thing (retire at 60 instead of 62), switch between the two, then compare them
// side by side and read the differences. Output: out/compare-plans.mp4
//
// Recorded as scenes (see README): re-record one with
//   node compare-plans.mjs --scene table
//
// Starts on the dashboard with the shared saved plan (fixtures/dashboard-alex.json:
// Maria, 45, retiring at 62). Every scene starts from a fresh page load of that
// single plan, so later scenes rebuild the second plan in `before`, off camera,
// with the same clicks the earlier scenes film (see buildVariant).
//
// Compare Plans runs a 200-path Monte Carlo per plan from Math.random, so the
// success rates would change on every run (and between scenes). `ready` seeds
// Math.random (as rrsp-optimizer.mjs does); the dashboard's own Monte Carlo is
// off by default and nothing else draws from it, so the compare view's rates are
// the same every take. expectCompare stops the run if any quoted number changes.
//
// Don't toggle Show Today's Dollars: the captions quote nominal figures.

import { recordScenes, BASE_URL, SIZE } from './lib/recorder.mjs';
import { MARIA, field, guidedSetup, quickStartPlan } from './lib/app.mjs';
import { ensureFixture } from './lib/fixture.mjs';

const storage = await ensureFixture('dashboard-alex', (page) => quickStartPlan(page, MARIA), {
    baseUrl: BASE_URL,
    size: SIZE,
    refresh: process.argv.includes('--refresh-fixture'),
});

const NEW_NAME = 'Retire at 60';
const NEW_AGE = '60';

// Dashboard: gutter between the inputs column and the charts.
const PARK_X = 427;
// Compare view: right margin beside the header controls, clear of the chart.
const MARGIN_X = 1262;

// Compare view scroll positions shared by a scene's end and the next scene's `before`.
const CARDS_Y = 330;   // chart's lower half and the three summary cards

/** How long a caption stays up: long enough to read twice at a calm pace. */
const readMs = (text) => Math.max(2300, 700 + text.length * 46);

const scrollY = (page) => page.evaluate(() => window.scrollY);
const jump = (page, y) => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y);

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

/**
 * Show a click on a button that swaps the whole view (dashboard <-> compare)
 * under a still cursor, which would pop a chart tooltip: fire it with page
 * hover off, glide to `park`, then restore hover (as rrsp-optimizer.mjs does).
 */
async function swapClick(t, page, locator, waitFor, park) {
    await t.moveTo(locator);
    await t.pause(380);
    await t.clickEffect(null, { highlight: false });
    await page.evaluate(() => { document.body.style.pointerEvents = 'none'; });
    await locator.dispatchEvent('click');
    await waitFor();
    await page.evaluate(() => window.__tut.press(false));
    await page.waitForTimeout(150);
    await t.move(park.x, park.y, { ms: 500 });
    await page.evaluate(() => { document.body.style.pointerEvents = ''; });
}

// --- Locators ----------------------------------------------------------------

const planName = (page) => page.getByRole('button', { name: 'Rename plan' });
const planRow = (page, name) =>
    page.locator('div.cursor-pointer').filter({ has: page.locator('p', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) }).first();
const netEstateCard = (page) => page.locator('.summary-card').filter({ hasText: 'Net Estate' }).first();
const compareBtn = (page) => page.getByRole('button', { name: 'Compare Plans' });

/** A compare-table row by its first cell's exact text. */
const row = (page, label) =>
    page.locator('tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*$`) }) }).first();
/** A compare summary card (Monte Carlo success, Net estate, Money runs out). */
const statCard = (page, label) =>
    page.locator('div.rounded-2xl').filter({ has: page.locator('p', { hasText: new RegExp(`^${label}`) }) }).last();

// --- Checks: fail rather than film captions that no longer match ------------

async function expectNetEstate(page, want) {
    const got = (await netEstateCard(page).innerText()).replace(/\s+/g, ' ');
    if (!got.includes(want)) throw new Error(`Dashboard net estate changed: "${got}" (captions expect ${want})`);
}

async function expectCompare(page) {
    const cells = async (label) => (await row(page, label).locator('td').allInnerTexts()).slice(1).map((s) => s.trim()).join(' / ');
    const got = {
        success: await cells('Success rate'),
        estate: await cells('Net estate (after terminal tax)'),
        spending: await cells('Total spending (funded)'),
        tax: await cells('Lifetime tax paid (all three)'),
        working: await cells('Tax while working'),
        runsOut: await cells('Money runs out (average returns, not Monte Carlo)'),
        age: await cells('Retirement age'),
    };
    const want = {
        success: '93% / 88% / -5 pts',
        estate: '$2,299,344 / $1,655,169 / -$644,175',
        spending: '$3,799,456 / $3,740,800 / -$58,656',
        tax: '$1,189,426 / $1,120,260 / -$69,166',
        working: '$368,517 / $317,158 / -$51,359',
        runsOut: 'Never / Never / —',
        age: '62 / 60 / —',
    };
    const bad = Object.keys(want).filter((k) => got[k] !== want[k]);
    if (bad.length) throw new Error(`Compare view changed: ${bad.map((k) => `${k} "${got[k]}" (captions expect "${want[k]}")`).join('; ')}`);
}

// --- Off-camera setup for later scenes -----------------------------------------

/** Type into a FinancialInput the way Tutor.type does, at full speed. */
async function setField(page, input, value) {
    await input.click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(value, { delay: 40 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
}

/** Duplicate, rename, change the age (as the first two scenes film), optionally switch back. */
async function buildVariant(page, { switchBack = false } = {}) {
    await page.getByRole('button', { name: 'Duplicate Plan' }).dispatchEvent('click');
    await planName(page).filter({ hasText: 'My Plan (copy)' }).waitFor();
    await planName(page).dispatchEvent('click');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(NEW_NAME);
    await page.keyboard.press('Enter');
    await planName(page).filter({ hasText: NEW_NAME }).waitFor();
    const age = field(page, 'Retirement Age');
    await setField(page, age, NEW_AGE);
    if ((await age.inputValue()) !== NEW_AGE) throw new Error(`Could not set Retirement Age (shows "${await age.inputValue()}")`);
    if (switchBack) {
        await planRow(page, 'My Plan').dispatchEvent('click');
        await planName(page).filter({ hasText: 'My Plan' }).waitFor();
    }
    await page.evaluate(() => document.activeElement?.blur?.());
    await jump(page, 0);
    await page.waitForTimeout(900); // chart re-animation
}

async function openCompare(page) {
    await compareBtn(page).dispatchEvent('click');
    await page.getByRole('heading', { name: 'Compare Plans' }).waitFor();
    await waitMonteCarlo(page);
}

async function waitMonteCarlo(page) {
    // Placeholders ("…") fill in as each plan's Monte Carlo completes.
    await page.waitForFunction(() => !document.body.innerText.includes('…'), null, { timeout: 60000 });
    await page.waitForTimeout(1500); // chart entry animation
}

await recordScenes({
    name: 'compare-plans',
    url: '/',
    storage,
    start: { x: PARK_X, y: 420 },
    title: { title: 'Compare plans', subtitle: 'Duplicate a plan, change one thing, see the difference' },
    end: {
        title: 'Canadian Retirement Asset Planning Tool',
        subtitle: '100% free, private and secure',
        url: 'craptool.ca',
    },

    async ready(t, page) {
        await page.getByRole('heading', { name: 'Projected Net Worth' }).waitFor();
        await page.waitForLoadState('networkidle');
        if (await guidedSetup(page).count()) throw new Error('Guided Setup opened: the saved-plan fixture did not load');
        // No help tooltips while gliding, and no smooth scrolling under Tutor.scroll.
        await page.addStyleTag({ content: '[role="tooltip"] { display: none !important; } html { scroll-behavior: auto !important; }' });
        // Seeded Math.random (mulberry32) for the compare view's Monte Carlo.
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
        // --- 1. Duplicate and rename ------------------------------------------
        {
            id: 'duplicate',
            async run(t, page) {
                await expectNetEstate(page, '$2,299,344');
                await explain(t, planName(page),
                    'Maria’s plan retires at 62. What would retiring at 60 change?', { pos: 'right', dx: 0.6 });
                const dup = page.getByRole('button', { name: 'Duplicate Plan' });
                await explain(t, dup, 'Duplicate Plan copies the whole plan, and switches to the copy.', { pos: 'right' });
                await t.hideCaption();
                await press(t, page, dup);
                await planName(page).filter({ hasText: 'My Plan (copy)' }).waitFor();
                await t.pause(400);
                await explain(t, planName(page),
                    'The copy is called My Plan (copy). Click the name to rename it.', { pos: 'right', dx: 0.35 });
                await t.hideCaption();
                await t.click(planName(page), { highlight: false });
                await t.type(page.locator('input:focus'), NEW_NAME);
                await page.evaluate(() => document.activeElement?.blur?.());
                await t.pause(300);
                await explain(t, planRow(page, NEW_NAME).getByText('Active', { exact: true }),
                    'Both plans are in the list. Active marks the one being edited.', { pos: 'right' });
                await t.hideCaption();
                await t.move(PARK_X, 470, { ms: 600 });
            },
        },

        // --- 2. Change one thing ------------------------------------------------
        {
            id: 'change',
            async before(t, page) {
                // Scene 1's end state: the copy, renamed, still retiring at 62.
                await page.getByRole('button', { name: 'Duplicate Plan' }).dispatchEvent('click');
                await planName(page).filter({ hasText: 'My Plan (copy)' }).waitFor();
                await planName(page).dispatchEvent('click');
                await page.keyboard.press('Control+A');
                await page.keyboard.type(NEW_NAME);
                await page.keyboard.press('Enter');
                await planName(page).filter({ hasText: NEW_NAME }).waitFor();
                await page.evaluate(() => document.activeElement?.blur?.());
                await jump(page, 0);
                await page.waitForTimeout(900);
            },
            async run(t, page) {
                const age = field(page, 'Retirement Age');
                const top = (await age.boundingBox()).y + (await scrollY(page));
                await scrollTo(t, page, top - 339, { ms: 1600 });
                await explain(t, age, 'Now change one thing: retirement age, from 62 to 60.', { pos: 'right' });
                await t.hideCaption();
                await t.type(age, NEW_AGE);
                await page.evaluate(() => document.activeElement?.blur?.());
                await t.move(PARK_X, 470, { ms: 500 });
                await t.pause(1200); // chart re-animation
                await expectNetEstate(page, '$1,655,169');
                await explain(t, page.getByText('Net Estate', { exact: true }).first(),
                    'The dashboard updates: net estate falls to $1,655,169.', { pos: 'right', dx: 0.97, dy: 2.2 });
                await t.hideCaption();
                await t.move(PARK_X, 470, { ms: 500 });
                await scrollTo(t, page, 0, { ms: 1600 });
            },
        },

        // --- 3. Switch plans, then open Compare --------------------------------
        {
            id: 'switch',
            async before(t, page) {
                await buildVariant(page);
            },
            async run(t, page) {
                const mine = planRow(page, 'My Plan');
                await explain(t, mine, 'To switch plans, click one in the list.', { pos: 'right', dx: 0.3 });
                await t.hideCaption();
                await press(t, page, mine);
                await planName(page).filter({ hasText: 'My Plan' }).waitFor();
                await t.pause(1000);
                await expectNetEstate(page, '$2,299,344');
                await explain(t, page.getByText('Net Estate', { exact: true }).first(),
                    'Back on My Plan: retiring at 62, net estate $2,299,344.', { pos: 'right', dx: 0.97, dy: 2.2 });
                await explain(t, compareBtn(page), 'Compare Plans puts them side by side.', { pos: 'right', dx: 0.7 });
                await t.hideCaption();
                await swapClick(t, page, compareBtn(page),
                    () => page.getByRole('heading', { name: 'Compare Plans' }).waitFor(), { x: MARGIN_X, y: 160 });
                await waitMonteCarlo(page);
                // The lines redraw as each Monte Carlo lands: let them finish so the
                // join into the next scene (fully drawn) doesn't jump.
                await t.pause(2500);
            },
        },

        // --- 4. The compare view: chips, chart, headline cards -----------------
        {
            id: 'compare',
            async before(t, page) {
                await buildVariant(page, { switchBack: true });
                await openCompare(page);
                await jump(page, 0);
            },
            async run(t, page) {
                await expectCompare(page);
                await explain(t, page.getByRole('button', { name: /^Retire at 60/ }),
                    'Each plan gets a colour. Pick up to three; these two are picked for you.', { dx: 0.4 });
                await t.hideCaption();
                await t.move(MARGIN_X, 420, { ms: 600 });
                await scrollTo(t, page, CARDS_Y, { ms: 1600 });

                const mc = statCard(page, 'Monte Carlo success');
                await explain(t, mc.locator('span.tabular-nums').last(),
                    'Monte Carlo success: 93% at 62, 88% at 60.', { dx: 1.2 });
                await explain(t, null,
                    'Each rate comes from 200 random market runs: a few points is noise.');
                await explain(t, statCard(page, 'Net estate').locator('span.tabular-nums').last(),
                    'Net estate: $644,175 less for retiring two years sooner.', { dx: 1.1 });
                await explain(t, statCard(page, 'Money runs out').locator('span.tabular-nums').last(),
                    'On average returns, neither plan runs out of money.', { dx: 1.2 });
                await t.hideCaption();
                await t.move(MARGIN_X, 520, { ms: 600 });
            },
        },

        // --- 5. The table: what differs, and by how much ------------------------
        {
            id: 'table',
            async before(t, page) {
                await buildVariant(page, { switchBack: true });
                await openCompare(page);
                await jump(page, CARDS_Y);
            },
            async run(t, page) {
                const abs = async (loc) => (await loc.boundingBox()).y + (await scrollY(page));
                const head = page.getByRole('heading', { name: /^Plan Comparison/ });
                // Table header well below the top caption, so the column heads show.
                await scrollTo(t, page, (await abs(head)) - 200, { ms: 1800 });
                await explain(t, page.locator('th').filter({ hasText: 'vs. My Plan' }),
                    'The last column is Retire at 60 minus My Plan.', { pos: 'top', dx: 0.6 });
                await explain(t, row(page, 'Total spending (funded)').locator('td').nth(3),
                    'Lifetime spending is $58,656 lower: two more years on the retirement budget.', { pos: 'top', dx: 1.02 });
                await t.hideCaption();

                const tax = row(page, 'Lifetime tax paid (all three)');
                await t.move(MARGIN_X, 420, { ms: 500 });
                await scrollTo(t, page, (await abs(tax)) - 380, { ms: 2000 });
                await explain(t, tax.locator('td').nth(3),
                    'Lifetime tax is $69,166 lower, mostly from two fewer years of salary.', { pos: 'top', dx: 1.02 });
                await t.hideCaption();
                await t.move(MARGIN_X, 420, { ms: 600 });
                await explain(t, null, 'Your plans stay in your browser on this device. Nothing is uploaded.', { pos: 'top' });
                await t.hideCaption();
            },
        },
    ],
});
