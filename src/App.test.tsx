// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode, useEffect } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ONBOARDING_KEY, SIM_KEY } from './utils/onboarding';
import { INITIAL_INPUTS } from './utils/inputSanitizer';
import { EDIT_PLAN_LABEL } from './components/layout/AppLayout';
import { redirectTargetForHash } from './utils/bootRedirect';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- mocks -----------------------------------------------------------------
// The SPA is dashboard-only now, so Dashboard is the only heavy child to mock
// out (recharts, simulation engine, etc. — irrelevant to the activation state
// machine under test here). `mountState` is created via vi.hoisted so both the
// (hoisted) vi.mock factory and the test bodies below can share the same
// counter object.
const { mountState } = vi.hoisted(() => ({ mountState: { count: 0 } }));

vi.mock('./components/dashboard/Dashboard', () => ({
    Dashboard: () => {
        useEffect(() => {
            mountState.count += 1;
        }, []);
        return <div data-testid="dashboard-mock">Dashboard Mock</div>;
    },
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

/**
 * The overlay borrows a history entry (useHistoryOverlay), and both the push
 * and the matching unwind are deferred -- the push to a microtask, the unwind
 * to a queued traversal that outlives a single setTimeout(0) turn. Drain
 * several macrotask turns, inside act, before asserting on history.
 */
async function settle(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 8; i++) {
            await new Promise((resolve) => setTimeout(resolve, 2));
        }
    });
}

describe('App activation state machine', () => {
    beforeEach(() => {
        window.localStorage.clear();
        // Reset the full URL (not just the hash) so a `?setup=1` set by one test
        // can't leak into the next — App strips it on mount, but resetting here
        // keeps each test's starting URL independent of run order regardless.
        // replaceState alone, deliberately: `location.hash = ''` is a real
        // same-document NAVIGATION in jsdom, and jsdom queues a popstate for it
        // (browsers fire only hashchange). That stray popstate would land after
        // the overlay had borrowed its history entry and read as a Back press,
        // closing the wizard mid-test. replaceState clears the hash without
        // navigating anywhere.
        window.history.replaceState(null, '', '/');
        mountState.count = 0;
    });

    afterEach(async () => {
        cleanup();
        // Unmounting the overlay hands its borrowed history entry back, and that
        // traversal is a queued task -- drain it here so it can't land in the
        // middle of the next test.
        await settle();
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

    it('latch: once shown, the dialog survives an unrelated hashchange', async () => {
        renderApp();
        expect(await screen.findByRole('dialog')).toBeInTheDocument();

        navigateHash('#foo');

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

        await user.click(screen.getByRole('button', { name: /Quick start/ }));
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

    it('?setup=1 at load with existing saved data: overlay opens and the param is stripped', async () => {
        window.localStorage.setItem(SIM_KEY, JSON.stringify(INITIAL_INPUTS));
        window.history.replaceState(null, '', '/?setup=1');

        renderApp();

        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        expect(window.location.search).not.toContain('setup');
    });

    it('?setup=1 combined with a #start= hash: the overlay does not open', async () => {
        window.history.replaceState(null, '', '/?setup=1#start=xyz');

        renderApp();

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('history: opening Guided Setup borrows exactly one same-URL entry', async () => {
        window.localStorage.setItem(SIM_KEY, JSON.stringify(INITIAL_INPUTS));
        window.localStorage.setItem(ONBOARDING_KEY, '1');
        const user = userEvent.setup();
        renderApp();
        expect(screen.queryByRole('dialog')).toBeNull();

        // Onboarding is still a pure in-place overlay — it does not navigate.
        // It does borrow one history entry so Back can close it (rather than
        // leaving the site and dropping the draft), and that entry must carry
        // no URL of its own: pushState is called WITHOUT a url argument, so the
        // path, search and hash the user is on survive verbatim.
        const before = window.location.href;
        const pushStateSpy = vi.spyOn(window.history, 'pushState');
        await user.click(screen.getByRole('button', { name: EDIT_PLAN_LABEL }));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        await settle();

        // Exactly one, despite StrictMode double-invoking the mount effect.
        expect(pushStateSpy).toHaveBeenCalledTimes(1);
        expect(pushStateSpy.mock.calls[0][2]).toBeUndefined();
        expect(window.location.href).toBe(before);
    });

    // The #start= handler closes the wizard through its own path
    // (markOnboardingDone + closeOnboarding(true)), bypassing requestSkip. It
    // must still give the borrowed entry back, or the user would be left with a
    // dead entry that swallows a Back press.
    it('#start= mid-wizard still hands the overlay\'s borrowed history entry back', async () => {
        renderApp();
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        await settle();

        const goSpy = vi.spyOn(window.history, 'go');
        navigateHash('#start=xyz');
        await settle();

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(goSpy).toHaveBeenCalledWith(-1);
    });
});

describe('redirectTargetForHash (legacy hash → MPA path)', () => {
    it('redirects the CPP Calculator hashes to /cpp-calculator/', () => {
        expect(redirectTargetForHash('#cpp-calculator')).toBe('/cpp-calculator/');
        expect(redirectTargetForHash('#cpp')).toBe('/cpp-calculator/');
        expect(redirectTargetForHash('#/cpp-calculator')).toBe('/cpp-calculator/');
    });

    it('redirects the How-It-Works hash to /how-it-works/', () => {
        expect(redirectTargetForHash('#how-it-works')).toBe('/how-it-works/');
        expect(redirectTargetForHash('#/how-it-works')).toBe('/how-it-works/');
    });

    it('leaves the dashboard, share links, and unknown hashes untouched', () => {
        expect(redirectTargetForHash('')).toBeNull();
        expect(redirectTargetForHash('#start=abc')).toBeNull();
        expect(redirectTargetForHash('#foo')).toBeNull();
    });
});
