import { useState, useEffect, useRef } from 'react';
import type { SimulationInputs } from '../engine/types';

export interface SavedScenario {
    id: string;
    name: string;
    inputs: SimulationInputs;
    lastSaved: string;
}

export function useScenarios() {
    const [scenarios, setScenarios] = useState<SavedScenario[]>(() => {
        // Guard against corrupted or wrong-shaped localStorage — a broken list
        // should degrade to empty, not crash the app on mount
        try {
            const saved = localStorage.getItem('retirement_saved_scenarios');
            const parsed = saved ? JSON.parse(saved) : [];
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((s): s is SavedScenario =>
                !!s && typeof s === 'object' &&
                typeof s.id === 'string' && typeof s.name === 'string' &&
                !!s.inputs && typeof s.inputs === 'object'
            );
        } catch (error) {
            console.error('Failed to load saved scenarios', error);
            return [];
        }
    });

    // Persist only after a real mutation (save/update/delete) — never on mount.
    // Mirrors the `hasChanged` gate in usePersistentState (see that file for the
    // full rationale): a fresh visitor's Dashboard mounts behind the onboarding
    // intro scrim, and an ungated effect here would stamp '[]' into localStorage
    // before the user ever chooses a path, clobbering the "no existing data"
    // signal first-run eligibility relies on. StrictMode-safe: the ref is only
    // flipped by the mutators below, never by the effect itself.
    const hasChanged = useRef(false);

    useEffect(() => {
        if (!hasChanged.current) return;
        localStorage.setItem('retirement_saved_scenarios', JSON.stringify(scenarios));
    }, [scenarios]);

    const saveScenario = (name: string, inputs: SimulationInputs) => {
        const newScenario: SavedScenario = {
            id: crypto.randomUUID(),
            name,
            inputs: JSON.parse(JSON.stringify(inputs)),
            lastSaved: new Date().toISOString()
        };
        hasChanged.current = true;
        setScenarios(prev => [...prev, newScenario]);
    };

    const updateScenario = (id: string, inputs: SimulationInputs, newName?: string) => {
        hasChanged.current = true;
        setScenarios(prev => prev.map(s =>
            s.id === id
                ? {
                    ...s,
                    name: newName?.trim() ? newName.trim() : s.name,
                    inputs: JSON.parse(JSON.stringify(inputs)),
                    lastSaved: new Date().toISOString()
                }
                : s
        ));
    };

    const deleteScenario = (id: string) => {
        hasChanged.current = true;
        setScenarios(prev => prev.filter(s => s.id !== id));
    };

    return {
        scenarios,
        saveScenario,
        updateScenario,
        deleteScenario
    };
}
