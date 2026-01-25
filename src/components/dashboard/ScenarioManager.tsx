import React, { useState } from 'react';
import type { SavedScenario } from '../../hooks/useScenarios';
import type { SimulationInputs } from '../../engine/types';

interface ScenarioManagerProps {
    scenarios: SavedScenario[];
    activeScenarioId: string | null;
    currentInputs: SimulationInputs;
    onSave: (name: string) => void;
    onUpdate: () => void;
    onLoad: (scenario: SavedScenario) => void;
    onDelete: (id: string) => void;
    onCreateNew: () => void;
    onImport: (inputs: SimulationInputs) => void;
}

export function ScenarioManager({
    scenarios,
    activeScenarioId,
    currentInputs,
    onSave,
    onUpdate,
    onLoad,
    onDelete,
    onCreateNew,
    onImport
}: ScenarioManagerProps) {
    const [name, setName] = useState('');

    const handleSaveSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave(name);
        setName('');
    };

    const handleUpdateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onUpdate();
    };

    // --- Sharing Logic ---
    const handleShareScenario = () => {
        try {
            const data = btoa(JSON.stringify(currentInputs));

            // Check if clipboard API is available (Secure context / localhost)
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(data)
                    .then(() => alert("Scenario configuration copied to clipboard!"))
                    .catch(() => {
                        // Fallback in case writeText fails unexpectedly
                        prompt("Copy this scenario string:", data);
                    });
            } else {
                // Fallback for non-secure contexts
                prompt("Copy this scenario string (Your browser requires manual copy in this context):", data);
            }
        } catch (e) {
            console.error("Failed to share", e);
            alert("Failed to generate share link.");
        }
    };

    const handleImportScenario = () => {
        const str = prompt("Paste the scenario string here:");
        if (!str) return;
        try {
            const parsed = JSON.parse(atob(str));
            // Basic validation check
            if (parsed.person && parsed.returnRates) {
                onImport(parsed);
                // We don't reset name here, caller handles state
            } else {
                throw new Error("Invalid shape");
            }
        } catch (e) {
            console.error("Failed to import", e);
            alert("Invalid scenario string. Could not load.");
        }
    };

    return (
        <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
                <div className="flex flex-col">
                    <h2 className="text-xl font-bold text-slate-900 line-clamp-1">
                        {activeScenarioId
                            ? scenarios.find(s => s.id === activeScenarioId)?.name || 'Scenarios'
                            : 'Scenarios'}
                    </h2>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                        {activeScenarioId ? 'Active Scenario' : ''}
                    </p>
                </div>
                <button
                    onClick={onCreateNew}
                    className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded hover:bg-slate-200 transition-colors"
                >
                    Reset to Defaults
                </button>
            </div>

            {/* Export / Import Controls */}
            <div className="flex gap-2 text-xs">
                <button
                    onClick={handleShareScenario}
                    className="flex-1 flex items-center justify-center gap-1 bg-indigo-50 text-indigo-700 py-2 rounded-lg hover:bg-indigo-100 transition-colors font-medium border border-indigo-100"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    Share Scenario
                </button>
                <button
                    onClick={handleImportScenario}
                    className="flex-1 flex items-center justify-center gap-1 bg-slate-50 text-slate-700 py-2 rounded-lg hover:bg-slate-100 transition-colors font-medium border border-slate-200"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Import Scenario
                </button>
            </div>

            <form onSubmit={activeScenarioId ? handleUpdateSubmit : handleSaveSubmit} className="flex flex-col gap-2">
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Scenario name..."
                        className="flex-1 text-sm rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-brand-500 outline-none"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    {activeScenarioId ? (
                        <button
                            type="submit"
                            className="bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors whitespace-nowrap"
                        >
                            Update
                        </button>
                    ) : (
                        <button
                            type="submit"
                            className="bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors whitespace-nowrap"
                        >
                            Save
                        </button>
                    )}
                </div>
                {activeScenarioId && (
                    <button
                        type="button"
                        onClick={handleSaveSubmit}
                        className="text-xs text-slate-400 hover:text-brand-600 text-center transition-colors"
                    >
                        Save as copy instead
                    </button>
                )}
            </form>

            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar pt-2 border-t">
                {scenarios.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-4">No saved scenarios yet.</p>
                ) : (
                    scenarios.map(s => (
                        <div
                            key={s.id}
                            className={`flex items-center justify-between p-2 rounded-lg group transition-all cursor-pointer ${activeScenarioId === s.id
                                ? 'bg-brand-50 border border-brand-100'
                                : 'bg-slate-50 border border-transparent hover:bg-slate-100'
                                }`}
                            onClick={() => onLoad(s)}
                        >
                            <div className="flex-1">
                                <p className={`text-sm font-medium truncate ${activeScenarioId === s.id ? 'text-brand-900' : 'text-slate-700'}`}>
                                    {s.name}
                                </p>
                                <p className="text-[10px] text-slate-400">{new Date(s.lastSaved).toLocaleDateString()}</p>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(s.id);
                                }}
                                className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    ))
                )}
            </div>

        </section>
    );
}
