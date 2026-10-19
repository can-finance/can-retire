// Tutorial: All inputs explained — every input in the dashboard's left-hand
// column, section by section, with what each one changes in the plan.
// Output: out/all-inputs.mp4
//
// Recorded as scenes (see README): re-record one with
//   node all-inputs.mjs --scene settings
//
// Starts on the dashboard with the same saved plan as the dashboard tour
// (fixtures/dashboard-alex.json). Scenes that expand a collapsed section or add
// an account put it back before they end, so every join lines up with the next
// scene's fresh page load.
//
// Captions sit bottom-right ({ pos: 'right' }), over the chart column, so they
// never cover the input being described. Help tooltips are hidden while the
// cursor glides across labels and shown only where a scene hovers one on purpose.

import { recordScenes, BASE_URL, SIZE } from './lib/recorder.mjs';
import { MARIA, field, guidedSetup, quickStartPlan } from './lib/app.mjs';
import { ensureFixture } from './lib/fixture.mjs';

const storage = await ensureFixture('dashboard-alex', (page) => quickStartPlan(page, MARIA), {
    baseUrl: BASE_URL,
    size: SIZE,
    refresh: process.argv.includes('--refresh-fixture'),
});

// The sticky app header + summary bar cover the top ~220px once scrolled.
const TOP = 262;
// Lowest y an input may sit at and still be comfortably on screen.
const BOTTOM = 690;
// Parking spot in the gutter between the inputs column and the charts.
const PARK_X = 427;

/** One of the left column's cards, by its heading ("You", "Settings", ...). */
const section = (page, title) =>
    page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first();

/** A card's header button (expands / collapses it). */
const header = (page, title) => section(page, title).locator(':scope > button').first();

/** Toggle switch next to a label. */
const toggle = (scope, label) =>
    scope.locator('label', { hasText: label }).first().locator('xpath=following::button[@role="switch"][1]');

/** Help tooltips on or off (CSS only; the app's own hover logic is untouched). */
const tips = (page, on) => page.evaluate((on) => document.documentElement.classList.toggle('tut-notips', !on), on);

/** How long a caption stays up: long enough to read twice at a calm pace. */
const readMs = (text) => Math.max(2300, 700 + text.length * 46);

/** Smooth-scroll the window so that [top, bottom] of the given locators fits under the sticky bar. */
async function reveal(t, first, last = first, { ms = 900 } = {}) {
    const a = await first.boundingBox();
    const b = await last.boundingBox();
    const top = a.y, bottom = b.y + b.height;
    if (top >= TOP && bottom <= BOTTOM) return;
    await t.scroll(top - TOP, { ms });
}

/** Glide onto an element (no scroll-into-view: the sticky bar would hide it). */
async function glide(t, locator, { dx = 0.5, dy = 0.5, ms } = {}) {
    const b = await locator.boundingBox();
    await t.move(b.x + b.width * dx, b.y + b.height * dy, ms ? { ms } : undefined);
}

/** Point at an element while its caption shows. */
async function explain(t, locator, text, { dwell, ...g } = {}) {
    await glide(t, locator, g);
    await t.caption(text, 0, { pos: 'right' });
    await t.pause(dwell ?? readMs(text));
}

/** Click something and leave no focus ring behind. */
async function press(t, page, locator) {
    await t.click(locator, { highlight: false });
    await page.evaluate(() => document.activeElement?.blur?.());
}

await recordScenes({
    name: 'all-inputs',
    url: '/',
    storage,
    start: { x: PARK_X, y: 420 },
    title: { title: 'Every input, explained', subtitle: 'What each field on the dashboard changes in your plan' },
    end: {
        title: 'Canadian Retirement Asset Planning Tool',
        subtitle: '100% free, private and secure',
        url: 'craptool.ca',
    },

    async ready(t, page) {
        await page.getByRole('heading', { name: 'Projected Net Worth' }).waitFor();
        await page.waitForLoadState('networkidle');
        if (await guidedSetup(page).count()) throw new Error('Guided Setup opened: the saved-plan fixture did not load');
        // The app sets `html { scroll-behavior: smooth }`, which makes every
        // per-frame scrollTop write in Tutor.scroll start its own smooth scroll,
        // so the page keeps moving after the call returns and clicks land on
        // whatever slid under the cursor. Tutor.scroll is smooth already.
        await page.addStyleTag({ content: 'html.tut-notips [role="tooltip"] { display: none !important; } html { scroll-behavior: auto !important; }' });
        await tips(page, false);
        await t.pause(1600); // chart entry animations
    },

    scenes: [
        // --- 1. Where the inputs live, and Plan Manager -----------------------
        {
            id: 'intro',
            async run(t, page) {
                const pm = section(page, 'Plan Manager');
                await explain(t, pm.getByRole('heading', { name: 'Plan Manager' }),
                    'Every input is in the left column. Change one and the plan reruns.', { dx: 0.9 });
                await explain(t, pm.getByRole('button', { name: 'Duplicate Plan' }),
                    'Plan Manager holds your saved plans: share, duplicate, compare.');
                await t.hideCaption();
                await t.move(PARK_X, 600);
            },
        },

        // --- 2. You: ages, CPP / OAS, income ---------------------------------
        {
            id: 'you',
            async run(t, page) {
                const you = section(page, 'You');
                await reveal(t, you, field(you, 'Annual Income'), { ms: 1400 });
                await t.pause(300);
                await explain(t, field(you, 'Current Age'),
                    'Current Age, and the Retirement Age when your salary stops.');
                await glide(t, field(you, 'Retirement Age'), { ms: 700 });
                await t.pause(800);

                // Show a change rerunning the plan: retire at 60, watch the
                // summary bar move, then put it back so the scene joins cleanly.
                const retire = field(you, 'Retirement Age');
                await t.type(retire, '60');
                await t.caption('Change any input and everything updates at once.', 0, { pos: 'right' });
                await t.moveTo(page.getByText(/^net estate$/i).first(), { at: { x: 60, y: 30 } });
                await t.pause(readMs('Change any input and everything updates at once.') + 800);
                await t.hideCaption();
                await t.type(retire, '62');
                await t.pause(700);

                // Show that dotted labels explain themselves.
                const lifeLabel = you.locator('label', { hasText: 'Life Expectancy' });
                await t.caption('Dotted-underlined labels explain themselves. Hover one to read it.', 0, { pos: 'right' });
                await tips(page, true);
                await glide(t, lifeLabel, { dx: 0.4, dy: 0.7 });
                await t.pause(readMs('Dotted-underlined labels explain themselves. Hover one to read it.'));
                await t.caption('Life Expectancy: the plan runs to this age, then taxes your estate.', 0, { pos: 'right' });
                await t.pause(readMs('Life Expectancy: the plan runs to this age, then taxes your estate.'));
                // Off the label (tooltip hides on mouseleave), then tooltips off again.
                await t.move(PARK_X, (await lifeLabel.boundingBox()).y + 60, { ms: 500 });
                await tips(page, false);

                await explain(t, field(you, 'CPP Start Age'),
                    'CPP can start from 60 to 70. Starting later pays more each month.');
                await explain(t, field(you, 'CPP Years'),
                    'CPP Years: years you paid in near the maximum. 40+ pays in full.');
                await explain(t, you.getByText(/Want a more accurate CPP estimate/),
                    'Earned less? The CPP Calculator estimates from your actual earnings.', { dx: 0.35 });
                await explain(t, field(you, 'OAS Start Age'),
                    'OAS can start from 65 to 70, paying 7.2% more per year of delay.');
                await explain(t, field(you, 'Annual Income'),
                    'Annual Income: pre-tax pay in today’s dollars, rising with inflation.', { dx: 0.4 });
                await t.hideCaption();
                await t.move(PARK_X, 640);
            },
        },

        // --- 3. Accounts: RRSP, TFSA, Non-Registered, asset mix --------------
        {
            id: 'accounts',
            async run(t, page) {
                const you = section(page, 'You');
                const mixBtn = you.getByRole('button', { name: /Adjust asset mix/ }).first();
                await reveal(t, field(you, 'RRSP'), mixBtn, { ms: 1200 });
                await t.pause(300);
                await explain(t, field(you, 'RRSP'),
                    'Today’s RRSP and TFSA balances. Each grows at its own rate of return.');
                await glide(t, field(you, 'TFSA'), { ms: 700 });
                await t.pause(700);
                await explain(t, field(you, 'TFSA'),
                    'Savings left after spending fill TFSA, then RRSP, then Non-Registered.', { dx: 0.3 });
                await explain(t, field(you, 'Balance'),
                    'Non-Registered: taxable accounts. ACB is what you originally paid in.');
                await explain(t, field(you, 'ACB'),
                    'Gains above the ACB are taxed as capital gains when you sell.');

                // Add a second account to show the Surplus choice, then remove it.
                await t.caption('+ Add account adds another, like a second brokerage account.', 0, { pos: 'right' });
                await t.pause(600);
                await press(t, page, you.getByRole('button', { name: '+ Add account' }));
                await t.pause(1200);
                const radios = you.getByRole('radio');
                await radios.nth(1).waitFor();
                await reveal(t, field(you, 'RRSP'), you.getByRole('button', { name: /Adjust asset mix/ }).last(), { ms: 900 });
                await explain(t, radios.nth(1),
                    'With two or more, Surplus picks which one receives extra savings.', { dx: 0.5 });
                await t.hideCaption();
                await press(t, page, you.getByRole('button', { name: 'Remove account' }).last());
                await t.pause(500);
                await t.move(PARK_X, t.y, { ms: 400 });
                await t.pause(400);

                // Asset mix
                await reveal(t, field(you, 'Balance'), mixBtn, { ms: 700 });
                await press(t, page, mixBtn);
                await t.pause(500);
                await reveal(t, mixBtn, toggle(you, 'Rebalance Annually'), { ms: 1200 });
                await explain(t, mixBtn,
                    'Adjust asset mix sets what it holds; each part is taxed differently.', { dx: 0.25 });
                await explain(t, field(you, 'Equity (Growth)'),
                    'Equity grows in price; bonds and cash pay interest, taxed as income.');
                await glide(t, field(you, 'Bonds'), { ms: 600 });
                await glide(t, field(you, 'Cash'), { ms: 700 });
                await t.pause(800);
                await explain(t, field(you, 'Cdn Dividends'),
                    'Cdn dividends get the dividend tax credit; foreign dividends don’t.');
                await glide(t, field(you, 'Foreign Dividends'), { ms: 600 });
                await t.pause(800);
                await explain(t, field(you, 'Fund Turnover'),
                    'Fund Turnover: gains a fund sells off each year, taxed yearly.');
                await explain(t, toggle(you, 'Rebalance Annually'),
                    'Rebalance Annually resets the mix yearly; off, equity drifts up.');
                await t.hideCaption();
                // Collapse again so the next scene's fresh load lines up.
                await press(t, page, mixBtn);
                await t.pause(300);
                await t.move(PARK_X, t.y, { ms: 500 });
            },
        },

        // --- 4. RRSP melt and workplace pension ------------------------------
        {
            id: 'melt',
            async run(t, page) {
                const you = section(page, 'You');
                const penBtn = you.getByRole('button', { name: /Workplace Pension \(DB\)/ });
                await reveal(t, field(you, 'RRSP Melt Start Age'), penBtn, { ms: 1000 });
                await t.pause(300);
                await explain(t, field(you, 'RRSP Melt Start Age'),
                    'RRSP Melt: a fixed yearly RRSP withdrawal from the start age until 71.');
                await explain(t, field(you, 'RRSP Melt Amount'),
                    'New plans melt nothing. The start age follows your retirement age.');
                await explain(t, you.getByRole('button', { name: /Not sure how much to melt/ }),
                    'Not sure how much? The optimizer tests amounts and CPP/OAS ages.', { dx: 0.4 });

                await t.hideCaption();
                await press(t, page, penBtn);
                await t.pause(500);
                await reveal(t, penBtn, field(you, 'Bridge Benefit'), { ms: 1000 });
                await explain(t, field(you, 'Annual Amount'),
                    'Workplace Pension (DB): a defined-benefit pension, in today’s dollars.');
                await glide(t, field(you, 'Start Age'), { ms: 700 });
                await t.pause(800);
                await explain(t, toggle(you, 'Indexed to Inflation'),
                    'Indexed rises with inflation; off, the payment is fixed from Start Age.');
                await explain(t, field(you, 'Bridge Benefit'),
                    'Bridge Benefit: extra yearly pay until Bridge End Age, often 65.');
                await glide(t, field(you, 'Bridge End Age'), { ms: 700 });
                await t.pause(900);
                await t.hideCaption();
                await press(t, page, penBtn);
                await t.pause(300);
                await t.move(PARK_X, t.y, { ms: 500 });
            },
        },

        // --- 5. Household Spending (Add Spouse has its own couples video) -----
        {
            id: 'spending',
            async run(t, page) {
                const hs = section(page, 'Household Spending');
                await reveal(t, field(hs, 'Pre-Retirement'), hs.getByText('First-year withdrawal rate'), { ms: 1200 });
                await explain(t, field(hs, 'Pre-Retirement'),
                    'Yearly household spending in today’s dollars, before and after retiring.');
                await glide(t, field(hs, 'Post-Retirement'), { ms: 700 });
                await t.pause(1000);
                await explain(t, hs.getByRole('heading', { name: 'One-Time Events' }),
                    'One-Time Events: a single expense or inflow, like a car or inheritance.', { dx: 0.3 });
                await glide(t, hs.getByPlaceholder('e.g. New Car'), { ms: 700 });
                await t.pause(800);
                await explain(t, hs.getByText('First-year withdrawal rate'),
                    'First-year withdrawal rate: what you draw from savings in year one.');
                await t.hideCaption();
                await t.move(PARK_X, t.y, { ms: 500 });
            },
        },

        // --- 6. Settings -----------------------------------------------------
        {
            id: 'settings',
            async run(t, page) {
                const st = section(page, 'Settings');
                const hdr = header(page, 'Settings');
                await reveal(t, hdr, hdr, { ms: 1200 });
                await press(t, page, hdr);
                await t.pause(500);
                await reveal(t, hdr, toggle(st, 'Show Today'), { ms: 1200 });
                await explain(t, st.locator('select'),
                    'Province sets the provincial tax brackets, surtaxes and credits.', { dx: 0.3 });
                await explain(t, field(st, 'Inflation Rate'),
                    'Inflation Rate grows spending, income and benefits each year.', { dx: 0.3 });
                await explain(t, toggle(st, 'Fund spending from RRSP first'),
                    'Withdrawal order. On: RRSP first. Off: Non-Reg, then TFSA, RRSP last.');

                // Today's dollars: flip it to show the summary figures change.
                const today = toggle(st, 'Show Today');
                await explain(t, today, 'Show Today’s Dollars removes inflation from the figures shown.', { dwell: 1600 });
                await press(t, page, today);
                await t.pause(2600);
                await press(t, page, today);
                await t.pause(800);
                await t.hideCaption();
                await reveal(t, hdr, hdr, { ms: 700 });
                await press(t, page, hdr);
                await t.pause(400);
                await t.move(PARK_X, t.y, { ms: 500 });
            },
        },

        // --- 7. Rates of Return ----------------------------------------------
        {
            id: 'returns',
            async run(t, page) {
                const rr = section(page, 'Rates of Return');
                const hdr = header(page, 'Rates of Return');
                await reveal(t, hdr, hdr, { ms: 900 });
                await press(t, page, hdr);
                await t.pause(500);
                await reveal(t, hdr, field(rr, 'Non-Reg Cash Interest'), { ms: 1200 });
                await explain(t, field(rr, 'RRSP Return (total)'),
                    'RRSP and TFSA returns are totals: growth plus income, untaxed inside.');
                await glide(t, field(rr, 'TFSA Return (total)'), { ms: 700 });
                await t.pause(700);
                await explain(t, field(rr, 'Non-Reg Growth (price only)'),
                    'Non-Reg Growth is price only; dividends and interest are set below.');
                await explain(t, field(rr, 'Non-Reg Bonds Total Return'),
                    'These rates apply to each slice of the non-registered asset mix.');
                await glide(t, field(rr, 'Non-Reg Cdn Dividend Yield'), { ms: 600 });
                await glide(t, field(rr, 'Non-Reg Foreign Yield'), { ms: 600 });
                await glide(t, field(rr, 'Non-Reg Cash Interest'), { ms: 600 });
                await t.pause(800);
                await t.hideCaption();
                await reveal(t, hdr, hdr, { ms: 900 });
                await press(t, page, hdr);
                await t.pause(400);
                await t.move(PARK_X, t.y, { ms: 500 });
            },
        },

        // --- 8. Monte Carlo --------------------------------------------------
        {
            id: 'montecarlo',
            async run(t, page) {
                const mc = section(page, 'Monte Carlo');
                const hdr = header(page, 'Monte Carlo');
                await reveal(t, hdr, hdr, { ms: 900 });
                await press(t, page, hdr);
                await t.pause(500);
                const sw = mc.getByRole('switch');
                await explain(t, sw, 'Monte Carlo reruns the plan 200 times with random yearly returns.', { dwell: 1800 });
                await press(t, page, sw);
                await field(mc, 'Volatility (Risk)').waitFor();
                await t.pause(1600);
                await reveal(t, hdr, field(mc, 'Volatility (Risk)'), { ms: 700 });
                await explain(t, field(mc, 'Volatility (Risk)'),
                    'Volatility: how much returns swing yearly. About 10% for a 60/40 mix.');
                await t.hideCaption();
                await press(t, page, sw);
                await t.pause(500);
                await press(t, page, hdr);
                await t.pause(400);
                await t.move(PARK_X, t.y, { ms: 500 });
            },
        },
    ],
});
