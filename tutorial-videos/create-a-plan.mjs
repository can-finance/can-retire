// Tutorial: Create a plan — Guided Setup "Quick start" from a first visit
// through to the dashboard. Output: out/create-a-plan.mp4
//
// Persona (fictional): Alex, 45, Ontario, $95k income, retiring at 62.

import { record } from './lib/recorder.mjs';
import { field, guidedSetup } from './lib/app.mjs';

const ALEX = {
    age: '45',
    retirementAge: '62',
    income: '95000',
    rrsp: '320000',
    tfsa: '95000',
    nonReg: '40000',
    spendBefore: '60000',
    spendAfter: '40000',
};

await record({
    name: 'create-a-plan',
    url: '/',
    title: { title: 'Create your retirement plan', subtitle: 'Guided setup in about two minutes' },
    end: {
        title: 'Canadian Retirement Asset Planning Tool',
        subtitle: '100% free, private and secure',
        url: 'craptool.ca',
    },

    async ready(t, page) {
        await guidedSetup(page).getByRole('button', { name: /Quick start/ }).waitFor();
        await page.waitForLoadState('networkidle');
    },

    async run(t, page) {
        const dlg = guidedSetup(page);

        // --- Intro: pick the quick path ---------------------------------------
        await t.pause(700);
        await t.caption('First visit? Guided Setup builds your plan from a few questions.');
        await t.moveTo(dlg.getByRole('button', { name: /Quick start/ }));
        await t.pause(1800);
        await t.hideCaption();
        await t.click(dlg.getByRole('button', { name: /Quick start/ }));

        // --- Step 1: household ------------------------------------------------
        await dlg.getByRole('heading', { name: 'About your household' }).waitFor();
        await t.pause(600);
        await t.type(field(dlg, 'Current age'), ALEX.age);
        await t.type(field(dlg, 'Retirement age'), ALEX.retirementAge);
        await t.caption("Enter amounts in today's dollars. Inflation is handled for you.");
        await t.type(field(dlg, 'Annual income (before tax)'), ALEX.income);
        await t.pause(1200);
        await t.hideCaption();
        // Province already defaults to Ontario; just point it out.
        await t.moveTo(dlg.locator('select'));
        await t.caption("Your province's tax rates are used for accurate calculations.");
        await t.pause(2600);
        await t.hideCaption();
        await t.click(dlg.getByRole('button', { name: 'Next' }));

        // --- Step 2: savings and spending -------------------------------------
        await dlg.getByRole('heading', { name: 'Savings and spending' }).waitFor();
        await t.pause(600);
        await t.caption('Rough balances are fine. You can refine everything later.');
        await t.type(field(dlg, 'RRSP'), ALEX.rrsp);
        await t.type(field(dlg, 'TFSA'), ALEX.tfsa);
        await t.type(field(dlg, 'Non-registered'), ALEX.nonReg);
        await t.hideCaption();
        await t.type(field(dlg, 'Before retirement'), ALEX.spendBefore);
        await t.type(field(dlg, 'After retirement'), ALEX.spendAfter);
        await t.pause(400);
        await t.click(dlg.getByRole('button', { name: 'Save' }));

        // --- Closing ----------------------------------------------------------
        await dlg.getByRole('heading', { name: "You're set." }).waitFor();
        await t.pause(500);
        await t.caption('Your plan is saved in this browser only. Nothing is sent to a server.');
        await t.pause(2800);
        await t.hideCaption();
        await t.click(dlg.getByRole('button', { name: 'Go to my dashboard' }));

        // --- Results ----------------------------------------------------------
        await dlg.waitFor({ state: 'detached' });
        await page.waitForLoadState('networkidle');
        await t.pause(800);
        await t.caption('The summary shows at a glance whether the plan is funded.');
        await t.moveTo(page.getByText(/^plan outcome$/i).first(), { at: { x: 60, y: 30 } });
        await t.pause(3000);
        await t.hideCaption();
        // Nudge the page so the chart's axis and legend show (the summary bar
        // turns sticky, so a bigger scroll hides the chart's top), then hover
        // around retirement to pop its tooltip.
        await t.scroll(100, { ms: 1200 });
        await t.caption("Hover the chart to see any year's balances.");
        const chart = page.locator('.recharts-surface').first();
        const cb = await chart.boundingBox();
        await t.move(cb.x + cb.width * 0.38, cb.y + cb.height * 0.62);
        await t.pause(1200);
        await t.move(cb.x + cb.width * 0.52, cb.y + cb.height * 0.66, { ms: 1400 });
        await t.pause(3000);
        await t.hideCaption();
    },
});
