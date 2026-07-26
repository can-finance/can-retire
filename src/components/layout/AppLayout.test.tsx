// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { AppLayout } from './AppLayout';
import { ONBOARDING_KEY, SIM_KEY } from '../../utils/onboarding';
import { PLANS_STORAGE_KEY, ACTIVE_PLAN_STORAGE_KEY } from '../../hooks/usePlans';

const ALL_KNOWN_KEYS = [ONBOARDING_KEY, SIM_KEY, PLANS_STORAGE_KEY, ACTIVE_PLAN_STORAGE_KEY];

function seedAllKeys() {
    for (const key of ALL_KNOWN_KEYS) localStorage.setItem(key, '1');
    localStorage.setItem('retirement_some_future_key', '1'); // safety-net sweep target
    localStorage.setItem('unrelated_app_key', 'keep-me'); // must survive
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('AppLayout — Clear all data', () => {
    it('renders the "Clear all data" control in the footer', () => {
        render(<AppLayout activePage="dashboard">content</AppLayout>);
        expect(screen.getByRole('button', { name: 'Clear all data' })).toBeInTheDocument();
    });

    it('clicking it opens the confirmation dialog without clearing anything', async () => {
        const user = userEvent.setup();
        seedAllKeys();
        render(<AppLayout activePage="dashboard">content</AppLayout>);

        await user.click(screen.getByRole('button', { name: 'Clear all data' }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('Clear all data?');
        for (const key of ALL_KNOWN_KEYS) {
            expect(localStorage.getItem(key)).toBe('1');
        }
    });

    it('Cancel closes the dialog and leaves all localStorage keys intact', async () => {
        const user = userEvent.setup();
        seedAllKeys();
        render(<AppLayout activePage="dashboard">content</AppLayout>);

        await user.click(screen.getByRole('button', { name: 'Clear all data' }));
        await screen.findByRole('dialog');
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        for (const key of ALL_KNOWN_KEYS) {
            expect(localStorage.getItem(key)).toBe('1');
        }
        expect(localStorage.getItem('retirement_some_future_key')).toBe('1');
        expect(localStorage.getItem('unrelated_app_key')).toBe('keep-me');
    });

    it('Confirm removes all known keys and retirement_-prefixed extras, leaves unrelated keys, and navigates to /', async () => {
        const user = userEvent.setup();
        seedAllKeys();

        // jsdom does not implement navigation — window.location.assign throws
        // "Not implemented" if called for real. Stub it so we can assert on the
        // call instead.
        const assignSpy = vi.fn();
        Object.defineProperty(window, 'location', {
            value: { ...window.location, assign: assignSpy },
            writable: true,
            configurable: true,
        });

        render(<AppLayout activePage="dashboard">content</AppLayout>);

        await user.click(screen.getByRole('button', { name: 'Clear all data' }));
        await screen.findByRole('dialog');
        await user.click(screen.getByRole('button', { name: 'Clear everything' }));

        for (const key of ALL_KNOWN_KEYS) {
            expect(localStorage.getItem(key)).toBeNull();
        }
        expect(localStorage.getItem('retirement_some_future_key')).toBeNull();
        expect(localStorage.getItem('unrelated_app_key')).toBe('keep-me');

        expect(assignSpy).toHaveBeenCalledWith('/');
    });
});
