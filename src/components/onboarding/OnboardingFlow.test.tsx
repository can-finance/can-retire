// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { OnboardingFlow } from './OnboardingFlow';
import { ONBOARDING_KEY, SIM_KEY } from '../../utils/onboarding';
import {
    INITIAL_INPUTS,
    createDefaultPerson,
    createNonRegAccount,
    sanitizeSimulationInputs,
} from '../../utils/inputSanitizer';
import type { SimulationInputs } from '../../engine/types';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- test helpers --------------------------------------------------------------

/**
 * FinancialInput/Toggle render their <label> as a SIBLING of the control (not a
 * wrapping <label for>), so RTL's getByLabelText can't associate them. Walk up
 * from the label text node until an ancestor contains the target control --
 * that ancestor is each field's own wrapper div, so this never crosses into a
 * neighboring field.
 */
function fieldFor(labelText: string | RegExp, selector = 'input'): HTMLElement {
    const label = screen.getByText(labelText);
    let node: HTMLElement | null = label.parentElement;
    while (node && !node.querySelector(selector)) {
        node = node.parentElement;
    }
    const el = node?.querySelector(selector);
    if (!el) throw new Error(`Could not find "${selector}" near label "${String(labelText)}"`);
    return el as HTMLElement;
}

/**
 * FinancialInput's onFocus schedules `requestAnimationFrame(() => input.select())`
 * (see src/components/inputs/FinancialInput.tsx) to select-all on focus. With
 * userEvent's synthetic typing that rAF callback can fire mid-keystroke and
 * re-select (then clobber) characters already typed -- an intermittent race
 * that shows up as e.g. "60" being typed but only "0" landing. Click to focus,
 * let that rAF resolve, THEN clear/type/commit so typing can't race it.
 */
async function setFinancialInput(
    user: ReturnType<typeof userEvent.setup>,
    input: HTMLElement,
    text: string
): Promise<void> {
    await user.click(input);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await user.clear(input);
    await user.type(input, text);
    await user.tab();
}

function freshSeed(overrides: Partial<SimulationInputs> = {}): SimulationInputs {
    return JSON.parse(JSON.stringify({ ...INITIAL_INPUTS, ...overrides }));
}

/**
 * jsdom implements pushState/go/popstate, but a traversal is a QUEUED task --
 * history.back() returns long before the popstate fires, and measurably later
 * than a single setTimeout(0) turn. Drain several macrotask turns (inside act,
 * so the popstate-driven setState is covered) before asserting.
 */
async function settle(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 8; i++) {
            await new Promise((resolve) => setTimeout(resolve, 2));
        }
    });
}

/** Presses the browser's Back button and waits for the resulting popstate to be handled. */
async function pressBack(): Promise<void> {
    await act(async () => {
        window.history.back();
    });
    await settle();
}

/** The marker useHistoryOverlay writes onto entries it owns, or null on the base entry. */
function currentOverlay(): string | null {
    const state = window.history.state as { __overlay?: string } | null;
    return state?.__overlay ?? null;
}

/**
 * Mirrors App's `{active && <OnboardingFlow ... />}`: the wizard is UNMOUNTED
 * when it reports done, and that unmount is what hands its borrowed history
 * entry back. Rendering OnboardingFlow bare would leave it mounted after
 * onDone and make every "is the history clean afterwards" assertion vacuous.
 */
function WizardHost({ onDone }: { onDone: (committed: boolean) => void }) {
    const [seed] = useState(() => freshSeed());
    const [open, setOpen] = useState(true);
    if (!open) return <div data-testid="wizard-closed" />;
    return (
        <OnboardingFlow
            seed={seed}
            onDone={(committed) => {
                onDone(committed);
                setOpen(false);
            }}
            onOpenPrivacy={vi.fn()}
        />
    );
}

describe('OnboardingFlow', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('Save commits BEFORE closing; the closing screen is pure confirmation with no further sim writes', async () => {
        const user = userEvent.setup();
        const onDone = vi.fn();
        render(<OnboardingFlow seed={freshSeed()} onDone={onDone} onOpenPrivacy={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Quick start/ }));
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        // Save already committed -- the sim key exists and the closing screen shows.
        expect(window.localStorage.getItem(SIM_KEY)).not.toBeNull();
        expect(screen.getByRole('heading', { name: "You're set." })).toBeInTheDocument();

        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
        await user.click(screen.getByRole('button', { name: 'Go to my dashboard' }));

        expect(onDone).toHaveBeenCalledWith(true);
        expect(onDone).toHaveBeenCalledTimes(1);
        const simKeyWrites = setItemSpy.mock.calls.filter(([key]) => key === SIM_KEY);
        expect(simKeyWrites).toHaveLength(0);
    });

    it('Skip from the intro writes nothing to the sim key', async () => {
        const user = userEvent.setup();
        const onDone = vi.fn();
        render(<OnboardingFlow seed={freshSeed()} onDone={onDone} onOpenPrivacy={vi.fn()} />);

        await user.click(
            screen.getByRole('button', { name: 'Skip — explore with sample numbers instead' })
        );

        expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe('1');
        expect(window.localStorage.getItem(SIM_KEY)).toBeNull();
        expect(onDone).toHaveBeenCalledWith(false);
    });

    it('an untouched relaunch (quick path, Save, nothing edited) round-trips a rich seed losslessly', async () => {
        const user = userEvent.setup();
        const richSeedRaw: SimulationInputs = {
            ...freshSeed(),
            person: {
                ...createDefaultPerson(),
                cppAnnualOverride: 14000,
                nonRegisteredAccounts: [
                    createNonRegAccount({
                        balance: 120000,
                        adjustedCostBase: 60000,
                        receivesSurplus: true,
                        id: 'acc-a',
                    }),
                    createNonRegAccount({ balance: 80000, adjustedCostBase: 25000, id: 'acc-b' }),
                ],
            },
            oneTimeExpenses: [{ id: 'e1', name: 'Reno', amount: 30000, age: 60, type: 'expense' }],
            returnRates: { ...INITIAL_INPUTS.returnRates, cashInterest: 0.033 },
        };
        const seed = sanitizeSimulationInputs(richSeedRaw)!;

        render(<OnboardingFlow seed={seed} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Quick start/ }));
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        const stored = JSON.parse(window.localStorage.getItem(SIM_KEY)!);
        expect(stored).toEqual(seed);
    });

    it('detailed path: the spouse stash restores the previous spouse (not the 45 default) after an off/on toggle', async () => {
        const user = userEvent.setup();
        const seed = freshSeed({ spouse: { ...createDefaultPerson(true), age: 58 } });
        render(<OnboardingFlow seed={seed} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Full setup/ }));
        expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();

        const spouseSwitch = fieldFor('Include a spouse / partner', 'button[role="switch"]');
        expect(spouseSwitch).toHaveAttribute('aria-checked', 'true');

        await user.click(spouseSwitch); // off -- stashes the age-58 spouse
        expect(spouseSwitch).toHaveAttribute('aria-checked', 'false');
        await user.click(spouseSwitch); // on -- restores the stash, not a fresh default
        expect(spouseSwitch).toHaveAttribute('aria-checked', 'true');

        // about-you -> benefits-you -> pension-you -> accounts-you -> meltdown-you -> about-spouse
        for (let i = 0; i < 5; i++) {
            await user.click(screen.getByRole('button', { name: 'Next' }));
        }
        expect(await screen.findByRole('heading', { name: 'About your spouse' })).toBeInTheDocument();

        const spouseAgeInput = fieldFor('Current age') as HTMLInputElement;
        expect(spouseAgeInput.value).toBe('58');
    });

    it('switching from Quick start to Full setup carries a quick-path edit into the draft', async () => {
        const user = userEvent.setup();
        render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Quick start/ }));
        const quickAgeInput = fieldFor('Current age') as HTMLInputElement;
        await setFinancialInput(user, quickAgeInput, '33');
        expect(quickAgeInput.value).toBe('33');

        await user.click(screen.getByRole('button', { name: 'Back' }));
        await user.click(screen.getByRole('button', { name: /Full setup/ }));
        expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();

        const detailedAgeInput = fieldFor('Current age') as HTMLInputElement;
        expect(detailedAgeInput.value).toBe('33');
    });

    it('raw validation: retirement age below current age shows the inline warning without clamping the input', async () => {
        const user = userEvent.setup();
        render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Quick start/ }));

        const ageInput = fieldFor('Current age') as HTMLInputElement;
        await setFinancialInput(user, ageInput, '60');

        const retirementInput = fieldFor('Retirement age') as HTMLInputElement;
        await setFinancialInput(user, retirementInput, '55');

        expect(await screen.findByText("Retirement age can't be earlier than current age")).toBeInTheDocument();
        expect(retirementInput.value).toBe('55');
    });

    it('Escape acts as skip on the intro, but does nothing on the closing screen', async () => {
        const user = userEvent.setup();

        // Intro: Escape mirrors the skip button.
        const onDoneIntro = vi.fn();
        const first = render(<OnboardingFlow seed={freshSeed()} onDone={onDoneIntro} onOpenPrivacy={vi.fn()} />);
        await user.keyboard('{Escape}');
        expect(onDoneIntro).toHaveBeenCalledWith(false);
        expect(window.localStorage.getItem(SIM_KEY)).toBeNull();
        expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe('1');
        first.unmount();

        // Closing screen: Escape does nothing (Save already committed; button is hidden).
        window.localStorage.clear();
        const onDoneClosing = vi.fn();
        render(<OnboardingFlow seed={freshSeed()} onDone={onDoneClosing} onOpenPrivacy={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: /Quick start/ }));
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByRole('heading', { name: "You're set." })).toBeInTheDocument();

        await user.keyboard('{Escape}');
        expect(screen.getByRole('heading', { name: "You're set." })).toBeInTheDocument();
        expect(onDoneClosing).not.toHaveBeenCalled();
    });

    // The wizard used to warn and commit anyway: the banner lived inside individual
    // field groups while nothing gated Next/Save, and neither path showed a banner
    // on the step that owns the Save button.
    describe('validation gating', () => {
        it('quick path: Next refuses to advance past an inconsistency and says so', async () => {
            const user = userEvent.setup();
            render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

            await user.click(screen.getByRole('button', { name: /Quick start/ }));
            await setFinancialInput(user, fieldFor('Current age'), '60');
            await setFinancialInput(user, fieldFor('Retirement age'), '55');

            await user.click(screen.getByRole('button', { name: 'Next' }));

            // Still on step 0, with an explicit reason rather than a dead button.
            expect(screen.getByRole('heading', { name: 'About your household' })).toBeInTheDocument();
            expect(screen.getByText(/Fix the item above to continue/)).toBeInTheDocument();
            expect(screen.getByText("Retirement age can't be earlier than current age")).toBeInTheDocument();
            expect(window.localStorage.getItem(SIM_KEY)).toBeNull();
        });

        it('quick path: fixing the value lets Next through again', async () => {
            const user = userEvent.setup();
            render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

            await user.click(screen.getByRole('button', { name: /Quick start/ }));
            await setFinancialInput(user, fieldFor('Current age'), '60');
            await setFinancialInput(user, fieldFor('Retirement age'), '55');
            await user.click(screen.getByRole('button', { name: 'Next' }));

            await setFinancialInput(user, fieldFor('Retirement age'), '65');
            await user.click(screen.getByRole('button', { name: 'Next' }));

            expect(await screen.findByRole('heading', { name: 'Savings and spending' })).toBeInTheDocument();
        });

        // Regression: gating each step on the whole person's errors trapped the
        // user on "About you" — a current age past the default melt start age
        // (55) tripped a check whose field lives on the meltdown step, which
        // couldn't be reached because Next was blocked.
        it('detailed path: a current age of 70 does not strand the user on "About you"', async () => {
            const user = userEvent.setup();
            render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

            await user.click(screen.getByRole('button', { name: /Full setup/ }));
            await setFinancialInput(user, fieldFor('Current age'), '70');
            await setFinancialInput(user, fieldFor('Retirement age'), '72');

            await user.click(screen.getByRole('button', { name: 'Next' }));
            expect(await screen.findByRole('heading', { name: 'Government benefits' })).toBeInTheDocument();

            // ...and the melt problem still surfaces, on the step that owns it.
            await user.click(screen.getByRole('button', { name: 'Next' })); // pension
            await user.click(screen.getByRole('button', { name: 'Next' })); // accounts
            await user.click(screen.getByRole('button', { name: 'Next' })); // meltdown
            expect(
                await screen.findByRole('heading', { name: 'Early RRSP withdrawals (optional)' })
            ).toBeInTheDocument();
            expect(screen.getByText("RRSP melt can't start before current age")).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Next' }));
            expect(screen.getByText(/Fix the items? above to continue/)).toBeInTheDocument();

            // The field is right here, so the user can actually get unstuck.
            await setFinancialInput(user, fieldFor('RRSP melt start age'), '71');
            await user.click(screen.getByRole('button', { name: 'Next' }));
            expect(await screen.findByRole('heading', { name: 'Household spending' })).toBeInTheDocument();
        });

        it('detailed path: a broken age blocks Next on the step that owns the field', async () => {
            const user = userEvent.setup();
            render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

            await user.click(screen.getByRole('button', { name: /Full setup/ }));
            await setFinancialInput(user, fieldFor('Life expectancy'), '40');

            await user.click(screen.getByRole('button', { name: 'Next' }));

            expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
            expect(screen.getByText(/Fix the items? above to continue/)).toBeInTheDocument();
            expect(window.localStorage.getItem(SIM_KEY)).toBeNull();
        });
    });

    it('detailed path: the workplace pension is collected and reaches the saved plan', async () => {
        const user = userEvent.setup();
        render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Full setup/ }));
        // about-you -> benefits-you -> pension-you
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await user.click(screen.getByRole('button', { name: 'Next' }));
        expect(await screen.findByRole('heading', { name: 'Workplace pension' })).toBeInTheDocument();

        await setFinancialInput(user, fieldFor('Annual pension amount'), '42000');
        await setFinancialInput(user, fieldFor('Pension start age'), '62');

        // accounts-you -> meltdown-you -> spending -> assumptions -> Save
        for (let i = 0; i < 4; i++) {
            await user.click(screen.getByRole('button', { name: 'Next' }));
        }
        await user.click(screen.getByRole('button', { name: 'Save' }));

        const stored = JSON.parse(window.localStorage.getItem(SIM_KEY)!);
        expect(stored.person.pension).toMatchObject({ annualAmount: 42000, startAge: 62 });
    });

    describe('discarding an edited draft', () => {
        it('Escape asks before throwing away entered answers, and Keep editing cancels', async () => {
            const user = userEvent.setup();
            const onDone = vi.fn();
            render(<OnboardingFlow seed={freshSeed()} onDone={onDone} onOpenPrivacy={vi.fn()} />);

            await user.click(screen.getByRole('button', { name: /Quick start/ }));
            await setFinancialInput(user, fieldFor('Current age'), '41');

            await user.keyboard('{Escape}');
            expect(await screen.findByRole('heading', { name: 'Discard your setup?' })).toBeInTheDocument();
            expect(onDone).not.toHaveBeenCalled();

            await user.click(screen.getByRole('button', { name: 'Keep editing' }));
            expect(onDone).not.toHaveBeenCalled();
            expect((fieldFor('Current age') as HTMLInputElement).value).toBe('41');
        });

        it('Discard leaves without writing the plan', async () => {
            const user = userEvent.setup();
            const onDone = vi.fn();
            render(<OnboardingFlow seed={freshSeed()} onDone={onDone} onOpenPrivacy={vi.fn()} />);

            await user.click(screen.getByRole('button', { name: /Quick start/ }));
            await setFinancialInput(user, fieldFor('Current age'), '41');
            await user.keyboard('{Escape}');
            await user.click(await screen.findByRole('button', { name: 'Discard' }));

            expect(onDone).toHaveBeenCalledWith(false);
            expect(window.localStorage.getItem(SIM_KEY)).toBeNull();
            expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe('1');
        });

        it('an untouched wizard still skips instantly — nothing to protect', async () => {
            const user = userEvent.setup();
            const onDone = vi.fn();
            render(<OnboardingFlow seed={freshSeed()} onDone={onDone} onOpenPrivacy={vi.fn()} />);

            await user.click(screen.getByRole('button', { name: /Quick start/ }));
            await user.keyboard('{Escape}');

            expect(screen.queryByRole('heading', { name: 'Discard your setup?' })).not.toBeInTheDocument();
            expect(onDone).toHaveBeenCalledWith(false);
        });
    });

    // Browser Back used to be the one dismiss path that bypassed the discard
    // guard entirely: it left the site and silently threw away everything typed,
    // since nothing commits until Save. It now routes through the same
    // requestSkip that Escape and the Skip control use.
    describe('browser Back', () => {
        beforeEach(async () => {
            // Drain any traversal a previous test left in flight, then park on a
            // fresh, marker-free entry. It has to be a push, not a replace:
            // jsdom keeps forward entries until something pushes over them, so a
            // test that ended rewound would make the length assertions below
            // meaningless.
            await settle();
            window.history.pushState(null, '', '/');
            await settle();
        });

        it('asks before discarding an edited wizard, and keeps it open', async () => {
            const user = userEvent.setup();
            const onDone = vi.fn();
            render(<WizardHost onDone={onDone} />);
            await settle();

            await user.click(screen.getByRole('button', { name: /Quick start/ }));
            await setFinancialInput(user, fieldFor('Current age'), '41');

            await pressBack();

            expect(await screen.findByRole('heading', { name: 'Discard your setup?' })).toBeInTheDocument();
            expect(screen.getByRole('dialog', { name: 'Guided Setup' })).toBeInTheDocument();
            expect(onDone).not.toHaveBeenCalled();
            expect(window.localStorage.getItem(SIM_KEY)).toBeNull();
            expect((fieldFor('Current age') as HTMLInputElement).value).toBe('41');
        });

        // The case most likely to be subtly wrong: popstate has already spent the
        // pushed entry by the time the confirmation appears, so staying open means
        // the hook must borrow another one -- or the NEXT Back leaves the site with
        // the draft still unsaved.
        it('Keep editing leaves the wizard open, and Back still works afterwards', async () => {
            const user = userEvent.setup();
            const onDone = vi.fn();
            const base = window.history.length;
            render(<WizardHost onDone={onDone} />);
            await settle();
            expect(window.history.length).toBe(base + 1);

            await user.click(screen.getByRole('button', { name: /Quick start/ }));
            await setFinancialInput(user, fieldFor('Current age'), '41');

            await pressBack();
            await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
            await settle();

            expect(screen.queryByRole('heading', { name: 'Discard your setup?' })).not.toBeInTheDocument();
            expect((fieldFor('Current age') as HTMLInputElement).value).toBe('41');
            // Re-armed rather than stacked -- one borrowed entry, still exactly one.
            expect(currentOverlay()).toBe('onboarding');
            expect(window.history.length).toBe(base + 1);

            await pressBack();

            expect(await screen.findByRole('heading', { name: 'Discard your setup?' })).toBeInTheDocument();
            expect(onDone).not.toHaveBeenCalled();
            expect(window.localStorage.getItem(SIM_KEY)).toBeNull();
        });

        it('Discard closes the wizard and leaves the history clean', async () => {
            const user = userEvent.setup();
            const onDone = vi.fn();
            const base = window.history.length;
            render(<WizardHost onDone={onDone} />);
            await settle();

            await user.click(screen.getByRole('button', { name: /Quick start/ }));
            await setFinancialInput(user, fieldFor('Current age'), '41');
            await pressBack();
            await user.click(await screen.findByRole('button', { name: 'Discard' }));
            await settle();

            expect(onDone).toHaveBeenCalledWith(false);
            expect(screen.getByTestId('wizard-closed')).toBeInTheDocument();
            expect(window.localStorage.getItem(SIM_KEY)).toBeNull();
            expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe('1');
            // Parked back on the base entry: no stranded entry, so the next Back
            // press leaves the site instead of looking inert.
            expect(currentOverlay()).toBeNull();
            expect(window.history.length).toBeLessThanOrEqual(base + 1);
        });

        it('an untouched wizard closes instantly -- nothing to protect', async () => {
            const user = userEvent.setup();
            const onDone = vi.fn();
            const base = window.history.length;
            render(<WizardHost onDone={onDone} />);
            await settle();

            await user.click(screen.getByRole('button', { name: /Quick start/ }));
            await settle();

            await pressBack();

            expect(screen.queryByRole('heading', { name: 'Discard your setup?' })).not.toBeInTheDocument();
            expect(onDone).toHaveBeenCalledWith(false);
            expect(screen.getByTestId('wizard-closed')).toBeInTheDocument();
            // Back consumed the borrowed entry itself -- nothing left to unwind.
            expect(currentOverlay()).toBeNull();
            expect(window.history.length).toBeLessThanOrEqual(base + 1);
        });
    });

    it('locks body scroll while mounted and restores the previous overflow value on unmount', () => {
        document.body.style.overflow = 'auto';
        const { unmount } = render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);
        expect(document.body.style.overflow).toBe('hidden');
        unmount();
        expect(document.body.style.overflow).toBe('auto');
    });

    it('exposes dialog semantics on the root element', () => {
        render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: 'Guided Setup' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
});
