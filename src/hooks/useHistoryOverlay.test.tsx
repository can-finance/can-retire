// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrictMode, useState, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useHistoryOverlay } from './useHistoryOverlay';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements pushState/go/popstate, but a traversal is a QUEUED task —
// history.back() returns long before the popstate fires, and measurably later
// than a single setTimeout(0) turn. Everything below therefore drains several
// macrotask turns (inside act, so the popstate-driven setState is covered)
// before asserting.
async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) {
            await new Promise(resolve => setTimeout(resolve, 2));
        }
    });
}

/** The marker useHistoryOverlay writes onto entries it owns, or null on the base entry. */
function currentOverlay(): string | null {
    const state = window.history.state as { __overlay?: string } | null;
    return state?.__overlay ?? null;
}

// A miniature Dashboard: two mutually exclusive full-screen views plus a drawer
// that can (structurally, at least) sit on top of either — the same shape as the
// real component, so the LIFO behaviour is exercised the way it would be used.
function Harness({ onClose }: { onClose?: (which: string) => void }) {
    const [compare, setCompare] = useState(false);
    const [drawer, setDrawer] = useState(false);

    useHistoryOverlay(compare, () => { onClose?.('compare'); setCompare(false); }, 'compare');
    useHistoryOverlay(drawer, () => { onClose?.('drawer'); setDrawer(false); }, 'drawer');

    return (
        <div>
            <button data-testid="open-compare" onClick={() => setCompare(true)}>open compare</button>
            <button data-testid="close-compare" onClick={() => setCompare(false)}>close compare</button>
            <button data-testid="open-drawer" onClick={() => setDrawer(true)}>open drawer</button>
            <button data-testid="close-drawer" onClick={() => setDrawer(false)}>close drawer</button>
            <span data-testid="state">{`${compare ? 'C' : '-'}${drawer ? 'D' : '-'}`}</span>
        </div>
    );
}

// Rendered inside <StrictMode> like src/main.tsx does: mount effects
// double-invoke (mount → unmount → mount), which for a naive push-on-open /
// back-on-close implementation would leave a queued history.back() landing after
// the second push. The reconciler is what makes those three runs net out to one
// pushed entry, and this is the suite that would catch a regression.
function render(element: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<StrictMode>{element}</StrictMode>);
    });
    const click = (testId: string) => act(() => {
        container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click();
    });
    return {
        click,
        state: () => container.querySelector('[data-testid="state"]')?.textContent ?? '',
        unmount: () => act(() => root.unmount()),
    };
}

/** Presses the browser's Back button and waits for the resulting popstate to be handled. */
async function pressBack() {
    await act(async () => {
        window.history.back();
    });
    await settle();
}

describe('useHistoryOverlay', () => {
    beforeEach(async () => {
        // A fresh, marker-free entry at the TOP of the session history. It has to
        // be a push, not a replace: jsdom (like a browser) keeps forward entries
        // until something pushes over them, so a test that ended with the pointer
        // rewound would otherwise see history.length shrink under it on the next
        // push and make the length assertions below meaningless.
        window.history.pushState(null, '', '/');
        await settle();
    });

    it('pushes exactly one entry when an overlay opens', async () => {
        const view = render(<Harness />);
        const base = window.history.length;

        view.click('open-compare');
        await settle();

        expect(view.state()).toBe('C-');
        expect(currentOverlay()).toBe('compare');
        // Exactly one — StrictMode's mount/unmount/mount must not push twice,
        // nor push-then-unwind-then-push.
        expect(window.history.length).toBe(base + 1);

        view.unmount();
        await settle();
    });

    it('Back closes the overlay and lands back on the base entry', async () => {
        const view = render(<Harness />);
        view.click('open-compare');
        await settle();

        await pressBack();

        expect(view.state()).toBe('--');
        expect(currentOverlay()).toBeNull();

        view.unmount();
        await settle();
    });

    it('closing in-app consumes the pushed entry instead of stacking dead ones', async () => {
        const view = render(<Harness />);
        const base = window.history.length;

        // Three open/close cycles through the in-app control. Each close has to
        // hand its entry back, or the history grows and the user's first Back
        // press after this would appear to do nothing.
        for (let i = 0; i < 3; i++) {
            view.click('open-compare');
            await settle();
            view.click('close-compare');
            await settle();
            expect(view.state()).toBe('--');
            // Back on the BASE entry — not parked on a leftover overlay entry.
            expect(currentOverlay()).toBeNull();
        }

        // pushState truncates forward entries, so a correctly unwound cycle
        // never grows the session history beyond the single borrowed slot.
        expect(window.history.length).toBeLessThanOrEqual(base + 1);

        view.unmount();
        await settle();
    });

    it('does not loop: an in-app close followed by Back neither re-opens nor double-closes', async () => {
        const onClose = vi.fn();
        const view = render(<Harness onClose={onClose} />);

        view.click('open-compare');
        await settle();
        view.click('close-compare');
        await settle();

        // The programmatic traversal must be swallowed: it is not a user Back.
        expect(onClose).not.toHaveBeenCalled();
        expect(view.state()).toBe('--');

        // And the Back that follows is a plain navigation off the base entry —
        // it must not resurrect or re-close anything.
        await pressBack();
        expect(onClose).not.toHaveBeenCalled();
        expect(view.state()).toBe('--');

        view.unmount();
        await settle();
    });

    it('a refused close re-borrows an entry, so the next Back is still caught', async () => {
        // Mirrors the onboarding wizard: `close` is a REQUEST, and the first
        // Back is answered with a confirmation rather than an actual close.
        // Back has spent the entry regardless, so without re-arming, the press
        // after this one would leave the site with the draft unsaved.
        function Guarded() {
            const [open, setOpen] = useState(true);
            const [confirming, setConfirming] = useState(false);
            useHistoryOverlay(open, () => {
                // Note this deliberately re-sets an already-true `confirming`
                // on the third call below: React bails out of that render, so
                // the re-arm cannot lean on the close callback re-rendering.
                if (!confirming) { setConfirming(true); return; }
                setOpen(false);
            }, 'guarded');
            return <span data-testid="state">{`${open ? 'O' : '-'}${confirming ? 'C' : '-'}`}</span>;
        }

        const base = window.history.length;
        const view = render(<Guarded />);
        await settle();
        expect(window.history.length).toBe(base + 1);

        // Refused: the overlay is still up, and a replacement entry is in hand.
        await pressBack();
        expect(view.state()).toBe('OC');
        expect(currentOverlay()).toBe('guarded');
        // Re-armed, not stacked — the spent entry was replaced, not doubled.
        expect(window.history.length).toBe(base + 1);

        // Accepted: this one really closes, and lands on the base entry.
        await pressBack();
        expect(view.state()).toBe('-C');
        expect(currentOverlay()).toBeNull();

        view.unmount();
        await settle();
        expect(window.history.length).toBeLessThanOrEqual(base + 1);
    });

    it('nested overlays are LIFO — Back closes the topmost only', async () => {
        const view = render(<Harness />);
        const base = window.history.length;

        view.click('open-compare');
        await settle();
        view.click('open-drawer');
        await settle();
        expect(view.state()).toBe('CD');
        expect(window.history.length).toBe(base + 2);
        expect(currentOverlay()).toBe('drawer');

        await pressBack();
        // Drawer only.
        expect(view.state()).toBe('C-');
        expect(currentOverlay()).toBe('compare');

        await pressBack();
        expect(view.state()).toBe('--');
        expect(currentOverlay()).toBeNull();

        view.unmount();
        await settle();
    });

    it('closing the top overlay in-app leaves the one underneath open and still backable', async () => {
        const view = render(<Harness />);

        view.click('open-compare');
        await settle();
        view.click('open-drawer');
        await settle();

        view.click('close-drawer');
        await settle();
        // The programmatic unwind must not cascade into the compare view.
        expect(view.state()).toBe('C-');
        expect(currentOverlay()).toBe('compare');

        await pressBack();
        expect(view.state()).toBe('--');
        expect(currentOverlay()).toBeNull();

        view.unmount();
        await settle();
    });

    it('unmounting while open gives the borrowed entry back', async () => {
        const view = render(<Harness />);
        const base = window.history.length;

        view.click('open-compare');
        await settle();
        expect(currentOverlay()).toBe('compare');

        view.unmount();
        await settle();

        expect(currentOverlay()).toBeNull();
        expect(window.history.length).toBeLessThanOrEqual(base + 1);
    });

    it('an overlay that is already open at mount still gets its own entry', async () => {
        // Mirrors Dashboard's `?optimize=1` deep link: isOptimizing is seeded true
        // by the useState initializer, so the overlay is up on the very first
        // paint and there is no click to hang the push off.
        function OpenAtMount({ onClose }: { onClose: () => void }) {
            const [open, setOpen] = useState(true);
            useHistoryOverlay(open, () => { onClose(); setOpen(false); }, 'optimizer');
            return <span data-testid="state">{open ? 'O' : '-'}</span>;
        }
        const onClose = vi.fn();
        const base = window.history.length;
        const view = render(<OpenAtMount onClose={onClose} />);
        await settle();

        expect(currentOverlay()).toBe('optimizer');
        expect(window.history.length).toBe(base + 1);

        await pressBack();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(view.state()).toBe('-');
        expect(currentOverlay()).toBeNull();

        view.unmount();
        await settle();
    });

    it('the pushed entry does not disturb the URL (path, search or hash)', async () => {
        window.history.replaceState(null, '', '/?keep=1#anchor');
        await settle();
        const view = render(<Harness />);

        view.click('open-compare');
        await settle();
        expect(window.location.search).toBe('?keep=1');
        expect(window.location.hash).toBe('#anchor');

        await pressBack();
        expect(window.location.search).toBe('?keep=1');
        expect(window.location.hash).toBe('#anchor');

        view.unmount();
        await settle();
    });
});
