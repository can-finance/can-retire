import { useRef, useState } from 'react';
import LZString from 'lz-string';
import type { SavedPlan } from '../../hooks/usePlans';
import type { SimulationInputs } from '../../engine/types';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { HelpTooltip } from '../ui/HelpTooltip';
import { Dialog, dialogPrimaryBtn, dialogSecondaryBtn, dialogDestructiveBtn } from '../ui/Dialog';

// null = closed. 'copied'/'manual' carry the share URL; 'error' is the
// generation-failure state.
type ShareState =
    | null
    | { kind: 'copied'; url: string }
    | { kind: 'manual'; url: string }
    | { kind: 'error' };

interface PlanManagerProps {
    plans: SavedPlan[];
    activePlanId: string | null;
    activePlanName: string;
    activeLastSaved: string | null;
    currentInputs: SimulationInputs;
    onRenameActive: (name: string) => void;
    onDuplicateActive: () => void;
    onNewPlanGuided: () => void;
    onActivate: (id: string) => void;
    onDelete: (id: string) => void;
    onCompare: () => void;
    onOptimize: () => void;
}

/*
 * Spells out which plan is being edited, rather than leaving it to a pale tint.
 * Always rendered — unlike the delete control beside it, this is state, not an
 * action, so it must not wait for a hover that touch users never produce.
 */
function ActiveBadge() {
    return (
        <span className="ml-2 flex-shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
            Active
        </span>
    );
}

export function PlanManager({
    plans,
    activePlanId,
    activePlanName,
    activeLastSaved,
    currentInputs,
    onRenameActive,
    onDuplicateActive,
    onNewPlanGuided,
    onActivate,
    onDelete,
    onCompare,
    onOptimize,
}: PlanManagerProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [share, setShare] = useState<ShareState>(null);
    const [copied, setCopied] = useState(false);
    // The plan awaiting delete confirmation (null when no confirm is open).
    const [pendingDelete, setPendingDelete] = useState<SavedPlan | null>(null);
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
        setCopied(false);
        try {
            // Compress the inputs
            const json = JSON.stringify(currentInputs);
            const compressed = LZString.compressToEncodedURIComponent(json);

            // Construct full URL
            const url = `${window.location.origin}${window.location.pathname}#start=${compressed}`;

            // Check if clipboard API is available (Secure context / localhost).
            // Either way we show the dialog with a selectable URL as the fallback.
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(url)
                    .then(() => setShare({ kind: 'copied', url }))
                    .catch(() => setShare({ kind: 'manual', url }));
            } else {
                setShare({ kind: 'manual', url });
            }
        } catch (e) {
            console.error("Failed to share", e);
            setShare({ kind: 'error' });
        }
    };

    // Re-copy from inside the share dialog. May fail silently in insecure
    // contexts — selecting the field text is the fallback there.
    const recopyShareUrl = (url: string) => {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url)
                .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => { /* selecting the text is the fallback */ });
        }
    };

    const shareOpen = share?.kind === 'copied' || share?.kind === 'manual';
    const shareUrl = share && 'url' in share ? share.url : '';

    const confirmDelete = () => {
        if (pendingDelete) onDelete(pendingDelete.id);
        setPendingDelete(null);
    };

    // The section heading is now the standard text-xl bold used by every other
    // input section, so the plan NAME steps down a level rather than competing
    // with it — it's content inside the section, not a second heading.
    const titleClass = 'text-lg font-semibold text-slate-800 line-clamp-1';

    return (
        <CollapsibleSection
            title="Plan Manager"
            accent="rose"
        >
            <div className="space-y-4">
            <div className="space-y-2 border-b pb-2">
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
                            <HelpTooltip text="Click to rename this plan.">
                                <button
                                    onClick={startEdit}
                                    aria-label="Rename plan"
                                    className={`${titleClass} text-left hover:text-brand-600 transition-colors`}
                                >
                                    {activePlanName}
                                </button>
                            </HelpTooltip>
                        )}
                        <HelpTooltip text="A plan holds everything you've entered — ages, incomes, accounts, spending, and assumptions. Plans are saved locally in your browser on this device — nothing is uploaded to any server. Clearing browser data removes them; use Share to create a backup link that contains all of a plan's data.">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-300 hover:text-slate-500 transition-colors cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </HelpTooltip>
                    </div>
                    {/* No "edited …" line here — every edit writes through immediately,
                        so the date is always today and says nothing. It stays in the plan
                        list below, where comparing dates across plans is the point.
                        The not-yet-saved case still earns a line: it tells a first-time
                        visitor their typing is being kept without them doing anything. */}
                    {!activeLastSaved && (
                        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                            Not saved yet — edits save automatically
                        </p>
                    )}
                </div>
                <div className="flex items-center flex-wrap gap-2">
                    <HelpTooltip text="Copies a shareable backup link containing all of this plan's data — every input and assumption is encoded in the link itself, nothing is stored on any server. Opening it restores the full plan. Anyone with the link can see the numbers in it.">
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
                        onClick={onDuplicateActive}
                        title="Copy the current plan as a starting point for changes"
                        className="text-xs bg-slate-50 text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200"
                    >
                        Duplicate Plan
                    </button>
                    <button
                        onClick={onNewPlanGuided}
                        title="Create a new plan from scratch via Guided Setup"
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
                    Compare Plans
                </button>
                {plans.length < 2 && (
                    <p className="text-xs text-slate-500 text-center mt-1">Create a second plan to compare</p>
                )}

                {/* Optimizer: searches the active plan for a better RRSP-meltdown
                    schedule. Always available (works on a single plan). */}
                <button
                    onClick={onOptimize}
                    title="Search RRSP meltdown schedules for the largest after-tax estate, or the most you can spend each year"
                    className="mt-2 w-full flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-2.5 rounded-lg hover:bg-emerald-100 transition-colors font-medium border border-emerald-100 text-sm"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Optimize Meltdown
                    <span className="bg-emerald-100 text-emerald-800 text-xs px-1.5 py-0.5 rounded font-bold">BETA</span>
                </button>
            </div>

            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar pt-2 border-t">
                {plans.length === 0 ? (
                    // Virtual state: one synthetic active row for the not-yet-persisted plan.
                    <div className="flex items-center justify-between p-2 rounded-lg bg-brand-50 border-2 border-brand-500">
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate text-brand-900">{activePlanName}</p>
                            <p className="text-xs text-slate-500">Not saved yet</p>
                        </div>
                        <ActiveBadge />
                    </div>
                ) : (
                    plans.map(p => (
                        <div
                            key={p.id}
                            // Which plan you are editing is the single most important
                            // fact in this list, and it used to be carried by brand-50
                            // against slate-50 — a couple of percent of luminance
                            // apart. Three signals now, none of them colour alone: a
                            // full-strength outline, a bolder name, and a literal
                            // "Active" badge. Every row carries border-2 (transparent
                            // when inactive) so switching plans doesn't shift the list
                            // by 2px per row.
                            className={`flex items-center justify-between p-2 rounded-lg group transition-all cursor-pointer ${activePlanId === p.id
                                ? 'bg-brand-50 border-2 border-brand-500'
                                : 'bg-slate-50 border-2 border-transparent hover:bg-slate-100'
                                }`}
                            aria-current={activePlanId === p.id ? 'true' : undefined}
                            onClick={() => onActivate(p.id)}
                        >
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm truncate ${activePlanId === p.id ? 'font-semibold text-brand-900' : 'font-medium text-slate-700'}`}>
                                    {p.name}
                                </p>
                                <p className="text-xs text-slate-500">edited {new Date(p.lastSaved).toLocaleDateString()}</p>
                            </div>
                            {activePlanId === p.id && <ActiveBadge />}
                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-all">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setPendingDelete(p);
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

            {/* Share dialog — success (link copied) or manual-copy fallback. */}
            <Dialog
                open={shareOpen}
                onClose={() => setShare(null)}
                title={share?.kind === 'copied' ? 'Share link copied' : 'Copy this share link'}
                footer={
                    <button type="button" onClick={() => setShare(null)} className={dialogPrimaryBtn}>
                        Done
                    </button>
                }
            >
                <p>Anyone with this link can see all of this plan's numbers.</p>
                <div className="mt-3 flex items-center gap-2">
                    <input
                        type="text"
                        readOnly
                        value={shareUrl}
                        data-autofocus
                        onFocus={(e) => e.target.select()}
                        aria-label="Share link"
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700 outline-none focus:border-brand-400"
                    />
                    <button
                        type="button"
                        onClick={() => recopyShareUrl(shareUrl)}
                        className="shrink-0 px-3 py-2 rounded-xl text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                    >
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>
            </Dialog>

            {/* Share dialog — link generation failed. */}
            <Dialog
                open={share?.kind === 'error'}
                onClose={() => setShare(null)}
                title="Couldn't create share link"
                maxWidth="max-w-sm"
                footer={
                    <button type="button" data-autofocus onClick={() => setShare(null)} className={dialogPrimaryBtn}>
                        Close
                    </button>
                }
            >
                <p>Something went wrong generating the link. Try again.</p>
            </Dialog>

            {/* Delete confirmation. */}
            <Dialog
                open={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                title="Delete plan?"
                maxWidth="max-w-sm"
                footer={
                    <>
                        <button type="button" data-autofocus onClick={() => setPendingDelete(null)} className={dialogSecondaryBtn}>
                            Cancel
                        </button>
                        <button type="button" onClick={confirmDelete} className={dialogDestructiveBtn}>
                            Delete
                        </button>
                    </>
                }
            >
                <p>Delete "{pendingDelete?.name}"? This can't be undone.</p>
            </Dialog>

            </div>
        </CollapsibleSection>
    );
}
