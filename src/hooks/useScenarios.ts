import { useState, useEffect } from 'react';
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

    useEffect(() => {
        localStorage.setItem('retirement_saved_scenarios', JSON.stringify(scenarios));
    }, [scenarios]);

    const saveScenario = (name: string, inputs: SimulationInputs) => {
        const newScenario: SavedScenario = {
            id: crypto.randomUUID(),
            name,
            inputs: JSON.parse(JSON.stringify(inputs)),
            lastSaved: new Date().toISOString()
        };
        setScenarios(prev => [...prev, newScenario]);
    };

    const updateScenario = (id: string, inputs: SimulationInputs, newName?: string) => {
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
        setScenarios(prev => prev.filter(s => s.id !== id));
    };

    return {
        scenarios,
        saveScenario,
        updateScenario,
        deleteScenario
    };
}
