// Tutorial: CPP calculator — enter an earnings history in Simple mode, read the
// estimate, and compare starting CPP at 60, 65 and 70 on the Benefit by start
// age chart. The "1-min tour" opened from the CPP calculator page.
// Output: out/cpp-calculator.mp4
//
// Single take: it is about a minute long, and every part depends on the
// numbers typed at the start, so re-recording the whole thing (about two
// minutes) is simpler than seeding each scene's state.
//
// Persona (fictional): Sam, 50, worked from 22 to 62 at an average $70,000 in
// today's dollars. Starts from the calculator's defaults (fresh browser, no
// saved state), so the start age is 65.

import { record } from './lib/recorder.mjs';
import { field } from './lib/app.mjs';

const SAM = { age: '50', workEnd: '62', salary: '70000' };

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

/** A bar of the Benefit by start age chart (60 to 70). */
const bar = (page, age) => page.locator('.recharts-bar-rectangle').nth(age - 60);

/**
 * Click a bar near its top, where the cursor reads clearly against it. With
 * `above`, approach from above the plot: gliding across the plot would pop
 * every other bar's tooltip on the way.
 */
async function clickBar(t, page, age, { above = false } = {}) {
    const b = await bar(page, age).boundingBox();
    if (above) {
        const plot = await page.locator('.recharts-surface').first().boundingBox();
        await t.move(b.x + b.width / 2, plot.y - 18, { ms: 700 });
    }
    await t.clickAt(b.x + b.width / 2, b.y + Math.min(40, b.height / 2));
}

/**
 * The captions quote Sam's numbers. If the app's answer changes, fail rather
 * than film captions that no longer match the screen.
 */
async function expectResult(page) {
    const text = await page.locator('main').innerText();
    const want = [
        '$1,352/month', '$16,229/year', 'You qualify for 94% of the maximum pension',
        'starting at 69 pays the most in total',
        '$866/month', '$10,386/year (-36% vs starting at 65)',
        '$1,920/month', '$23,045/year (+42% vs starting at 65)',
        'The lowest 17% of the window is dropped — 8.0 years', '(47 years)',
    ];
    const missing = want.filter((s) => !text.includes(s));
    if (missing.length) throw new Error(`CPP result changed; the captions expect: ${missing.join(' | ')}`);
}

// Gutter between the inputs column and the results column.
const PARK_X = 533;

await record({
    name: 'cpp-calculator',
    url: '/cpp-calculator/',
    title: { title: 'The CPP calculator', subtitle: 'Your pension at 60, 65 or 70, from your own earnings' },
    end: {
        title: 'Canadian Retirement Asset Planning Tool',
        subtitle: '100% free, private and secure',
        url: 'craptool.ca',
    },

    async ready(t, page) {
        await page.getByRole('heading', { name: 'Benefit by start age' }).waitFor();
        await page.waitForLoadState('networkidle');
        // No help tooltips while gliding over labels, no smooth scrolling under
        // Tutor.scroll, and no focus ring on the chart after clicking a bar.
        await page.addStyleTag({ content: '[role="tooltip"] { display: none !important; } html { scroll-behavior: auto !important; }'
            + ' .recharts-wrapper *:focus, .recharts-surface:focus { outline: none !important; }' });
        await t.pause(1200); // chart entry animation
    },

    async run(t, page) {
        // --- Intro and current age (top of the page) -------------------------
        await t.pause(400);
        await explain(t, page.getByRole('heading', { name: 'CPP Retirement Pension Calculator' }),
            'Estimate your CPP pension from your own earnings history.', { dy: 0.9 });
        await explain(t, field(page, 'Current Age'),
            'Sam is 50. CPP counts every year from age 18.', { dwell: 1200 });
        await t.type(field(page, 'Current Age'), SAM.age);
        await t.pause(1200);
        // --- The three ways to enter earnings: tour the other two, back to Simple
        const tab = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) });
        const pick = async (name) => {
            await t.click(tab(name));
            await page.evaluate(() => document.activeElement?.blur?.());
        };
        await explain(t, tab('Simple'),
            'Simple mode needs only the ages you worked and an average salary.');
        await t.hideCaption();
        // The other tabs start empty (the estimate reads $0 until they have
        // earnings), so give each something to show; Simple keeps its own numbers.
        // Scrolled so the panels sit above the caption.
        await pick('Career Blocks');
        await scrollTo(t, page, 250, { ms: 900 });
        await t.click(page.getByRole('button', { name: '+ Add career period' }), { highlight: false });
        await explain(t, page.getByText('Annual salary', { exact: true }).first(),
            'Have more detail? Career Blocks takes a salary for each period of your career.');
        await t.hideCaption();
        await scrollTo(t, page, 0, { ms: 700 });
        await pick('Year by Year');
        await scrollTo(t, page, 250, { ms: 900 });
        await t.click(page.getByRole('button', { name: 'Prefill from Simple' }), { highlight: false });
        await explain(t, page.getByRole('button', { name: 'Paste from Statement of Contributions' }),
            'Year by Year takes exact earnings, or paste them from your Service Canada statement.');
        await t.hideCaption();
        await scrollTo(t, page, 0, { ms: 700 });
        await pick('Simple');
        await explain(t, null, 'Sam only knows an average salary, so Simple it is.', { dwell: 2300 });
        await t.hideCaption();

        // --- Working ages and salary -----------------------------------------
        await t.move(PARK_X, 420, { ms: 500 });
        await scrollTo(t, page, 180, { ms: 1200 });
        await glide(t, field(page, 'Starting Working Age'), { dx: 0.3 });
        await t.caption('Sam worked from 22 to 62.', 0);
        await t.pause(900);
        await t.type(field(page, 'Ending Working Age'), SAM.workEnd);
        await t.pause(1000);
        await explain(t, field(page, 'Average Salary (today\'s dollars)'),
            'Average salary, in today\'s dollars: $70,000.', { dwell: 900, dx: 0.3 });
        await t.type(field(page, 'Average Salary (today\'s dollars)'), SAM.salary);
        await t.pause(1400);
        await expectResult(page);

        // --- The estimate ----------------------------------------------------
        await explain(t, page.getByText('$1,352', { exact: false }).first(),
            'Starting at 65: $1,352 a month, or $16,229 a year, in today\'s dollars.', { dx: 0.6 });
        await explain(t, page.getByText('94%', { exact: true }).first(),
            'That\'s 94% of the maximum CPP pension.');
        await t.hideCaption();

        // --- Compare start ages ----------------------------------------------
        await t.move(PARK_X, 300, { ms: 500 });
        const chartHead = page.getByRole('heading', { name: 'Benefit by start age' });
        await scrollTo(t, page, (await absTop(page, chartHead)) - 100, { ms: 1400 });
        await explain(t, chartHead, 'Benefit by start age: your pension at every age from 60 to 70.', { dx: 0.3 });
        await clickBar(t, page, 60);
        await explain(t, null, 'Start at 60: $866 a month, 36% less, for life.');
        await t.hideCaption();
        await clickBar(t, page, 70, { above: true });
        await explain(t, null, 'Wait until 70: $1,920 a month, 42% more.');
        await t.hideCaption();
        await explain(t, page.getByText(/If you live to 85, starting at/),
            'If you live to 85, starting at 69 pays the most in total, before tax.', { dx: 0.75, dy: 0.25 });
        await t.hideCaption();
        await t.caption('Click any bar to make it your start age.', 0);
        await clickBar(t, page, 65, { above: true });
        await t.pause(1600);
        await t.hideCaption();
        await t.move(PARK_X, 330, { ms: 600 });

        // --- How it was calculated -------------------------------------------
        const howHead = page.getByRole('heading', { name: 'How this was calculated' });
        await scrollTo(t, page, (await absTop(page, howHead)) - 100, { ms: 1600 });
        await explain(t, howHead, 'How this was calculated shows each step with Sam\'s numbers.', { dx: 0.3 });
        await explain(t, page.getByText('Lowest years dropped', { exact: false }).first(),
            'The lowest 17% of years are dropped: 8 of Sam\'s 47.', { dy: -0.6 });
        await t.hideCaption();

        // --- Use it in the plan ----------------------------------------------
        await t.move(PARK_X, 330, { ms: 500 });
        const applyHead = page.getByRole('heading', { name: 'Use in your retirement plan' });
        await scrollTo(t, page, (await absTop(page, applyHead)) - 260, { ms: 1800 });
        await explain(t, page.getByRole('button', { name: 'Apply to You' }),
            'Apply to You uses this estimate in your dashboard plan.');
        await t.hideCaption();
        await t.move(PARK_X, 380, { ms: 600 });
        await explain(t, null, 'Your numbers stay in your browser. Nothing is sent to a server.', { dwell: 2800 });
        await t.hideCaption();
    },
});
