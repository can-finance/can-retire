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
        const saved = localStorage.getItem('retirement_saved_scenarios');
        return saved ? JSON.parse(saved) : [];
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

    const updateScenario = (id: string, inputs: SimulationInputs) => {
        setScenarios(prev => prev.map(s =>
            s.id === id
                ? { ...s, inputs: JSON.parse(JSON.stringify(inputs)), lastSaved: new Date().toISOString() }
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
