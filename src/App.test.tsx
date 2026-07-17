// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode, useEffect } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ONBOARDING_KEY, SIM_KEY } from './utils/onboarding';
import { INITIAL_INPUTS } from './utils/inputSanitizer';
import { EDIT_PLAN_LABEL } from './components/layout/AppLayout';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- mocks -----------------------------------------------------------------
// Dashboard, CppCalculator, and HowItWorks are heavy (recharts, simulation
// engine, etc.) and irrelevant to the activation state machine under test
// here. `mountState` is created via vi.hoisted so both the (hoisted) vi.mock
// factory and the test bodies below can share the same counter object.
const { mountState } = vi.hoisted(() => ({ mountState: { count: 0 } }));

vi.mock('./components/dashboard/Dashboard', () => ({
    Dashboard: () => {
        useEffect(() => {
            mountState.count += 1;
        }, []);
        return <div data-testid="dashboard-mock">Dashboard Mock</div>;
    },
}));

vi.mock('./components/pages/CppCalculator', () => ({
    CppCalculator: () => <div data-testid="cpp-calculator-mock">CPP Calculator Mock</div>,
}));

vi.mock('./components/pages/HowItWorks', () => ({
    HowItWorks: () => <div data-testid="how-it-works-mock">How It Works Mock</div>,
}));

// Imported AFTER the mocks above are registered (vi.mock calls are hoisted to
// the top of the module by Vitest's transform, so this ordering in source
// doesn't strictly matter, but keeping it below the mocks documents intent).
import App from './App';

function renderApp() {
    // Mirrors src/main.tsx, which wraps the tree in StrictMode -- effects
    // double-invoke exactly like production, so any "skip the first mount"
    // scheme would be caught the same way it is in the other hook suites.
    return render(
        <StrictMode>
            <App />
        </StrictMode>
    );
}

function setHash(hash: string) {
    window.location.hash = hash;
}

/** Mutate the hash and fire the event App's hashchange listener expects -- jsdom does not always dispatch this automatically on assignment. */
function navigateHash(hash: string) {
    act(() => {
        window.location.hash = hash;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
}

describe('App activation state machine', () => {
    beforeEach(() => {
        window.localStorage.clear();
        setHash('');
        mountState.count = 0;
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('fresh visitor: onboarding dialog is visible and Dashboard is mounted inert behind it', async () => {
        renderApp();

        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        const dashboard = screen.getByTestId('dashboard-mock');
        expect(dashboard).toBeInTheDocument();

        const inertWrapper = dashboard.closest('[inert]');
        expect(inertWrapper).not.toBeNull();
    });

    it('fresh + #cpp-calculator at load: no dialog until navigating to the dashboard', async () => {
        setHash('#cpp-calculator');
        renderApp();

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('cpp-calculator-mock')).toBeInTheDocument();

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Dashboard' }));

        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('#start= at load: the dialog never shows', async () => {
        setHash('#start=xyz');
        renderApp();

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('existing saved data: no dialog', async () => {
        window.localStorage.setItem(SIM_KEY, JSON.stringify(INITIAL_INPUTS));
        renderApp();

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('F2: data written (e.g. CPP Apply) while parked on #cpp-calculator cancels the pending auto takeover', async () => {
        setHash('#cpp-calculator');
        renderApp();
        expect(screen.queryByRole('dialog')).toBeNull();

        // Simulate the CPP Calculator's "Apply to plan" writing the sim key
        // before the user ever navigates to the dashboard.
        window.localStorage.setItem(SIM_KEY, JSON.stringify(INITIAL_INPUTS));

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Dashboard' }));

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('latch: once shown, the dialog survives an unrelated hashchange', async () => {
        renderApp();
        expect(await screen.findByRole('dialog')).toBeInTheDocument();

        navigateHash('#how-it-works');

        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('#start= arriving mid-wizard closes the dialog, marks onboarding done, and remounts Dashboard', async () => {
        renderApp();
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        const before = mountState.count;

        navigateHash('#start=xyz');

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe('1');
        expect(mountState.count).toBeGreaterThan(before);
    });

    it('epoch: a committed Save remounts Dashboard', async () => {
        const user = userEvent.setup();
        renderApp();
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        const before = mountState.count;

        await user.click(screen.getByRole('button', { name: /Start quick/ }));
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));
        await user.click(screen.getByRole('button', { name: 'Go to my dashboard' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mountState.count).toBeGreaterThan(before);
    });

    it('epoch: Skip from the intro leaves Dashboard unmounted (no re-simulation)', async () => {
        const user = userEvent.setup();
        renderApp();
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        const before = mountState.count;

        await user.click(
            screen.getByRole('button', { name: 'Skip — explore with sample numbers instead' })
        );

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mountState.count).toBe(before);
    });

    it('history guard: clicking Edit My Plan while already on the dashboard does not push a duplicate history entry', async () => {
        window.localStorage.setItem(SIM_KEY, JSON.stringify(INITIAL_INPUTS));
        window.localStorage.setItem(ONBOARDING_KEY, '1');
        const user = userEvent.setup();
        renderApp();
        expect(screen.queryByRole('dialog')).toBeNull();

        const pushStateSpy = vi.spyOn(window.history, 'pushState');
        await user.click(screen.getByRole('button', { name: EDIT_PLAN_LABEL }));

        expect(pushStateSpy).not.toHaveBeenCalled();
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
});
