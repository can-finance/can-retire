// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode, useEffect, useRef, act } from 'react';
import { createRoot } from 'react-dom/client';
import { usePersistentState } from './usePersistentState';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'test_persist_key';

// Renders the hook's current value into the DOM so a test can read it back
// without mutating anything outside the component (keeps react-hooks lint happy).
function Probe({ initial }: { initial: unknown }) {
    const [state] = usePersistentState(KEY, initial);
    return <span data-testid="v">{JSON.stringify(state)}</span>;
}

// Like Probe, but performs exactly one state change on mount (via an effect) so
// we can observe that a change — unlike the initial value — is persisted.
function ProbeThatChanges({ initial, next }: { initial: unknown; next: unknown }) {
    const [state, setState] = usePersistentState(KEY, initial);
    const done = useRef(false);
    useEffect(() => {
        if (!done.current) {
            done.current = true;
            setState(next);
        }
    }, [setState, next]);
    return <span data-testid="v">{JSON.stringify(state)}</span>;
}

// Render inside <StrictMode> so effects double-invoke exactly like the real app
// (src/main.tsx wraps the tree in StrictMode). This is what defeats any
// "skip the first effect run" persistence scheme and is the regression this
// suite must catch.
function render(element: React.ReactElement) {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
        root.render(<StrictMode>{element}</StrictMode>);
    });
    return {
        text: () => container.querySelector('[data-testid="v"]')?.textContent ?? '',
        unmount: () => act(() => root.unmount()),
    };
}

describe('usePersistentState', () => {
    let setItemSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        window.localStorage.clear();
        setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    });

    afterEach(() => {
        setItemSpy.mockRestore();
    });

    it('does NOT write the initial value to localStorage on mount (even under StrictMode double-invocation)', () => {
        const view = render(<Probe initial={{ count: 0 }} />);
        expect(window.localStorage.getItem(KEY)).toBeNull();
        // Direct guard: the mount path must perform zero writes. This holds even
        // when StrictMode double-invokes the persist effect, because the consumer
        // never called the setter.
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(view.text()).toBe(JSON.stringify({ count: 0 }));
        view.unmount();
    });

    it('DOES write to localStorage when the value changes', () => {
        const view = render(<ProbeThatChanges initial={{ count: 0 }} next={{ count: 5 }} />);
        expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify({ count: 5 }));
        expect(setItemSpy).toHaveBeenCalledWith(KEY, JSON.stringify({ count: 5 }));
        expect(view.text()).toBe(JSON.stringify({ count: 5 }));
        view.unmount();
    });

    it('hydrates an existing persisted value and does not rewrite it on mount', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ count: 42 }));
        setItemSpy.mockClear(); // ignore the setup write above
        const view = render(<Probe initial={{ count: 0 }} />);
        expect(view.text()).toBe(JSON.stringify({ count: 42 }));
        expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify({ count: 42 }));
        // Mount must not rewrite the hydrated value.
        expect(setItemSpy).not.toHaveBeenCalled();
        view.unmount();
    });
});
