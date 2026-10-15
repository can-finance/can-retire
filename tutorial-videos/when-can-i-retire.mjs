// Tutorial: When can I retire? — enter savings and a retirement spending
// target, run the search, and read the answer and the "Retiring earlier or
// later" table, including the "Could spend" column. The "1-min tour" opened
// from the When can I retire? page.
// Output: out/when-can-i-retire.mp4
//
// Single take, like cpp-calculator.mjs: everything depends on the numbers
// typed at the start, so re-recording the whole thing is simpler than scenes.
//
// Persona (fictional): Priya, 50, Ontario, earns $90,000, with $450,000 in an
// RRSP, $120,000 in a TFSA and $80,000 non-registered. Spends $60,000 a year
// now (the page's default), wants $50,000 a year in retirement, and hopes to
// retire at 62. Starts from the page's defaults in a fresh browser.
//
// The search's Monte Carlo pass draws from Math.random, so it is seeded
// (mulberry32, as in rrsp-optimizer.mjs) right before the run: the success
// rates and could-spend figures the captions quote then come out the same on
// every take, and expectResult stops the run if they change.

import { record } from './lib/recorder.mjs';
import { field } from './lib/app.mjs';

const PRIYA = {
    age: '50', income: '90000', target: '62',
    rrsp: '450000', tfsa: '120000', nonReg: '80000',
    spendAfter: '50000',
};

/** How long a caption stays up: long enough to read twice at a calm pace. */
const readMs = (text) => Math.max(2300, 700 + text.length * 46);

const scrollY = (page) => page.evaluate(() => window.scrollY);

/** Smooth-scroll the window to an absolute position. */
async function scrollTo(t, page, y, { ms = 1200 } = {}) {
    const dy = y - (await scrollY(page));
    if (Math.abs(dy) > 1) await t.scroll(dy, { ms });
}

/** Absolute page y of an element's top. */
const absTop = async (page, locator) => (await locator.boundingBox()).y + (await scrollY(page));

/** Glide onto an element (no scroll-into-view: the sticky header would hide it). */
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

/** Seeded Math.random in the page, so the Monte Carlo search repeats exactly. */
const seedRandom = (page) => page.evaluate(() => {
    let a = 20261014;
    Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let x = Math.imul(a ^ (a >>> 15), 1 | a);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
});

/** A row of the Retiring earlier or later table, by its retirement age. */
const row = (page, age) => page.locator('tbody tr').filter({ has: page.locator('td').first().filter({ hasText: new RegExp(`^${age}`) }) });
/** A cell of that row: 0 age, 1 success, 2 left at the end, 3 tax, 4 could spend. */
const cell = (page, age, i) => row(page, age).locator('td').nth(i);

/**
 * The captions quote Priya's numbers. If the app's answer changes, fail
 * rather than film captions that no longer match the screen.
 */
async function expectResult(page) {
    const text = await page.locator('main').innerText();
    const want = [
        'You can retire at 64 — 2 years later than your target',
        'Your money lasts in 86% of market simulations at $50,000/yr (your target: 85%)',
        'take $56,500/yr from your RRSP from 64 to 71',
        'start your CPP at 70 instead of 65; start your OAS at 70 instead of 65',
        'and take money from your RRSP before your other savings',
        'your money lasts until you’re about 84',
    ];
    const missing = want.filter((s) => !text.includes(s));
    const rows = {
        62: ['your target', '76%', '$45,000/yr'],
        63: ['84%', '$47,500/yr'],
        64: ['Earliest', '86%', '$50,000/yr'],
        68: ['98%', '$60,000/yr'],
    };
    for (const [age, parts] of Object.entries(rows)) {
        const r = (await row(page, age).innerText()).replace(/\s+/g, ' ');
        for (const p of parts) if (!r.toLowerCase().includes(p.toLowerCase())) missing.push(`row ${age}: ${p}`);
    }
    if (missing.length) throw new Error(`When can I retire result changed; the captions expect: ${missing.join(' | ')}`);
}

// Off to the right of the form, clear of the fields.
const PARK_X = 1130;

await record({
    name: 'when-can-i-retire',
    url: '/when-can-i-retire/',
    title: { title: 'When can I retire?', subtitle: 'The earliest age your savings can support' },
    end: {
        title: 'Canadian Retirement Asset Planning Tool',
        subtitle: '100% free, private and secure',
        url: 'craptool.ca',
    },

    async ready(t, page) {
        await page.getByRole('button', { name: 'Find my earliest retirement age' }).waitFor();
        await page.waitForLoadState('networkidle');
        // No help tooltips while gliding over labels and column headers, and no
        // smooth scrolling under Tutor.scroll.
        await page.addStyleTag({ content: '[role="tooltip"] { display: none !important; } html { scroll-behavior: auto !important; }' });
        await t.pause(600);
    },

    async run(t, page) {
        // --- Intro ------------------------------------------------------------
        await t.pause(400);
        await explain(t, page.getByRole('heading', { name: 'When can I retire?' }),
            'Find the earliest age you can stop working and still have your money last.', { dy: 0.9 });
        await t.hideCaption();

        // --- About you ----------------------------------------------------------
        await t.move(PARK_X, 400, { ms: 500 });
        await scrollTo(t, page, (await absTop(page, page.getByRole('heading', { name: 'Your numbers' }))) - 90, { ms: 1300 });
        await explain(t, field(page, 'Current age'),
            'Priya is 50, lives in Ontario and earns $90,000 a year.', { dwell: 1200, dx: 0.3 });
        await t.type(field(page, 'Current age'), PRIYA.age);
        await t.type(field(page, 'Income before tax'), PRIYA.income);
        await t.pause(700);
        await explain(t, page.locator('#wcir-target'),
            'Priya hopes to retire at 62. This one is optional: it\'s only there to compare.', { dwell: 1400, dx: 0.3 });
        await t.type(page.locator('#wcir-target'), PRIYA.target);
        await t.pause(1200);
        await t.hideCaption();

        // --- Savings --------------------------------------------------------------
        await explain(t, field(page, 'RRSP'),
            'Savings today: $450,000 in an RRSP, $120,000 in a TFSA and $80,000 non-registered.', { dwell: 1000, dx: 0.3 });
        await t.type(field(page, 'RRSP'), PRIYA.rrsp);
        await t.type(field(page, 'TFSA'), PRIYA.tfsa);
        await t.type(field(page, 'Non-registered'), PRIYA.nonReg);
        await t.pause(1000);
        await t.hideCaption();

        // --- Pension, spending, confidence --------------------------------------
        await t.move(PARK_X, 420, { ms: 500 });
        const spendHead = page.getByText('Household spending per year', { exact: true });
        await scrollTo(t, page, (await absTop(page, spendHead)) - 200, { ms: 1200 });
        await explain(t, page.getByText('I have a workplace pension', { exact: true }),
            'Have a workplace pension, or a spouse? Add them here.', { dx: 0.4 });
        await t.hideCaption();
        await explain(t, field(page, 'After retirement'),
            'The key number: Priya wants to spend $50,000 a year once retired, in today\'s dollars.', { dwell: 1400, dx: 0.3 });
        await t.type(field(page, 'After retirement'), PRIYA.spendAfter);
        await t.pause(1400);
        await t.hideCaption();
        await explain(t, page.getByRole('button', { name: 'Balanced (85%)' }),
            'How sure do you want to be? Balanced means the money lasts in 85% of market simulations.');
        await t.hideCaption();

        // --- Run ---------------------------------------------------------------------
        await seedRandom(page);
        await t.click(page.getByRole('button', { name: 'Find my earliest retirement age' }));
        await t.caption('It tries each age with different CPP, OAS and withdrawal choices.', 0);
        await page.getByRole('heading', { name: 'Your answer' }).waitFor({ timeout: 180000 });
        await t.pause(1000);
        await t.hideCaption();
        await expectResult(page);

        // --- The answer ----------------------------------------------------------
        await t.move(PARK_X, 400, { ms: 500 });
        const answerHead = page.getByRole('heading', { name: 'Your answer' });
        await scrollTo(t, page, (await absTop(page, answerHead)) - 90, { ms: 1400 });
        await explain(t, page.getByText(/^You can retire at 64/),
            'Priya can retire at 64, two years later than hoped. The money lasts in 86% of simulations.', { dx: 0.3 });
        await explain(t, page.getByText(/^To get there:/),
            'To get there: start CPP and OAS at 70, and draw down the RRSP early.', { dx: 0.3, dy: 0.3 });
        await t.hideCaption();

        // --- The table ---------------------------------------------------------------
        await t.move(PARK_X, 400, { ms: 500 });
        const tableHead = page.getByRole('heading', { name: 'Retiring earlier or later' });
        await scrollTo(t, page, (await absTop(page, tableHead)) - 90, { ms: 1400 });
        await glide(t, tableHead, { dx: 0.3 });
        await t.pause(400);
        await explain(t, cell(page, 62, 1),
            'The table shows the ages around the answer. At 62, the money lasts in only 76% of simulations.', { dx: 0.6 });
        await t.hideCaption();
        await explain(t, page.locator('th').filter({ hasText: 'Could spend' }),
            'Could spend: about the most Priya could spend each year retiring at that age, and still meet 85%.', { dx: 0.6 });
        await t.hideCaption();
        await explain(t, cell(page, 62, 4),
            'Retire at 62 anyway? Then plan on about $45,000 a year instead of $50,000.', { dx: 0.6 });
        await explain(t, cell(page, 68, 4),
            'Work until 68, and it\'s about $60,000 a year.', { dx: 0.6 });
        await t.hideCaption();

        // --- Hand off to the planner ---------------------------------------------------
        await t.move(PARK_X, 420, { ms: 500 });
        const planLink = page.getByRole('link', { name: 'See the full plan' });
        await scrollTo(t, page, (await absTop(page, planLink)) - 330, { ms: 1200 });
        await explain(t, planLink,
            'See the full plan opens it in the planner, with charts and a year-by-year table.');
        await t.hideCaption();
        await t.move(PARK_X, 420, { ms: 600 });
        await explain(t, null, 'Your numbers stay in your browser. Nothing is sent to a server.', { dwell: 2800 });
        await t.hideCaption();
    },
});
