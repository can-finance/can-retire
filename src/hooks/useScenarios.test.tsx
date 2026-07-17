// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode, act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useScenarios } from './useScenarios';
import { INITIAL_INPUTS } from '../utils/inputSanitizer';
import type { SimulationInputs } from '../engine/types';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'retirement_saved_scenarios';

interface Handle {
    saveScenario: (name: string, inputs: SimulationInputs) => void;
    updateScenario: (id: string, inputs: SimulationInputs, newName?: string) => void;
    deleteScenario: (id: string) => void;
}

// Renders the hook's current scenario list into the DOM (like Probe in
// usePersistentState.test.tsx) and stashes the live mutators onto a ref handle
// so the test can trigger save/update/delete outside of render. Refs must not
// be written during render, so the handle is synced from an effect.
function Probe({ handleRef }: { handleRef: { current: Handle | null } }) {
    const { scenarios, saveScenario, updateScenario, deleteScenario } = useScenarios();
    useEffect(() => {
        handleRef.current = { saveScenario, updateScenario, deleteScenario };
    });
    return <span data-testid="v">{JSON.stringify(scenarios)}</span>;
}

// Render inside <StrictMode> so effects double-invoke exactly like the real app
// (src/main.tsx wraps the tree in StrictMode) -- this is what would defeat any
// "skip the first effect run" persistence scheme.
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

function newHandleRef(): { current: Handle | null } {
    return { current: null };
}

describe('useScenarios', () => {
    let setItemSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        window.localStorage.clear();
        setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    });

    afterEach(() => {
        setItemSpy.mockRestore();
    });

    it('does NOT write to localStorage on a fresh mount with empty storage (even under StrictMode)', () => {
        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);
        expect(window.localStorage.getItem(KEY)).toBeNull();
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(view.text()).toBe('[]');
        view.unmount();
    });

    it('saveScenario persists the new scenario', () => {
        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        act(() => {
            handleRef.current!.saveScenario('My Plan', INITIAL_INPUTS);
        });

        expect(setItemSpy).toHaveBeenCalled();
        const stored = JSON.parse(window.localStorage.getItem(KEY)!);
        expect(stored).toHaveLength(1);
        expect(stored[0].name).toBe('My Plan');
        expect(stored[0].inputs).toEqual(INITIAL_INPUTS);
        expect(view.text()).toContain('My Plan');
        view.unmount();
    });

    it('hydrates existing stored scenarios and does not rewrite them on mount', () => {
        const existing = [
            { id: 'abc', name: 'Existing', inputs: INITIAL_INPUTS, lastSaved: '2026-01-01T00:00:00.000Z' },
        ];
        window.localStorage.setItem(KEY, JSON.stringify(existing));
        setItemSpy.mockClear(); // ignore the setup write above

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        expect(view.text()).toContain('Existing');
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify(existing));
        view.unmount();
    });

    it('deleteScenario persists the removal', () => {
        const existing = [
            { id: 'abc', name: 'Existing', inputs: INITIAL_INPUTS, lastSaved: '2026-01-01T00:00:00.000Z' },
        ];
        window.localStorage.setItem(KEY, JSON.stringify(existing));
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        act(() => {
            handleRef.current!.deleteScenario('abc');
        });

        expect(setItemSpy).toHaveBeenCalled();
        const stored = JSON.parse(window.localStorage.getItem(KEY)!);
        expect(stored).toHaveLength(0);
        expect(view.text()).toBe('[]');
        view.unmount();
    });
});
