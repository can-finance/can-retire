// can-retire specific locator helpers shared by the tutorial scripts.

/**
 * The app's FinancialInput labels aren't wired to their inputs (no htmlFor), so
 * find the label by its exact text and take the first input after it.
 * @param {import('playwright').Locator | import('playwright').Page} scope
 */
export function field(scope, label) {
    return scope
        .locator('label')
        .filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
        .first()
        .locator('xpath=(following::input)[1]');
}

/** The Guided Setup (onboarding) overlay. */
export const guidedSetup = (page) => page.getByRole('dialog', { name: 'Guided Setup' });

/** A dashboard chart's card, found by its heading ("Projected Net Worth", ...). */
export function chartCard(page, title) {
    return page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).last();
}

/**
 * Viewport coordinates inside a chart card's plot: x of an age on the age axis
 * (interpolated between the labelled ticks), y at a fraction of the plot height
 * (0 = top gridline, 1 = bottom gridline).
 */
export async function chartPoint(card, age, yFrac) {
    return card.evaluate((el, { age, yFrac }) => {
        const ticks = [...el.querySelectorAll('.recharts-xAxis-tick-labels text')]
            .map((t) => { const r = t.getBoundingClientRect(); return { v: Number(t.textContent), x: r.left + r.width / 2 }; })
            .filter((t) => Number.isFinite(t.v));
        const a = ticks[0], b = ticks[ticks.length - 1];
        const grid = el.querySelector('.recharts-cartesian-grid').getBoundingClientRect();
        return { x: a.x + ((age - a.v) * (b.x - a.x)) / (b.v - a.v), y: grid.top + yFrac * grid.height };
    }, { age, yFrac });
}

/** The Year Audit drawer that a chart bar or table row opens. */
export const yearDrawer = (page) => page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Next year' }) });

/**
 * The pilot's fictional persona (create-a-plan.mjs types the same values).
 * Strings, because they are typed into inputs.
 */
export const MARIA = {
    age: '45',
    retirementAge: '62',
    income: '95000',
    rrsp: '320000',
    tfsa: '95000',
    nonReg: '40000',
    spendBefore: '60000',
    spendAfter: '40000',
};

/**
 * Run Guided Setup's Quick start straight through (no pacing, no video) and land
 * on the dashboard. Used to build a saved-plan fixture (see fixture.mjs).
 */
export async function quickStartPlan(page, p = MARIA) {
    const dlg = guidedSetup(page);
    const set = async (label, value) => {
        // Same keystrokes as Tutor.type: FinancialInput reformats on focus, so
        // locator.fill() appends to the default instead of replacing it.
        // Typing at full speed occasionally loses a field, so check and retry.
        const input = field(dlg, label);
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
        throw new Error(`Could not set "${label}" to ${value} (field shows "${await input.inputValue()}")`);
    };
    await dlg.getByRole('button', { name: /Quick start/ }).click();
    await dlg.getByRole('heading', { name: 'About your household' }).waitFor();
    await set('Current age', p.age);
    await set('Retirement age', p.retirementAge);
    await set('Annual income (before tax)', p.income);
    await dlg.getByRole('button', { name: 'Next' }).click();
    await dlg.getByRole('heading', { name: 'Savings and spending' }).waitFor();
    await set('RRSP', p.rrsp);
    await set('TFSA', p.tfsa);
    await set('Non-registered', p.nonReg);
    await set('Before retirement', p.spendBefore);
    await set('After retirement', p.spendAfter);
    await dlg.getByRole('button', { name: 'Save' }).click();
    await dlg.getByRole('heading', { name: "You're set." }).waitFor();
    await dlg.getByRole('button', { name: 'Go to my dashboard' }).click();
    await dlg.waitFor({ state: 'detached' });
    await page.waitForLoadState('networkidle');
}
