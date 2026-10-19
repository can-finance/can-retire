// Human-paced actions for tutorial videos: gliding cursor, visible clicks,
// per-character typing, captions, cards, smooth scrolling.
//
// Pacing knobs live in PACE so every tutorial feels the same; override per
// call where a step needs it.

export const PACE = {
    moveMinMs: 400,        // shortest glide
    moveMaxMs: 900,        // longest glide
    moveMsPerPx: 0.75,     // glide time grows with distance, clamped to the above
    curve: 0.12,           // perpendicular bow of the path, as a fraction of distance
    hoverBeforeClickMs: 380,
    afterClickMs: 450,
    typeCharMs: [60, 110], // text
    typeDigitMs: [45, 75], // numbers
    afterTypeMs: 350,
    captionFadeMs: 350,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Tutor {
    /** @param {import('playwright').Page} page */
    constructor(page, start = { x: 640, y: 400 }) {
        this.page = page;
        this.x = start.x;
        this.y = start.y;
    }

    pause(ms) { return sleep(ms); }

    /** Log with the (approximate) timestamp in the final, trimmed video. */
    log(msg) {
        if (this.videoStart) console.log(`${((Date.now() - this.videoStart) / 1000).toFixed(2)}s  ${msg}`);
    }

    /** Glide the cursor to (x, y) along an eased, slightly curved path. */
    async move(x, y, { ms } = {}) {
        const x0 = this.x, y0 = this.y;
        const dx = x - x0, dy = y - y0;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return;
        const dur = ms ?? Math.min(PACE.moveMaxMs, Math.max(PACE.moveMinMs, dist * PACE.moveMsPerPx));
        // Quadratic Bezier control point, offset perpendicular to the straight line.
        const bow = dist * PACE.curve * (Math.random() < 0.5 ? -1 : 1);
        const cx = (x0 + x) / 2 + (-dy / dist) * bow;
        const cy = (y0 + y) / 2 + (dx / dist) * bow;
        const t0 = Date.now();
        for (;;) {
            const elapsed = Date.now() - t0;
            const t = Math.min(1, elapsed / dur);
            const e = easeInOut(t);
            const px = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * cx + e * e * x;
            const py = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * cy + e * e * y;
            await this.page.mouse.move(px, py);
            if (t >= 1) break;
            await sleep(12);
        }
        this.x = x;
        this.y = y;
    }

    /** Scroll the element into view (smoothly), then return its on-screen box. */
    async box(locator) {
        await locator.waitFor({ state: 'visible' });
        const inView = await locator.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= 60 && r.bottom <= window.innerHeight - 90;
        });
        if (!inView) {
            await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            await sleep(700);
        }
        const b = await locator.boundingBox();
        if (!b) throw new Error(`No bounding box for ${locator}`);
        return b;
    }

    /** Glide onto an element (a point near its centre, slightly jittered). */
    async moveTo(locator, { at } = {}) {
        const b = await this.box(locator);
        const px = at ? b.x + at.x : b.x + b.width / 2 + rand(-0.12, 0.12) * Math.min(b.width, 80);
        const py = at ? b.y + at.y : b.y + b.height / 2 + rand(-0.12, 0.12) * Math.min(b.height, 30);
        await this.move(px, py);
        return b;
    }

    /** Visible click effects at the current cursor position (no real click). */
    async clickEffect(box, { highlight = true } = {}) {
        const { x, y } = this;
        await this.page.evaluate(
            ({ x, y, box, highlight }) => {
                window.__tut.press(true);
                window.__tut.ripple(x, y);
                if (highlight && box) window.__tut.highlight(box);
            },
            { x, y, box, highlight },
        );
    }

    /** Hover, then click with a press + ripple + highlight. */
    async click(locator, { hover = PACE.hoverBeforeClickMs, after = PACE.afterClickMs, highlight = true, at } = {}) {
        const b = await this.moveTo(locator, { at });
        await sleep(hover);
        this.log(`click ${locator}`);
        await this.clickEffect(b, { highlight });
        await this.page.mouse.down();
        await sleep(90);
        await this.page.mouse.up();
        await this.page.evaluate(() => window.__tut.press(false));
        await sleep(after);
    }

    /** Glide to a point and click there (charts: a bar has no locator of its own). */
    async clickAt(x, y, { hover = PACE.hoverBeforeClickMs, after = PACE.afterClickMs } = {}) {
        await this.move(x, y);
        await sleep(hover);
        this.log(`click at ${Math.round(x)},${Math.round(y)}`);
        await this.clickEffect(null, { highlight: false });
        await this.page.mouse.down();
        await sleep(90);
        await this.page.mouse.up();
        await this.page.evaluate(() => window.__tut.press(false));
        await sleep(after);
    }

    /**
     * Click a text field, clear it, and type per character. Numeric strings type
     * a little faster. `commit: true` presses Enter afterwards (the app's
     * FinancialInput commits on blur/Enter).
     */
    async type(locator, text, { commit = true, after = PACE.afterTypeMs } = {}) {
        await this.click(locator, { after: 200 });
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Backspace');
        await sleep(160);
        const [lo, hi] = /^[\d.,]+$/.test(text) ? PACE.typeDigitMs : PACE.typeCharMs;
        for (const ch of text) {
            await this.page.keyboard.type(ch);
            await sleep(rand(lo, hi));
        }
        if (commit) await this.page.keyboard.press('Enter');
        await sleep(after);
    }

    /** Pick a <select> option with a visible click (native popups don't record). */
    async select(locator, value, { after = PACE.afterClickMs } = {}) {
        const b = await this.moveTo(locator);
        await sleep(PACE.hoverBeforeClickMs);
        await this.clickEffect(b);
        await sleep(120);
        await this.page.evaluate(() => window.__tut.press(false));
        await locator.selectOption(value);
        await sleep(after);
    }

    /**
     * Caption pill. `ms` > 0 auto-hides after that long; 0 leaves it up.
     * `pos`: 'bottom' (default), 'top', 'left' (beside a right-hand drawer), or
     * 'right' (bottom of the dashboard's chart column, clear of the inputs).
     */
    async caption(text, ms = 0, { pos } = {}) {
        this.log(`caption "${text}"`);
        await this.page.evaluate(({ t, pos }) => window.__tut.caption(t, pos), { t: text, pos });
        if (ms > 0) {
            await sleep(ms);
            await this.hideCaption();
        }
    }

    async hideCaption() {
        await this.page.evaluate(() => window.__tut.caption(''));
        await sleep(PACE.captionFadeMs);
    }

    /** Full-screen card (title / end card). Fades in, holds `ms`, stays up unless `hide`. */
    async card(title, subtitle, ms = 2000, { hide = false, url, instant = false } = {}) {
        await this.page.evaluate(({ title, subtitle, url, instant }) => window.__tut.card(title, subtitle, url, instant), { title, subtitle, url, instant });
        await sleep((instant ? 0 : 500) + ms);
        if (hide) await this.hideCard();
    }

    async hideCard() {
        await this.page.evaluate(() => window.__tut.hideCard());
        await sleep(550);
    }

    /**
     * Smooth-scroll the window so the element's top sits at `top` px from the
     * viewport top (e.g. just under the dashboard's sticky summary bar).
     */
    async scrollToTop(locator, top, { ms = 1500 } = {}) {
        const y = await locator.evaluate((el) => el.getBoundingClientRect().top);
        if (Math.abs(y - top) > 2) await this.scroll(y - top, { ms });
    }

    /** Smooth scroll of the window (or a scrollable element) by `dy` px over `ms`. */
    async scroll(dy, { ms = 1800, target } = {}) {
        const handle = target ? await target.elementHandle() : null;
        await this.page.evaluate(
            async ({ dy, ms, el }) => {
                const sc = el || document.scrollingElement;
                const start = sc.scrollTop;
                const t0 = performance.now();
                const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
                await new Promise((done) => {
                    const step = (now) => {
                        const t = Math.min(1, (now - t0) / ms);
                        sc.scrollTop = start + dy * ease(t);
                        if (t < 1) requestAnimationFrame(step); else done();
                    };
                    requestAnimationFrame(step);
                });
            },
            { dy, ms, el: handle },
        );
        await sleep(150);
    }
}
