// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

        await user.click(screen.getByRole('button', { name: /Start quick/ }));
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

        await user.click(screen.getByRole('button', { name: /Start quick/ }));
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        const stored = JSON.parse(window.localStorage.getItem(SIM_KEY)!);
        expect(stored).toEqual(seed);
    });

    it('detailed path: the spouse stash restores the previous spouse (not the 45 default) after an off/on toggle', async () => {
        const user = userEvent.setup();
        const seed = freshSeed({ spouse: { ...createDefaultPerson(true), age: 58 } });
        render(<OnboardingFlow seed={seed} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Full setup →/ }));
        expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();

        const spouseSwitch = fieldFor('Include a spouse / partner', 'button[role="switch"]');
        expect(spouseSwitch).toHaveAttribute('aria-checked', 'true');

        await user.click(spouseSwitch); // off -- stashes the age-58 spouse
        expect(spouseSwitch).toHaveAttribute('aria-checked', 'false');
        await user.click(spouseSwitch); // on -- restores the stash, not a fresh default
        expect(spouseSwitch).toHaveAttribute('aria-checked', 'true');

        // about-you -> benefits-you -> accounts-you -> meltdown-you -> about-spouse
        for (let i = 0; i < 4; i++) {
            await user.click(screen.getByRole('button', { name: 'Next' }));
        }
        expect(await screen.findByRole('heading', { name: 'About your spouse' })).toBeInTheDocument();

        const spouseAgeInput = fieldFor('Current age') as HTMLInputElement;
        expect(spouseAgeInput.value).toBe('58');
    });

    it('switching from Quick start to Full setup carries a quick-path edit into the draft', async () => {
        const user = userEvent.setup();
        render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Start quick/ }));
        const quickAgeInput = fieldFor('Your current age') as HTMLInputElement;
        await setFinancialInput(user, quickAgeInput, '33');
        expect(quickAgeInput.value).toBe('33');

        await user.click(screen.getByRole('button', { name: 'Back' }));
        await user.click(screen.getByRole('button', { name: /Full setup →/ }));
        expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();

        const detailedAgeInput = fieldFor('Current age') as HTMLInputElement;
        expect(detailedAgeInput.value).toBe('33');
    });

    it('raw validation: retirement age below current age shows the inline warning without clamping the input', async () => {
        const user = userEvent.setup();
        render(<OnboardingFlow seed={freshSeed()} onDone={vi.fn()} onOpenPrivacy={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Start quick/ }));

        const ageInput = fieldFor('Your current age') as HTMLInputElement;
        await setFinancialInput(user, ageInput, '60');

        const retirementInput = fieldFor('Retirement age') as HTMLInputElement;
        await setFinancialInput(user, retirementInput, '55');

        expect(await screen.findByText('Retirement age must be ≥ current age')).toBeInTheDocument();
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
        await user.click(screen.getByRole('button', { name: /Start quick/ }));
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByRole('heading', { name: "You're set." })).toBeInTheDocument();

        await user.keyboard('{Escape}');
        expect(screen.getByRole('heading', { name: "You're set." })).toBeInTheDocument();
        expect(onDoneClosing).not.toHaveBeenCalled();
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
        const dialog = screen.getByRole('dialog', { name: 'Retirement plan setup' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
});
