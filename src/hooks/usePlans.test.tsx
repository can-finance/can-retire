// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode, act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { usePlans, uniquePlanName, PLANS_STORAGE_KEY, ACTIVE_PLAN_STORAGE_KEY, type SavedPlan } from './usePlans';
import { INITIAL_INPUTS, sanitizeSimulationInputs } from '../utils/inputSanitizer';
import { SIM_KEY } from '../utils/onboarding';
import type { SimulationInputs } from '../engine/types';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLANS_KEY = PLANS_STORAGE_KEY;
const ACTIVE_KEY = ACTIVE_PLAN_STORAGE_KEY;

// Canonical sanitized form of the defaults, plus a genuinely different variant.
// Storing SANITIZED as both SIM_KEY and an entry's inputs guarantees inputsEqual
// (both serialize identically); DIFFERENT sanitizes to a different province.
const SANITIZED = sanitizeSimulationInputs(INITIAL_INPUTS)!;
const DIFFERENT: SimulationInputs = { ...SANITIZED, province: 'BC' };

type PlansApi = ReturnType<typeof usePlans>;

// Renders the hook's current store into the DOM and stashes the live api onto a
// ref handle so tests can call mutators (and read state) outside of render. Refs
// must not be written during render, so the handle is synced from an effect.
function Probe({ handleRef }: { handleRef: { current: PlansApi | null } }) {
    const api = usePlans();
    useEffect(() => {
        handleRef.current = api;
    });
    return <span data-testid="v">{JSON.stringify({ plans: api.plans, activePlanId: api.activePlanId })}</span>;
}

// Render inside <StrictMode> so effects double-invoke exactly like the real app
// (src/main.tsx wraps the tree in StrictMode) -- this is what would defeat any
// "skip the first effect run" persistence or reconciliation scheme.
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

function newHandleRef(): { current: PlansApi | null } {
    return { current: null };
}

function plan(id: string, name: string, lastSaved: string, inputs: SimulationInputs = SANITIZED): SavedPlan {
    return { id, name, inputs, lastSaved };
}

describe('uniquePlanName', () => {
    it('returns the base name unchanged when it is not already taken', () => {
        expect(uniquePlanName('Suggested plan', ['Alpha', 'Beta'])).toBe('Suggested plan');
    });

    it('appends " 2" when the base name is taken', () => {
        expect(uniquePlanName('Suggested plan', ['Suggested plan'])).toBe('Suggested plan 2');
    });

    it('finds the first free numeric suffix, skipping already-taken ones', () => {
        expect(
            uniquePlanName('Suggested plan', ['Suggested plan', 'Suggested plan 2', 'Suggested plan 3'])
        ).toBe('Suggested plan 4');
    });
});

describe('usePlans', () => {
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

        expect(setItemSpy).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(PLANS_KEY)).toBeNull();
        expect(window.localStorage.getItem(ACTIVE_KEY)).toBeNull();
        expect(handleRef.current!.plans).toEqual([]);
        expect(handleRef.current!.activePlanId).toBeNull();
        view.unmount();
    });

    it('createPlan persists the plan AND the active key, activating the returned plan', () => {
        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        let created: SavedPlan | null = null;
        act(() => {
            created = handleRef.current!.createPlan('My Plan', INITIAL_INPUTS);
        });

        const storedPlans = JSON.parse(window.localStorage.getItem(PLANS_KEY)!);
        expect(storedPlans).toHaveLength(1);
        expect(storedPlans[0].name).toBe('My Plan');
        expect(window.localStorage.getItem(ACTIVE_KEY)).toBe(created!.id);
        expect(handleRef.current!.activePlanId).toBe(created!.id);
        expect(handleRef.current!.activePlan!.id).toBe(created!.id);
        view.unmount();
    });

    it('hydrates existing stored plans without any reconciliation writes when SIM_KEY is absent (row 1)', () => {
        const existing = [plan('a', 'Alpha', '2026-01-01T00:00:00.000Z')];
        window.localStorage.setItem(PLANS_KEY, JSON.stringify(existing));
        setItemSpy.mockClear(); // ignore the setup write above

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        expect(setItemSpy).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(PLANS_KEY)).toBe(JSON.stringify(existing));
        expect(window.localStorage.getItem(ACTIVE_KEY)).toBeNull();
        expect(handleRef.current!.plans).toHaveLength(1);
        view.unmount();
    });

    it('deletePlan persists the removal (two seeded plans, past the last-delete guard)', () => {
        const a = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z');
        const b = plan('b', 'Beta', '2026-02-01T00:00:00.000Z');
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([a, b]));
        window.localStorage.setItem(ACTIVE_KEY, 'a');
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        act(() => {
            handleRef.current!.deletePlan('b');
        });

        const stored = JSON.parse(window.localStorage.getItem(PLANS_KEY)!);
        expect(stored.map((p: SavedPlan) => p.id)).toEqual(['a']);
        view.unmount();
    });

    it('row 2: adopts a matching entry (plans entry untouched, active key written)', () => {
        const entry = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([entry]));
        window.localStorage.setItem(SIM_KEY, JSON.stringify(SANITIZED));
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        // The plan entry is not rewritten (no lastSaved churn) — value is byte-identical.
        expect(window.localStorage.getItem(PLANS_KEY)).toBe(JSON.stringify([entry]));
        expect(window.localStorage.getItem(ACTIVE_KEY)).toBe('a');
        expect(handleRef.current!.activePlanId).toBe('a');
        view.unmount();
    });

    it('row 2 tie-break: adopts the most-recently-saved of multiple matching entries', () => {
        const older = plan('old', 'Older', '2026-01-01T00:00:00.000Z', SANITIZED);
        const newer = plan('new', 'Newer', '2026-06-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([older, newer]));
        window.localStorage.setItem(SIM_KEY, JSON.stringify(SANITIZED));
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        expect(window.localStorage.getItem(ACTIVE_KEY)).toBe('new');
        expect(handleRef.current!.activePlanId).toBe('new');
        view.unmount();
    });

    it('row 3: materializes a "My Plan" from SIM_KEY and activates it when nothing matches', () => {
        const entry = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', DIFFERENT);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([entry]));
        window.localStorage.setItem(SIM_KEY, JSON.stringify(SANITIZED));
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        const stored = JSON.parse(window.localStorage.getItem(PLANS_KEY)!);
        expect(stored).toHaveLength(2);
        const created = stored.find((p: SavedPlan) => p.name === 'My Plan');
        expect(created).toBeDefined();
        expect(JSON.stringify(created.inputs)).toBe(JSON.stringify(SANITIZED));
        expect(window.localStorage.getItem(ACTIVE_KEY)).toBe(created.id);
        expect(handleRef.current!.activePlanId).toBe(created.id);
        view.unmount();
    });

    it('reconciles a dangling active id by adopting the matching entry (no duplicate created)', () => {
        const entry = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([entry]));
        window.localStorage.setItem(ACTIVE_KEY, 'ghost'); // not present in the list
        window.localStorage.setItem(SIM_KEY, JSON.stringify(SANITIZED));
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        expect(handleRef.current!.plans).toHaveLength(1); // no duplicate
        expect(window.localStorage.getItem(ACTIVE_KEY)).toBe('a');
        expect(handleRef.current!.activePlanId).toBe('a');
        view.unmount();
    });

    it('row 5: SIM_KEY wins — overwrites the active entry inputs, bumps lastSaved, keeps the name', () => {
        const entry = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([entry]));
        window.localStorage.setItem(ACTIVE_KEY, 'a');
        window.localStorage.setItem(SIM_KEY, JSON.stringify(DIFFERENT));
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        const stored = JSON.parse(window.localStorage.getItem(PLANS_KEY)!);
        expect(stored).toHaveLength(1);
        expect(stored[0].name).toBe('Alpha'); // name preserved
        expect(stored[0].lastSaved).not.toBe('2026-01-01T00:00:00.000Z'); // bumped
        expect(JSON.stringify(stored[0].inputs)).toBe(JSON.stringify(sanitizeSimulationInputs(DIFFERENT)));
        expect(handleRef.current!.activePlanId).toBe('a');
        view.unmount();
    });

    it('row 4: valid active id already equal to SIM_KEY writes nothing on mount', () => {
        const entry = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([entry]));
        window.localStorage.setItem(ACTIVE_KEY, 'a');
        window.localStorage.setItem(SIM_KEY, JSON.stringify(SANITIZED));
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        expect(setItemSpy).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(PLANS_KEY)).toBe(JSON.stringify([entry]));
        expect(handleRef.current!.activePlanId).toBe('a');
        view.unmount();
    });

    it('syncActiveInputs in virtual mode materializes a "My Plan" and activates it', () => {
        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        act(() => {
            handleRef.current!.syncActiveInputs(INITIAL_INPUTS);
        });

        const stored = JSON.parse(window.localStorage.getItem(PLANS_KEY)!);
        expect(stored).toHaveLength(1);
        expect(stored[0].name).toBe('My Plan');
        expect(window.localStorage.getItem(ACTIVE_KEY)).toBe(stored[0].id);
        expect(handleRef.current!.activePlanId).toBe(stored[0].id);
        view.unmount();
    });

    it('syncActiveInputs with an active plan updates its inputs and lastSaved, leaving others untouched', () => {
        const a = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', SANITIZED);
        const b = plan('b', 'Beta', '2026-02-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([a, b]));
        window.localStorage.setItem(ACTIVE_KEY, 'a'); // no SIM_KEY -> reconciliation row 1 (no-op)
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        act(() => {
            handleRef.current!.syncActiveInputs(DIFFERENT);
        });

        const stored = JSON.parse(window.localStorage.getItem(PLANS_KEY)!);
        const sa = stored.find((p: SavedPlan) => p.id === 'a');
        const sb = stored.find((p: SavedPlan) => p.id === 'b');
        expect(JSON.stringify(sa.inputs)).toBe(JSON.stringify(DIFFERENT));
        expect(sa.lastSaved).not.toBe('2026-01-01T00:00:00.000Z'); // bumped
        expect(sb).toEqual(b); // untouched
        view.unmount();
    });

    it('deletePlan on the active plan (3 plans) activates and returns the most-recently-saved survivor', () => {
        const a = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', SANITIZED);
        const b = plan('b', 'Beta', '2026-03-01T00:00:00.000Z', SANITIZED);
        const c = plan('c', 'Gamma', '2026-02-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([a, b, c]));
        window.localStorage.setItem(ACTIVE_KEY, 'a');
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        let returned: SavedPlan | null = null;
        act(() => {
            returned = handleRef.current!.deletePlan('a');
        });

        expect(returned!.id).toBe('b'); // latest lastSaved among survivors
        expect(window.localStorage.getItem(ACTIVE_KEY)).toBe('b');
        expect(handleRef.current!.activePlanId).toBe('b');
        const stored = JSON.parse(window.localStorage.getItem(PLANS_KEY)!);
        expect(stored.map((p: SavedPlan) => p.id)).toEqual(['b', 'c']);
        view.unmount();
    });

    it('deletePlan at length 1 is a no-op returning null with no write', () => {
        const a = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([a]));
        window.localStorage.setItem(ACTIVE_KEY, 'a');
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        let returned: SavedPlan | null = a;
        act(() => {
            returned = handleRef.current!.deletePlan('a');
        });

        expect(returned).toBeNull();
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(handleRef.current!.plans).toHaveLength(1);
        view.unmount();
    });

    it('duplicatePlan creates an "X (copy)", activates it, and returns it', () => {
        const a = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([a]));
        window.localStorage.setItem(ACTIVE_KEY, 'a');
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        let dup: SavedPlan | null = null;
        act(() => {
            dup = handleRef.current!.duplicatePlan('a');
        });

        expect(dup!.name).toBe('Alpha (copy)');
        expect(dup!.id).not.toBe('a');
        const stored = JSON.parse(window.localStorage.getItem(PLANS_KEY)!);
        expect(stored).toHaveLength(2);
        expect(window.localStorage.getItem(ACTIVE_KEY)).toBe(dup!.id);
        expect(handleRef.current!.activePlanId).toBe(dup!.id);
        view.unmount();
    });

    it('renamePlan trims, ignores empty/whitespace, and does not bump lastSaved', () => {
        const a = plan('a', 'Alpha', '2026-01-01T00:00:00.000Z', SANITIZED);
        window.localStorage.setItem(PLANS_KEY, JSON.stringify([a]));
        window.localStorage.setItem(ACTIVE_KEY, 'a');
        setItemSpy.mockClear();

        const handleRef = newHandleRef();
        const view = render(<Probe handleRef={handleRef} />);

        // whitespace-only rename is ignored (no state change)
        act(() => {
            handleRef.current!.renamePlan('a', '   ');
        });
        expect(handleRef.current!.plans[0].name).toBe('Alpha');

        // real rename trims and persists, lastSaved unchanged
        act(() => {
            handleRef.current!.renamePlan('a', '  Renamed  ');
        });
        const stored = JSON.parse(window.localStorage.getItem(PLANS_KEY)!);
        expect(stored[0].name).toBe('Renamed');
        expect(stored[0].lastSaved).toBe('2026-01-01T00:00:00.000Z');
        view.unmount();
    });
});
