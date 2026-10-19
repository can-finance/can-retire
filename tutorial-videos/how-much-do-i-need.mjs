// Tutorial: How much do I need to retire? — enter savings, a retirement age and
// a retirement spending target, run the search, and read the savings needed,
// the save-as-you-go alternative and the "Retiring earlier or later" table.
// The "1-min tour" opened from the How much do I need? page.
// Output: out/how-much-do-i-need.mp4
//
// Single take, like when-can-i-retire.mjs: everything depends on the numbers
// typed at the start, so re-recording the whole thing is simpler than scenes.
//
// Persona (fictional): Tom, 45, Ontario, earns $120,000, with $400,000 in an
// RRSP and $100,000 in a TFSA. Spends $70,000 a year now, wants $55,000 a year
// in retirement, and plans to retire at 62. Starts from the page's defaults in
// a fresh browser.
//
// The search's Monte Carlo pass draws from Math.random, so it is seeded
// (mulberry32, as in when-can-i-retire.mjs) right before the run: the amounts
// and success rates the captions quote then come out the same on every take,
// and expectResult stops the run if they change.

import { record } from './lib/recorder.mjs';
import { field } from './lib/app.mjs';

const TOM = {
    age: '45', income: '120000', retireAt: '62',
    rrsp: '400000', tfsa: '100000', nonReg: '0',
    spendBefore: '70000', spendAfter: '55000',
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
/** A cell of that row: 0 age, 1 need by then, 2 on track for, 3 difference, 4 odds. */
const cell = (page, age, i) => row(page, age).locator('td').nth(i);

/**
 * The captions quote Tom's numbers. If the app's answer changes, fail rather
 * than film captions that no longer match the screen.
 */
async function expectResult(page) {
    const text = await page.locator('main').innerText();
    const want = [
        'You need about $1.47M saved by 62',
        'You’re on track for about $1.22M, so about $250k more.',
        'start your CPP at 70 instead of 65; start your OAS at 70 instead of 65',
        'Or save as you go: spend about $6k less a year until you retire at 62.',
    ];
    const missing = want.filter((s) => !text.includes(s));
    const rows = {
        62: ['your plan', '$250k more'],
        64: ['$90k to spare', '✓'],
    };
    for (const [age, parts] of Object.entries(rows)) {
        const r = (await row(page, age).innerText()).replace(/\s+/g, ' ');
        for (const p of parts) if (!r.toLowerCase().includes(p.toLowerCase())) missing.push(`row ${age}: ${p}`);
    }
    if (missing.length) {
        const answer = text.slice(text.indexOf('Your answer'), text.indexOf('How this works'));
        throw new Error(`How much do I need result changed; the captions expect: ${missing.join(' | ')}\n--- page shows ---\n${answer}`);
    }
}

// Off to the right of the form, clear of the fields.
const PARK_X = 1130;

await record({
    name: 'how-much-do-i-need',
    url: '/how-much-do-i-need-to-retire/',
    title: { title: 'How much do I need to retire?', subtitle: 'The savings your retirement spending needs' },
    end: {
        title: 'Canadian Retirement Asset Planning Tool',
        subtitle: '100% free, private and secure',
        url: 'craptool.ca',
    },

    async ready(t, page) {
        await page.getByRole('button', { name: 'Find how much I need' }).waitFor();
        await page.waitForLoadState('networkidle');
        // No help tooltips while gliding over labels and column headers, and no
        // smooth scrolling under Tutor.scroll.
        await page.addStyleTag({ content: '[role="tooltip"] { display: none !important; } html { scroll-behavior: auto !important; }' });
        await t.pause(600);
    },

    async run(t, page) {
        // --- Intro ------------------------------------------------------------
        await t.pause(400);
        await explain(t, page.getByRole('heading', { name: 'How much do I need to retire?' }),
            'Find the savings you need to retire at the age you choose.', { dy: 0.9 });
        await t.hideCaption();

        // --- About you ----------------------------------------------------------
        await t.move(PARK_X, 400, { ms: 500 });
        await scrollTo(t, page, (await absTop(page, page.getByRole('heading', { name: 'Your numbers' }))) - 90, { ms: 1300 });
        await explain(t, field(page, 'Current age'),
            'Tom is 45, lives in Ontario, earns $120,000 a year and plans to retire at 62.', { dwell: 1200, dx: 0.3 });
        await t.type(field(page, 'Current age'), TOM.age);
        await t.type(field(page, 'Income before tax'), TOM.income);
        await t.type(field(page, 'Retirement age'), TOM.retireAt);
        await t.pause(900);
        await t.hideCaption();

        // --- Savings --------------------------------------------------------------
        await explain(t, field(page, 'RRSP'),
            'Savings today: $400,000 in an RRSP, $100,000 in a TFSA and nothing non-registered.', { dwell: 900, dx: 0.3 });
        await t.type(field(page, 'RRSP'), TOM.rrsp);
        await t.type(field(page, 'TFSA'), TOM.tfsa);
        await t.type(field(page, 'Non-registered'), TOM.nonReg);
        await t.pause(900);
        await t.hideCaption();

        // --- Spending -----------------------------------------------------------
        await t.move(PARK_X, 420, { ms: 500 });
        const spendHead = page.getByText('Household spending per year', { exact: true });
        await scrollTo(t, page, (await absTop(page, spendHead)) - 200, { ms: 1200 });
        await explain(t, field(page, 'Before retirement'),
            'Tom spends $70,000 a year now, and wants $55,000 a year once retired, in today\'s dollars.', { dwell: 1000, dx: 0.3 });
        await t.type(field(page, 'Before retirement'), TOM.spendBefore);
        await t.type(field(page, 'After retirement'), TOM.spendAfter);
        await t.pause(1200);
        await t.hideCaption();

        // --- Run ---------------------------------------------------------------------
        await seedRandom(page);
        await t.click(page.getByRole('button', { name: 'Find how much I need' }));
        await t.caption('It tests the plan in good and bad markets until the money lasts in 85% of them.', 0);
        await page.getByRole('heading', { name: 'Your answer' }).waitFor({ timeout: 180000 });
        await t.pause(1000);
        await t.hideCaption();
        await expectResult(page);

        // --- The answer ----------------------------------------------------------
        await t.move(PARK_X, 400, { ms: 500 });
        const answerHead = page.getByRole('heading', { name: 'Your answer' });
        await scrollTo(t, page, (await absTop(page, answerHead)) - 90, { ms: 1400 });
        await explain(t, page.getByText(/^You need about/),
            'Tom needs about $1.47 million by 62, and is on track for $1.22 million: $250,000 short.', { dx: 0.3 });
        await explain(t, page.getByText(/^To get there:/),
            'That assumes CPP and OAS start at 70, and the RRSP is drawn down early.', { dx: 0.3, dy: 0.3 });
        await explain(t, page.getByText(/^Or save as you go/),
            'Or close the gap by spending about $6,000 less a year until 62, and saving it.', { dx: 0.3, dy: 0.3 });
        await t.hideCaption();

        // --- The table ---------------------------------------------------------------
        await t.move(PARK_X, 400, { ms: 500 });
        const tableHead = page.getByRole('heading', { name: 'Retiring earlier or later' });
        await scrollTo(t, page, (await absTop(page, tableHead)) - 90, { ms: 1400 });
        await explain(t, cell(page, 62, 3),
            'The table shows nearby ages: what Tom would need by then, and the gap.', { dx: 0.6 });
        await explain(t, cell(page, 64, 3),
            'Working two more years, to 64, leaves about $90,000 to spare.', { dx: 0.6 });
        await t.hideCaption();

        // --- Hand off to the planner ---------------------------------------------------
        await t.move(PARK_X, 420, { ms: 500 });
        const planLink = page.getByRole('link', { name: 'See the full plan' });
        await scrollTo(t, page, (await absTop(page, planLink)) - 330, { ms: 1200 });
        const planText = 'Open either plan in the full planner, with charts and a year-by-year table.';
        await explain(t, planLink, planText, { dwell: readMs(planText) / 2 });
        await glide(t, page.getByRole('link', { name: 'See the save-as-you-go plan' }), { dx: 0.4 });
        await t.pause(readMs(planText) / 2);
        await t.hideCaption();
        await t.move(PARK_X, 420, { ms: 600 });
        await explain(t, null, 'Your numbers stay in your browser. Nothing is sent to a server.', { dwell: 2800 });
        await t.hideCaption();
    },
});
