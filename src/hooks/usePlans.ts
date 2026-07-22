import { useState, useEffect, useRef } from 'react';
import type { SimulationInputs } from '../engine/types';
import { readStoredSimInputs } from '../utils/onboarding';
import { sanitizeSimulationInputs } from '../utils/inputSanitizer';

export interface SavedPlan {
    id: string;
    name: string;
    inputs: SimulationInputs;
    lastSaved: string;
}

// Legacy literal — existing user data lives under this key; renaming would orphan
// every user's saved plans. Do NOT change the string.
export const PLANS_STORAGE_KEY = 'retirement_saved_scenarios';
export const ACTIVE_PLAN_STORAGE_KEY = 'retirement_active_plan_v1'; // raw string id, not JSON
export const DEFAULT_PLAN_NAME = 'My Plan';

// A single atomic store so delete-and-activate (and reconciliation's
// adopt/create) mutate the plan list and the active selection together.
interface PlanStore {
    plans: SavedPlan[];
    activeId: string | null; // null = virtual "My Plan", nothing persisted yet
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// Smallest available name starting from `base`: the base itself if unused,
// else `base 2`, `base 3`, … (first free suffix). Case-sensitive exact match.
export function uniquePlanName(base: string, existingNames: string[]): string {
    const taken = new Set(existingNames);
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
}

// Value-equality of two input trees via their SANITIZED serialization. The
// sanitizer builds its object graph in a fixed key order (see onboarding.ts:63-66),
// so JSON.stringify is a stable canonical form and string equality is a true
// deep comparison — no key-order flakiness.
function inputsEqual(a: SimulationInputs, b: SimulationInputs): boolean {
    return JSON.stringify(sanitizeSimulationInputs(a)) === JSON.stringify(sanitizeSimulationInputs(b));
}

export function usePlans() {
    const [store, setStore] = useState<PlanStore>(() => {
        // Guard against corrupted or wrong-shaped localStorage — a broken list
        // should degrade to empty, not crash the app on mount (mirrors useScenarios).
        let plans: SavedPlan[] = [];
        try {
            const saved = localStorage.getItem(PLANS_STORAGE_KEY);
            const parsed = saved ? JSON.parse(saved) : [];
            if (Array.isArray(parsed)) {
                plans = parsed.filter((s): s is SavedPlan =>
                    !!s && typeof s === 'object' &&
                    typeof s.id === 'string' && typeof s.name === 'string' &&
                    !!s.inputs && typeof s.inputs === 'object'
                );
            }
        } catch (error) {
            console.error('Failed to load saved plans', error);
        }
        let activeId: string | null = null;
        try {
            const raw = localStorage.getItem(ACTIVE_PLAN_STORAGE_KEY); // RAW string id, not JSON
            // A stored id that isn't in the loaded list is dangling — treat as null;
            // reconciliation (below) re-adopts or recreates it from SIM_KEY.
            activeId = raw && plans.some(p => p.id === raw) ? raw : null;
        } catch (error) {
            console.error('Failed to load active plan id', error);
        }
        return { plans, activeId };
    });

    // Persist only after a real mutation — never on mount. Mirrors the `hasChanged`
    // gate in useScenarios/usePersistentState (see those files for the full
    // rationale): a fresh visitor must perform ZERO writes on mount, because
    // first-run onboarding eligibility keys on SIM_KEY absence and an ungated
    // effect would stamp these keys before the user ever chooses a path.
    // StrictMode-safe: the ref is only ever flipped by commit() below, never by
    // the effect itself, so dev-mode effect double-invokes can't trip it.
    const hasChanged = useRef(false);

    useEffect(() => {
        if (!hasChanged.current) return;
        localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify(store.plans));
        // The active id is a RAW string, written only once there IS an active
        // plan; virtual mode (activeId === null) leaves the key absent.
        if (store.activeId !== null) {
            localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, store.activeId);
        }
    }, [store]);

    // Flip the persist gate, then update state. Every mutator routes through this.
    const commit = (next: PlanStore) => {
        hasChanged.current = true;
        setStore(next);
    };

    // Reconcile the persisted store with the live SIM_KEY mirror exactly once on
    // mount. Guarded by a ref because StrictMode double-invokes []-effects in dev.
    //
    // Decision table (sim = readStoredSimInputs(); activeId is the current store's,
    // already null if it was dangling at init):
    //   1. sim === null                       → NOTHING (no writes, not even
    //                                            removeItem) — virtual mode; keeps a
    //                                            fresh visitor's mount write-free.
    //   2. sim, activeId null, a match exists  → adopt the matching entry with the
    //                                            latest lastSaved (activeId only;
    //                                            the plan entry is left untouched).
    //   3. sim, activeId null, no match        → materialize sim as a
    //                                            DEFAULT_PLAN_NAME entry and activate.
    //   4. sim, activeId valid, deep-equal     → NOTHING (reload purity, no churn).
    //   5. sim, activeId valid, differs        → SIM_KEY wins: overwrite that
    //                                            entry's inputs + bump lastSaved,
    //                                            keep its name (lets an onboarding
    //                                            relaunch edit the active plan).
    // Idempotent across epoch remounts: row 3 → next mount hits row 4, row 2 → row 4.
    const didReconcile = useRef(false);
    useEffect(() => {
        if (didReconcile.current) return;
        didReconcile.current = true;

        const sim = readStoredSimInputs();
        if (sim === null) return; // row 1

        const { plans, activeId } = store;

        if (activeId === null) {
            const matches = plans.filter(p => inputsEqual(p.inputs, sim));
            if (matches.length > 0) {
                // row 2: adopt the most-recently-saved match; do not touch the entry.
                const adopted = matches.reduce((a, b) => (b.lastSaved > a.lastSaved ? b : a));
                commit({ plans, activeId: adopted.id });
            } else {
                // row 3: sim is already sanitized, so store it directly.
                const created: SavedPlan = {
                    id: crypto.randomUUID(),
                    name: DEFAULT_PLAN_NAME,
                    inputs: sim,
                    lastSaved: new Date().toISOString()
                };
                commit({ plans: [...plans, created], activeId: created.id });
            }
            return;
        }

        const active = plans.find(p => p.id === activeId)!; // dangling ids nulled at init
        if (inputsEqual(active.inputs, sim)) return; // row 4

        // row 5
        commit({
            plans: plans.map(p =>
                p.id === activeId
                    ? { ...p, inputs: sim, lastSaved: new Date().toISOString() }
                    : p
            ),
            activeId
        });
        // Runs once on mount by design (captures the mount-time store); the
        // didReconcile ref makes it StrictMode-safe.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Mutators compute from the current render's `store` so create/duplicate/delete
    // can return the affected plan synchronously (before the commit re-render).
    // `activate` defaults true (every existing caller wants the new plan loaded
    // into the editor). Pass false to add a plan in the background without
    // touching the active plan — used by "Save as new plan" so saving a
    // suggestion never hijacks the plan the user is editing.
    const createPlan = (name: string, inputs: SimulationInputs, activate = true): SavedPlan => {
        const plan: SavedPlan = {
            id: crypto.randomUUID(),
            name,
            inputs: clone(inputs),
            lastSaved: new Date().toISOString()
        };
        commit({ plans: [...store.plans, plan], activeId: activate ? plan.id : store.activeId });
        return plan;
    };

    const duplicatePlan = (id: string): SavedPlan | null => {
        const src = store.plans.find(p => p.id === id);
        if (!src) return null;
        const copy: SavedPlan = {
            id: crypto.randomUUID(),
            name: `${src.name} (copy)`,
            inputs: clone(src.inputs),
            lastSaved: new Date().toISOString()
        };
        commit({ plans: [...store.plans, copy], activeId: copy.id });
        return copy;
    };

    const deletePlan = (id: string): SavedPlan | null => {
        if (store.plans.length <= 1) return null; // never delete the last plan
        const remaining = store.plans.filter(p => p.id !== id);
        if (remaining.length === store.plans.length) return null; // unknown id — no churn

        if (id === store.activeId) {
            // Atomic delete-and-activate: promote the most-recently-saved survivor.
            const next = remaining.reduce((a, b) => (b.lastSaved > a.lastSaved ? b : a));
            commit({ plans: remaining, activeId: next.id });
            return next;
        }
        commit({ plans: remaining, activeId: store.activeId });
        return null;
    };

    const renamePlan = (id: string, name: string): void => {
        const trimmed = name.trim();
        if (!trimmed) return; // empty/whitespace-only names are ignored
        // No lastSaved bump — a rename is metadata, not a projection change.
        commit({
            plans: store.plans.map(p => (p.id === id ? { ...p, name: trimmed } : p)),
            activeId: store.activeId
        });
    };

    const activatePlan = (id: string): SavedPlan | null => {
        const plan = store.plans.find(p => p.id === id);
        if (!plan) return null;
        commit({ plans: store.plans, activeId: id }); // no inputs/lastSaved change
        return plan;
    };

    const syncActiveInputs = (inputs: SimulationInputs): void => {
        if (store.activeId === null) {
            // Virtual mode: first sync materializes the plan (createPlan semantics).
            createPlan(DEFAULT_PLAN_NAME, inputs);
            return;
        }
        commit({
            plans: store.plans.map(p =>
                p.id === store.activeId
                    ? { ...p, inputs: clone(inputs), lastSaved: new Date().toISOString() }
                    : p
            ),
            activeId: store.activeId
        });
    };

    const activePlan =
        store.activeId !== null ? store.plans.find(p => p.id === store.activeId) ?? null : null;

    return {
        plans: store.plans,
        activePlanId: store.activeId,
        activePlan,
        createPlan,
        duplicatePlan,
        deletePlan,
        renamePlan,
        activatePlan,
        syncActiveInputs
    };
}
