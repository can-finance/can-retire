import { useRef, useState } from 'react';
import LZString from 'lz-string';
import type { SavedPlan } from '../../hooks/usePlans';
import type { SimulationInputs } from '../../engine/types';
import { SectionCard } from '../ui/SectionCard';
import { HelpTooltip } from '../ui/HelpTooltip';

interface PlanManagerProps {
    plans: SavedPlan[];
    activePlanId: string | null;
    activePlanName: string;
    activeLastSaved: string | null;
    currentInputs: SimulationInputs;
    onRenameActive: (name: string) => void;
    onNewPlan: () => void;
    onActivate: (id: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    onCompare: () => void;
}

export function PlanManager({
    plans,
    activePlanId,
    activePlanName,
    activeLastSaved,
    currentInputs,
    onRenameActive,
    onNewPlan,
    onActivate,
    onDuplicate,
    onDelete,
    onCompare,
}: PlanManagerProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    // Set by Enter/Escape so the blur that fires when the input unmounts doesn't
    // re-run commit (which would double-fire rename, or commit an Escape-cancel).
    const skipBlur = useRef(false);

    const startEdit = () => {
        setDraft(activePlanName);
        setEditing(true);
    };

    const commitEdit = () => {
        const trimmed = draft.trim();
        // Trimmed-empty is a no-op rename — just leave edit mode.
        if (trimmed) onRenameActive(trimmed);
        setEditing(false);
    };

    // --- Sharing Logic ---
    const handleSharePlan = () => {
        try {
            // Compress the inputs
            const json = JSON.stringify(currentInputs);
            const compressed = LZString.compressToEncodedURIComponent(json);

            // Construct full URL
            const url = `${window.location.origin}${window.location.pathname}#start=${compressed}`;

            // Check if clipboard API is available (Secure context / localhost)
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(url)
                    .then(() => alert("Shareable URL copied to clipboard!"))
                    .catch(() => {
                        prompt("Copy this URL:", url);
                    });
            } else {
                prompt("Copy this URL:", url);
            }
        } catch (e) {
            console.error("Failed to share", e);
            alert("Failed to generate share link.");
        }
    };

    const titleClass = 'text-xl font-bold text-slate-900 line-clamp-1';

    return (
        <SectionCard accent="indigo" className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
                <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                        {editing ? (
                            <input
                                type="text"
                                autoFocus
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onBlur={() => {
                                    if (skipBlur.current) { skipBlur.current = false; return; }
                                    commitEdit();
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') { skipBlur.current = true; commitEdit(); }
                                    else if (e.key === 'Escape') { skipBlur.current = true; setEditing(false); }
                                }}
                                className={`${titleClass} bg-transparent outline-none border-b border-brand-400 min-w-0`}
                            />
                        ) : (
                            <button
                                onClick={startEdit}
                                aria-label="Rename plan"
                                title="Click to rename"
                                className={`${titleClass} text-left hover:text-brand-600 transition-colors`}
                            >
                                {activePlanName}
                            </button>
                        )}
                        <HelpTooltip text="A plan holds everything you've entered — ages, incomes, accounts, spending, and assumptions. Plans are saved locally in your browser on this PC — nothing is uploaded to any server. Clearing browser data removes them; use Share to create a backup link that contains all of a plan's data.">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-300 hover:text-slate-500 transition-colors cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </HelpTooltip>
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                        {activeLastSaved
                            ? `edited ${new Date(activeLastSaved).toLocaleDateString()}`
                            : 'Not saved yet — edits save automatically'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <HelpTooltip text="Copies a shareable backup link containing ALL of this plan's data — every input and assumption is encoded in the link itself, nothing is stored on any server. Opening it restores the full plan. Anyone with the link can see the numbers in it.">
                    <button
                        onClick={handleSharePlan}
                        className="text-xs flex items-center gap-1 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors font-medium border border-indigo-100"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        Share
                    </button>
                    </HelpTooltip>
                    <button
                        onClick={onNewPlan}
                        className="text-xs bg-slate-50 text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200"
                    >
                        New Plan
                    </button>
                </div>
            </div>

            <div>
                {/* Visible-but-disabled with a single plan so the feature is
                    discoverable before it's unlocked. */}
                <button
                    onClick={onCompare}
                    disabled={plans.length < 2}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-2.5 rounded-lg hover:bg-indigo-100 transition-colors font-medium border border-indigo-100 text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-50"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V9m6 10V5m6 14v-7M3 19h18" />
                    </svg>
                    Compare plans
                </button>
                {plans.length < 2 && (
                    <p className="text-[10px] text-slate-400 text-center mt-1">Create a second plan to compare</p>
                )}
            </div>

            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar pt-2 border-t">
                {plans.length === 0 ? (
                    // Virtual state: one synthetic active row for the not-yet-persisted plan.
                    <div className="flex items-center justify-between p-2 rounded-lg bg-brand-50 border border-brand-100">
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate text-brand-900">{activePlanName}</p>
                            <p className="text-[10px] text-slate-400">Not saved yet</p>
                        </div>
                    </div>
                ) : (
                    plans.map(p => (
                        <div
                            key={p.id}
                            className={`flex items-center justify-between p-2 rounded-lg group transition-all cursor-pointer ${activePlanId === p.id
                                ? 'bg-brand-50 border border-brand-100'
                                : 'bg-slate-50 border border-transparent hover:bg-slate-100'
                                }`}
                            onClick={() => onActivate(p.id)}
                        >
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${activePlanId === p.id ? 'text-brand-900' : 'text-slate-700'}`}>
                                    {p.name}
                                </p>
                                <p className="text-[10px] text-slate-400">edited {new Date(p.lastSaved).toLocaleDateString()}</p>
                            </div>
                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-all">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDuplicate(p.id);
                                    }}
                                    aria-label="Duplicate plan"
                                    title="Duplicate"
                                    className="text-slate-300 hover:text-brand-600 transition-colors p-1"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete(p.id);
                                    }}
                                    disabled={plans.length === 1}
                                    aria-label="Delete plan"
                                    title={plans.length === 1 ? 'You need at least one plan' : 'Delete'}
                                    className="text-slate-300 hover:text-red-500 transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-300"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

        </SectionCard>
    );
}
