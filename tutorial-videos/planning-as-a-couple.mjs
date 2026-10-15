// Tutorial: Planning as a couple — Add Spouse, the partner's own inputs, how
// the household projection changes, and Pension Income Splitting with its
// effect on tax. Output: out/planning-as-a-couple.mp4
//
// Recorded as scenes (see README): re-record one with
//   node planning-as-a-couple.mjs --scene split
// To choose an example year after the engine changes, --survey builds the
// states headless, prints every quoted figure and each year's split rows, and
// exits without recording.
//
// Persona: the shared fixture's Maria (fixtures/dashboard-alex.json) plus a
// partner, Marcus: 48, retiring at 60 on $70,000 a year, RRSP $150,000, TFSA
// $100,000, the default non-registered account, and a $30,000 indexed workplace
// (DB) pension from 60. Household spending after retirement goes to $70,000.
//
// The plan changes as the video goes, but every scene starts from a fresh page
// load with seeded storage. So scenes after the first are seeded with the state
// the previous scene left behind, built once per run, headless, by typing the
// same values into the real app (see SCENE_STATE). Nothing is written to
// fixtures/.
//
// Every figure the captions quote is deterministic (no Monte Carlo); the
// headless build checks them all before anything is recorded, and each scene
// checks its own again, so a changed number stops the run.

import { chromium } from 'playwright';
import { recordScenes, BASE_URL, SIZE } from './lib/recorder.mjs';
import { MARIA, chartCard, chartPoint, field, guidedSetup, quickStartPlan, yearDrawer } from './lib/app.mjs';
import { ensureFixture, seedStorage } from './lib/fixture.mjs';

const NAME = 'planning-as-a-couple';

const storage = await ensureFixture('dashboard-alex', (page) => quickStartPlan(page, MARIA), {
    baseUrl: BASE_URL,
    size: SIZE,
    refresh: process.argv.includes('--refresh-fixture'),
});

/** Maria's partner. Strings, because they are typed into inputs. */
const MARCUS = {
    age: '48',
    retirementAge: '60', // the default; not typed
    income: '70000',
    rrsp: '150000',
    tfsa: '100000', // the default; not typed
    pension: '30000',
};
const POST_SPEND = '70000';

/** Figures the captions quote. The run stops if the app shows anything else. */
const EXPECT = {
    preSpend: '60,000',           // Maria's typed figure: Add Spouse leaves typed spending alone
    taxOn: '$1,587,754',          // Tax card, Retirement row, splitting on
    taxOff: '$1,625,936',         // ... splitting off
    taxSaved: '$38,182',          // the difference
    year: 2044,                   // Maria 63, Marcus 66
    yearTitle: 'Age 63 / Spouse 66',
    splitSaving: '−$5,695',       // Less: pension income splitting, 2044
    splitAmount: '$23,395',       // the direction row's amount, 2044
};
/** The year drawer's direction row. Maria is "you", Marcus "your spouse". */
const SPLIT_FROM_MARCUS = 'Pension income your spouse split to you';

// The sticky app header + summary bar cover the top ~220px once scrolled.
const TOP = 262;
const BOTTOM = 620; // Tutor.type scrolls a field below innerHeight - 90 into view itself
const PARK_X = 427;
const CARD_TOP = 232;

/** One of the left column's cards, by its heading ("You", "Spouse", ...). */
const section = (page, title) =>
    page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first();
const header = (page, title) => section(page, title).locator(':scope > button').first();
const toggle = (scope, label) =>
    scope.locator('label', { hasText: label }).first().locator('xpath=following::button[@role="switch"][1]');
const tips = (page, on) => page.evaluate((on) => document.documentElement.classList.toggle('tut-notips', !on), on);
const readMs = (text) => Math.max(2300, 700 + text.length * 46);

/** The summary bar's Tax card, Retirement row amount. */
const retirementTax = (page) =>
    page.locator('.summary-card').filter({ hasText: 'Estate' }).locator('tr', { hasText: 'Retirement' }).locator('td').first();
/** ... and that row's label, to point at without covering the amount. */
const retirementTaxLabel = (page) =>
    page.locator('.summary-card').filter({ hasText: 'Estate' }).locator('tr', { hasText: 'Retirement' }).locator('th').first();
const splitRow = (scope) => scope.locator('tr', { hasText: 'Less: pension income splitting' }).first();
const directionRow = (scope) => scope.locator('tr', { hasText: SPLIT_FROM_MARCUS }).first();

const SURVEY = process.argv.includes('--survey');

async function expectText(locator, want, what) {
    const got = (await locator.innerText()).trim();
    if (SURVEY) console.log(`${what}: app shows "${got}"`);
    else if (!got.includes(want)) throw new Error(`${what} changed: app shows "${got}", captions expect "${want}"`);
}

async function reveal(t, first, last = first, { ms = 900 } = {}) {
    const a = await first.boundingBox();
    const b = await last.boundingBox();
    const top = a.y, bottom = b.y + b.height;
    if (top >= TOP && bottom <= BOTTOM) return;
    await t.scroll(top - TOP, { ms });
}

async function glide(t, locator, { dx = 0.5, dy = 0.5, ms } = {}) {
    const b = await locator.boundingBox();
    await t.move(b.x + b.width * dx, b.y + b.height * dy, ms ? { ms } : undefined);
}

async function explain(t, locator, text, { dwell, pos = 'right', ...g } = {}) {
    await glide(t, locator, g);
    await t.caption(text, 0, { pos });
    await t.pause(dwell ?? readMs(text));
}

async function say(t, text, { pos = 'right', dwell } = {}) {
    await t.caption(text, 0, { pos });
    await t.pause(dwell ?? readMs(text));
}

async function press(t, page, locator) {
    await t.click(locator, { highlight: false });
    await page.evaluate(() => document.activeElement?.blur?.());
}

/** Page set-up shared by the recorder's ready() and the in-scene reload. */
async function prepare(page) {
    await page.getByRole('heading', { name: 'Projected Net Worth' }).waitFor();
    await page.waitForLoadState('networkidle');
    if (await guidedSetup(page).count()) throw new Error('Guided Setup opened: the saved-plan fixture did not load');
    await page.addStyleTag({ content: 'html.tut-notips [role="tooltip"] { display: none !important; } html { scroll-behavior: auto !important; }' });
    await tips(page, false);
}

/** Type a value at full speed (headless build), retrying a lost keystroke. */
async function set(page, input, value) {
    for (let attempt = 0; attempt < 3; attempt++) {
        await input.click();
        await page.waitForTimeout(120 * (attempt + 1));
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(value, { delay: 40 * (attempt + 1) });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(250);
        if ((await input.inputValue()).replace(/\D/g, '') === value) return;
    }
    throw new Error(`Could not set ${value} (field shows "${await input.inputValue()}")`);
}

const dumpStorage = (page) => page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
    }
    return out;
});

/**
 * Drive the real app headless through the same edits the video makes, and keep
 * the saved state after each step: STATES.added (Marcus filled in) and
 * STATES.spend (retirement spending raised). Also checks every quoted figure.
 */
async function buildStates() {
    console.log('building couple states ...');
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({ viewport: SIZE, locale: 'en-CA', timezoneId: 'America/Toronto' });
        await seedStorage(context, storage);
        const page = await context.newPage();
        await page.goto(new URL('/', BASE_URL).href, { waitUntil: 'domcontentloaded' });
        await prepare(page);
        await page.getByRole('button', { name: /Add Spouse/ }).click();
        const sp = section(page, 'Spouse');
        await sp.waitFor();
        await set(page, field(sp, 'Current Age'), MARCUS.age);
        await set(page, field(sp, 'Annual Income'), MARCUS.income);
        await set(page, field(sp, 'RRSP'), MARCUS.rrsp);
        await sp.getByRole('button', { name: /Workplace Pension \(DB\)/ }).click();
        await set(page, field(sp, 'Annual Amount'), MARCUS.pension);
        await page.waitForTimeout(600);
        const added = await dumpStorage(page);

        const hs = section(page, 'Household Spending');
        const pre = (await field(hs, 'Pre-Retirement').inputValue()).trim();
        if (!pre.includes(EXPECT.preSpend)) throw new Error(`Pre-Retirement after Add Spouse is "${pre}", captions expect ${EXPECT.preSpend}`);
        if (await hs.getByRole('status').count()) throw new Error('A spending note appeared after Add Spouse; captions say Maria’s figures stay as typed');
        await set(page, field(hs, 'Post-Retirement'), POST_SPEND);
        await page.waitForTimeout(600);
        const spend = await dumpStorage(page);

        await expectText(retirementTax(page), EXPECT.taxOn, 'Retirement tax (splitting on)');
        await page.getByRole('row', { name: `Open ${EXPECT.year} breakdown` }).click();
        const drawer = yearDrawer(page);
        await drawer.waitFor();
        await expectText(drawer.locator('h2').first(), EXPECT.yearTitle, 'Year drawer title');
        await expectText(splitRow(drawer), EXPECT.splitSaving, `${EXPECT.year} splitting saving`);
        await expectText(directionRow(drawer), EXPECT.splitAmount, `${EXPECT.year} split from Marcus`);
        await drawer.getByRole('button', { name: 'Close' }).click();
        await drawer.waitFor({ state: 'detached' });
        await header(page, 'Settings').click();
        await toggle(section(page, 'Settings'), 'Pension Income Splitting').click();
        await page.waitForTimeout(600);
        await expectText(retirementTax(page), EXPECT.taxOff, 'Retirement tax (splitting off)');
        const n = (s) => Number(s.replace(/\D/g, ''));
        if (!SURVEY && n(EXPECT.taxOff) - n(EXPECT.taxOn) !== n(EXPECT.taxSaved)) throw new Error('EXPECT.taxSaved does not match taxOff - taxOn');
        console.log('couple states built; quoted figures match');
        if (SURVEY) {
            // Print every year's splitting rows (splitting back on) to choose an example year.
            await toggle(section(page, 'Settings'), 'Pension Income Splitting').click();
            await page.waitForTimeout(600);
            for (let y = 2038; y <= 2065; y++) {
                const row = page.getByRole('row', { name: `Open ${y} breakdown` });
                if (!(await row.count())) continue;
                await row.click();
                const d = yearDrawer(page);
                await d.waitFor();
                const title = (await d.locator('h2').first().innerText()).trim();
                const lines = await d.locator('tr').filter({ hasText: /split|Household income tax/i }).allInnerTexts();
                console.log(`${y} | ${title} | ${lines.map((s) => s.replace(/\s+/g, ' ').trim()).join(' || ')}`);
                await d.getByRole('button', { name: 'Close' }).click();
                await d.waitFor({ state: 'detached' });
            }
            process.exit(0);
        }
        return { added, spend };
    } finally {
        await browser.close();
    }
}

const STATES = await buildStates();

// Which saved state each scene opens on. recordScenes seeds one `storage` for
// every scene, but reads `o.storage` afresh as each scene's context is created,
// right after it logs "--- scene <id>". So: note the id from that log line and
// serve the matching state through a getter. (Reloading inside a scene's
// `before` instead leaves a long white gap that, under load, defeats the
// recorder's black-cover trim.)
const SCENE_STATE = { household: STATES.added, split: STATES.spend, year: STATES.spend };
let sceneId = null;
const log = console.log;
console.log = (...args) => {
    const m = typeof args[0] === 'string' && args[0].match(/^--- scene (\S+)/);
    if (m) sceneId = m[1];
    log(...args);
};


/** Smoothly scroll the year drawer's body so a section heading sits near its top. */
async function drawerScrollTo(t, drawer, el, y) {
    const body = drawer.locator('.overflow-y-auto').first();
    const dy = await el.evaluate((h, y) => h.getBoundingClientRect().top - y, y);
    await t.scroll(dy, { ms: 1400, target: body });
}

/** Close the year drawer and leave nothing behind (as dashboard-tour.mjs). */
async function closeDrawer(t, page, drawer) {
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
    await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body, null, { timeout: 1000 }).catch(() => {});
    await page.evaluate(() => document.activeElement?.blur?.());
}

await recordScenes({
    name: NAME,
    url: '/',
    get storage() { return SCENE_STATE[sceneId] ?? storage; },
    start: { x: PARK_X, y: 420 },
    title: { title: 'Planning as a couple', subtitle: 'Add a partner, and split pension income to cut tax' },
    end: {
        title: 'Canadian Retirement Asset Planning Tool',
        subtitle: '100% free, private and secure',
        url: 'craptool.ca',
    },

    async ready(t, page) {
        await prepare(page);
        await t.pause(1600); // chart entry animations
    },

    scenes: [
        // --- 1. Add Spouse and fill in Marcus -------------------------------
        {
            id: 'add',
            async run(t, page) {
                const add = page.getByRole('button', { name: /Add Spouse/ });
                await reveal(t, add, add, { ms: 1800 });
                await t.pause(300);
                await explain(t, add, 'Planning with a partner? Add Spouse adds them to the plan.', { dy: 0.35 });
                await t.hideCaption();
                await press(t, page, add);
                const sp = section(page, 'Spouse');
                await sp.waitFor();
                await t.pause(300);
                await t.caption('Maria’s partner, Marcus, is 48 and retires at 60.', 0, { pos: 'right' });
                await reveal(t, sp.getByRole('heading', { name: 'Spouse', exact: true }), field(sp, 'Annual Income'), { ms: 1200 });
                await t.type(field(sp, 'Current Age'), MARCUS.age);
                await glide(t, field(sp, 'Retirement Age'), { ms: 600 }); // already 60
                await t.pause(1400);
                await t.caption('Marcus earns $70,000 a year until retiring.', 0, { pos: 'right' });
                await t.type(field(sp, 'Annual Income'), MARCUS.income);
                await t.pause(700);

                const penBtn = sp.getByRole('button', { name: /Workplace Pension \(DB\)/ });
                await reveal(t, field(sp, 'RRSP'), penBtn, { ms: 1000 });
                await t.caption('Marcus’s own RRSP, TFSA and non-registered accounts count too.', 0, { pos: 'right' });
                await t.type(field(sp, 'RRSP'), MARCUS.rrsp);
                await glide(t, field(sp, 'TFSA'), { ms: 500 });
                await glide(t, field(sp, 'Balance'), { ms: 500 });
                await t.pause(600);
                await t.hideCaption();

                await press(t, page, penBtn);
                await t.pause(400);
                await reveal(t, penBtn, field(sp, 'Bridge Benefit'), { ms: 800 });
                const pen = 'Plus a DB pension: $30,000 a year from 60, indexed.';
                await t.caption(pen, 0, { pos: 'right' });
                await t.type(field(sp, 'Annual Amount'), MARCUS.pension);
                await glide(t, field(sp, 'Start Age'), { ms: 600 });
                await t.pause(readMs(pen) - 1000);
                await t.hideCaption();
                // Collapse again: the next scene's reload shows it collapsed.
                await press(t, page, penBtn);
                await t.pause(300);
                await t.move(PARK_X, t.y, { ms: 500 });
            },
        },

        // --- 2. Household spending and the household net worth --------------
        {
            id: 'household',
            async run(t, page) {
                const hs = section(page, 'Household Spending');
                const pre = field(hs, 'Pre-Retirement');
                if (!(await pre.inputValue()).includes(EXPECT.preSpend)) throw new Error(`Pre-Retirement is "${await pre.inputValue()}", captions expect ${EXPECT.preSpend}`);
                await reveal(t, field(hs, 'Pre-Retirement'), field(hs, 'Post-Retirement'), { ms: 1200 });
                // Add Spouse keeps typed spending (it only swaps untouched defaults).
                await explain(t, pre, 'Household spending: Maria’s $60,000 stays while either works...');
                await t.caption('...and $70,000 a year once both have retired.', 0, { pos: 'right' });
                await t.type(field(hs, 'Post-Retirement'), POST_SPEND);
                await t.pause(1300);
                await t.hideCaption();

                const card = chartCard(page, 'Projected Net Worth');
                await t.move(1150, 300, { ms: 600 });
                await t.scrollToTop(card, CARD_TOP, { ms: 1400 });
                const legend = card.locator('.recharts-legend-wrapper');
                await t.caption('Net worth now stacks Marcus’s accounts with Maria’s.', 0, { pos: 'top' });
                await glide(t, legend.getByText('Spouse RRSP/RRIF', { exact: true }));
                await t.pause(1000);
                await glide(t, legend.getByText('Spouse TFSA', { exact: true }), { ms: 600 });
                await glide(t, legend.getByText('Spouse Non-Reg', { exact: true }), { ms: 600 });
                await t.pause(1100);
                await t.hideCaption();
                const cb = await card.boundingBox();
                await t.move(1150, cb.y + cb.height - 12, { ms: 600 });
            },
        },

        // --- 3. Pension Income Splitting: what, who, and the lifetime effect --
        {
            id: 'split',
            async run(t, page) {
                await expectText(retirementTax(page), EXPECT.taxOn, 'Retirement tax (splitting on)');
                const st = section(page, 'Settings');
                const hdr = header(page, 'Settings');
                await t.move(PARK_X, 400, { ms: 600 });
                await reveal(t, hdr, hdr, { ms: 1600 });
                await press(t, page, hdr);
                await t.pause(400);
                const sw = toggle(st, 'Pension Income Splitting');
                await reveal(t, hdr, toggle(st, 'Fund spending from RRSP first'), { ms: 1000 });
                const lbl = st.locator('label', { hasText: 'Pension Income Splitting' });
                await explain(t, lbl, 'Settings now has Pension Income Splitting, on by default.', { dx: 0.4 });
                await say(t, 'Up to half of eligible pension income can move to the partner.');
                await say(t, 'Eligible: a DB pension at any age, RRIF withdrawals from 72.');
                await say(t, 'CPP, OAS and RRSP withdrawals aren’t split.');
                await t.hideCaption();

                // Off, then on again, with the cursor on the summary bar's tax.
                await press(t, page, sw);
                await t.pause(300);
                await expectText(retirementTax(page), EXPECT.taxOff, 'Retirement tax (splitting off)');
                await t.moveTo(retirementTaxLabel(page));
                const off = `Off, tax in retirement rises to ${EXPECT.taxOff}: ${EXPECT.taxSaved} more.`;
                await say(t, off, { dwell: readMs(off) + 400 });
                await t.hideCaption();
                await press(t, page, sw);
                await t.pause(300);
                await expectText(retirementTax(page), EXPECT.taxOn, 'Retirement tax (splitting on)');
                await t.pause(700);
                await reveal(t, hdr, hdr, { ms: 700 });
                await press(t, page, hdr);
                await t.pause(300);
                await t.move(PARK_X, t.y, { ms: 500 });
            },
        },

        // --- 4. One year in detail: the saving, the shares, the direction ------
        {
            id: 'year',
            async run(t, page) {
                const card = chartCard(page, 'Annual Cash Flow (Net)');
                // Park above the charts, scroll, then cross along the card's
                // header and drop straight onto the bar, so no other year's
                // tooltip pops up on the way.
                await t.move(1150, 245, { ms: 600 });
                await t.scrollToTop(card, CARD_TOP, { ms: 1500 });
                await t.caption('Each year’s breakdown shows what splitting saves.', 0, { pos: 'top' });
                const p = await chartPoint(card, 63, 0.5);
                await t.move(p.x, 245, { ms: 900 });
                await t.move(p.x, p.y, { ms: 700 });
                await t.pause(1200);
                await t.hideCaption();
                await t.clickAt(p.x, p.y);

                const drawer = yearDrawer(page);
                await drawer.waitFor();
                await expectText(drawer.locator('h2').first(), EXPECT.yearTitle, 'Year drawer title');
                await expectText(splitRow(drawer), EXPECT.splitSaving, `${EXPECT.year} splitting saving`);
                await expectText(directionRow(drawer), EXPECT.splitAmount, `${EXPECT.year} split from Marcus`);
                await t.pause(300);
                const saves = `In ${EXPECT.year}, splitting Marcus’s pension saves ${EXPECT.splitSaving.replace('−', '')} of tax.`;
                await t.caption(saves, 0, { pos: 'left' });
                // The split row near the top, so the tax shares and the
                // direction row below it are in view too.
                await drawerScrollTo(t, drawer, splitRow(drawer), 250);
                await glide(t, splitRow(drawer), { dx: 0.3 });
                await t.pause(readMs(saves));
                await explain(t, drawer.locator('tr', { hasText: 'Household income tax' }).first(),
                    'Tax is shown for Maria and Marcus, after the split.', { pos: 'left', dx: 0.75 });
                await explain(t, directionRow(drawer),
                    `Marcus split ${EXPECT.splitAmount} of pension income to Maria.`, { pos: 'left', dx: 0.3 });
                await t.hideCaption();
                await closeDrawer(t, page, drawer);
            },
        },
    ],
});
