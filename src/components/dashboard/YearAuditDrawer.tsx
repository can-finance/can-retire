import { Fragment, useEffect, useId, useMemo, useRef } from 'react';
import type { SimulationInputs, SimulationResult } from '../../engine/types';
import { buildYearAudit, NOTE_AMOUNT_TOKEN } from '../../utils/yearAudit';
import type { AuditCheck, AuditLine, AuditSection, AuditSectionKey, AuditBadge } from '../../utils/yearAudit';
import { formatCurrencyCAD } from '../../utils/formatters';

interface YearAuditDrawerProps {
    inputs: SimulationInputs;
    results: SimulationResult[];
    index: number;
    inflationAdjusted: boolean;
    hasSpouse: boolean;
    onClose: () => void;
    onNavigate: (newIndex: number) => void;
}

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const BADGE_META: Record<AuditBadge, { label: string; className: string }> = {
    'first-year': { label: 'First year', className: 'bg-slate-100 text-slate-600' },
    'final-year': { label: 'Final year', className: 'bg-slate-100 text-slate-600' },
    'death-year': { label: 'Death year', className: 'bg-rose-100 text-rose-700' },
    shortfall: { label: 'Shortfall', className: 'bg-amber-100 text-amber-700' },
    'one-time-event': { label: 'One-time event', className: 'bg-indigo-100 text-indigo-700' },
};

// Sections where a negative line genuinely represents money leaving (tax,
// withdrawals, terminal tax) — these get the red tint. incomeSources/taxes
// negative lines are credits/savings (e.g. a sheltering dividend credit, a
// pension-split saving), so they stay neutral rather than reading as a problem.
const DEDUCTION_SECTIONS = new Set<AuditSectionKey>([
    'cashFlow', 'accountsRRSP', 'accountsTFSA', 'accountsNonReg', 'estate',
]);

// The account sections are balance waterfalls, not part of the income → tax →
// net → spending story above them. They get a tinted card and a left accent in
// the account's own colour (matching YearlyBreakdownTable's column classes) so
// the eye reads them as a separate group. Styling is keyed off the section key —
// the audit data layer knows nothing about it.
const ACCOUNT_ACCENT: Partial<Record<AuditSectionKey, string>> = {
    accountsRRSP: 'border-l-4 border-l-sky-500',
    accountsTFSA: 'border-l-4 border-l-emerald-500',
    accountsNonReg: 'border-l-4 border-l-amber-500',
};

// The account group opens with this heading; Estate follows the group on the
// plain card style, which is enough to set it apart from the waterfalls.
const ACCOUNT_GROUP_START: AuditSectionKey = 'accountsRRSP';

// `formatCurrencyCAD` doesn't sign negatives the way the rest of the app does
// (see YearlyBreakdownTable's shortfall cell) — prefix the minus ourselves.
function fmtAmt(v: number): string {
    return v < 0 ? `−${formatCurrencyCAD(Math.abs(v))}` : formatCurrencyCAD(v);
}

function Badge({ badge }: { badge: AuditBadge }) {
    const meta = BADGE_META[badge];
    return (
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.className}`}>
            {meta.label}
        </span>
    );
}

function LineRow({
    line, sectionKey, showSplit, scale,
}: { line: AuditLine; sectionKey: AuditSectionKey; showSplit: boolean; scale: number }) {
    const heavy = line.kind === 'subtotal' || line.kind === 'result';
    // 'reference' is excluded from the section's arithmetic exactly like 'info'
    // (see sumLines/AuditLineKind), but it is the headline figure of its section,
    // not a mere annotation — so unlike 'info' it keeps the normal palette.
    const isInfo = line.kind === 'info';
    const amt = line.amount / scale;
    const redTint = amt < 0 && DEDUCTION_SECTIONS.has(sectionKey);

    const labelClass = isInfo ? 'text-slate-400' : 'text-slate-700';
    const amountClass = isInfo ? 'text-slate-400' : redTint ? 'text-rose-600' : 'text-slate-900';
    const rowClass = heavy ? 'border-t-2 border-slate-200' : '';
    const weightClass = heavy ? 'font-semibold' : '';

    // A note may cite a specific dollar figure via NOTE_AMOUNT_TOKEN rather than
    // baking a nominal string into the data layer, so it can be scaled by the same
    // real/nominal factor as every other amount on the row.
    const noteText = line.note && line.noteAmount !== undefined
        ? line.note.replace(NOTE_AMOUNT_TOKEN, fmtAmt(line.noteAmount / scale))
        : line.note;

    return (
        <tr className={rowClass}>
            <td className={`px-3 py-2 align-top ${labelClass} ${weightClass}`}>
                <div>{line.label}</div>
                {noteText && <div className="text-[11px] text-slate-400 mt-0.5 font-normal">{noteText}</div>}
            </td>
            {showSplit && (
                <>
                    <td className="px-3 py-2 text-right text-slate-500 align-top whitespace-nowrap">
                        {line.person !== undefined ? fmtAmt(line.person / scale) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500 align-top whitespace-nowrap">
                        {line.spouse !== undefined ? fmtAmt(line.spouse / scale) : '—'}
                    </td>
                </>
            )}
            <td className={`px-3 py-2 text-right align-top whitespace-nowrap ${amountClass} ${weightClass}`}>
                {fmtAmt(amt)}
            </td>
        </tr>
    );
}

function CheckRow({ check, scale, colSpan }: { check: AuditCheck; scale: number; colSpan: number }) {
    const balances = Math.abs(check.residual) < 1;
    return (
        <tr className={balances ? 'bg-emerald-50/60' : 'bg-amber-50'}>
            <td colSpan={colSpan} className="px-3 py-2 text-xs">
                <div className={`flex items-center gap-1.5 font-medium ${balances ? 'text-emerald-700' : 'text-amber-800'}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${balances ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    {check.label}
                    {balances ? ' — balances' : ` — unexplained: ${fmtAmt(check.residual / scale)}`}
                </div>
                {!balances && check.note && <div className="text-amber-700 mt-0.5">{check.note}</div>}
            </td>
        </tr>
    );
}

function SectionBlock({ section, hasSpouse, scale }: { section: AuditSection; hasSpouse: boolean; scale: number }) {
    const showSplit = hasSpouse && section.lines.some(l => l.person !== undefined);
    const colSpan = showSplit ? 4 : 2;
    const accent = ACCOUNT_ACCENT[section.key];
    const cardClass = accent
        ? `rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden ${accent}`
        : 'rounded-xl border border-slate-100 overflow-hidden';

    return (
        <div>
            <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wide mb-2">{section.title}</h3>
            <div className={cardClass}>
                <table className="w-full text-sm">
                    {showSplit && (
                        <thead className="bg-slate-50 text-[11px] text-slate-400 uppercase tracking-wide">
                            <tr>
                                <th className="px-3 py-1.5 text-left font-medium"> </th>
                                <th className="px-3 py-1.5 text-right font-medium">You</th>
                                <th className="px-3 py-1.5 text-right font-medium">Spouse</th>
                                <th className="px-3 py-1.5 text-right font-medium">Total</th>
                            </tr>
                        </thead>
                    )}
                    <tbody className="divide-y divide-slate-100">
                        {section.lines.map((line, i) => (
                            <LineRow key={i} line={line} sectionKey={section.key} showSplit={showSplit} scale={scale} />
                        ))}
                    </tbody>
                    {section.check && (
                        <tfoot>
                            <CheckRow check={section.check} scale={scale} colSpan={colSpan} />
                        </tfoot>
                    )}
                </table>
            </div>
            {section.note && <p className="text-xs text-slate-400 mt-1.5">{section.note}</p>}
        </div>
    );
}

/**
 * Slide-over panel showing the full audit for one projection year: every
 * section's line items plus its reconciliation check. Presentation only — all
 * arithmetic lives in `buildYearAudit`; the only math here is dividing each
 * amount by the row's `inflationFactor` when the real-dollars toggle is on.
 * Reconciliation checks always compare NOMINAL residuals (see yearAudit.ts),
 * since every line is scaled by the same factor the identity is unaffected.
 */
export function YearAuditDrawer({
    inputs, results, index, inflationAdjusted, hasSpouse, onClose, onNavigate,
}: YearAuditDrawerProps) {
    const audit = useMemo(() => buildYearAudit(inputs, results, index), [inputs, results, index]);
    const row = results[index];
    const scale = inflationAdjusted ? row.inflationFactor : 1;

    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const previouslyFocused = useRef<HTMLElement | null>(null);

    const atStart = index <= 0;
    const atEnd = index >= results.length - 1;

    // Restore focus to whatever triggered the drawer (a table row / chart bar)
    // once it closes, and move focus into the panel on open.
    useEffect(() => {
        previouslyFocused.current = document.activeElement as HTMLElement | null;
        const panel = panelRef.current;
        try {
            panel?.focus({ preventScroll: true });
        } catch {
            panel?.focus();
        }
        return () => {
            previouslyFocused.current?.focus?.();
        };
    }, []);

    // Lock document scroll while the drawer is open (mirrors OnboardingFlow).
    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
            return;
        }

        const target = e.target as HTMLElement;
        const inFormControl = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;

        if (!inFormControl && e.key === 'ArrowLeft' && !atStart) {
            e.preventDefault();
            onNavigate(index - 1);
            return;
        }
        if (!inFormControl && e.key === 'ArrowRight' && !atEnd) {
            e.preventDefault();
            onNavigate(index + 1);
            return;
        }

        if (e.key === 'Tab') {
            const panel = panelRef.current;
            if (!panel) return;
            const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
            if (focusable.length === 0) {
                e.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };

    return (
        <div className="fixed inset-0 z-[150] flex justify-end">
            {/* Scrim */}
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />

            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                className="relative w-full sm:max-w-xl h-full bg-white shadow-xl flex flex-col outline-none sm:rounded-l-2xl"
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-100 flex-shrink-0">
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-xl font-bold text-slate-900">
                            {audit.year} — Age {audit.age}
                            {hasSpouse && audit.spouseAge !== undefined ? ` / Spouse ${audit.spouseAge}` : ''}
                        </h2>
                        {audit.badges.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap mt-2">
                                {audit.badges.map(b => <Badge key={b} badge={b} />)}
                            </div>
                        )}
                        {inflationAdjusted && (
                            <p className="text-xs text-slate-400 mt-2">
                                Shown in today's dollars — every amount below is divided by {row.inflationFactor.toFixed(2)}× cumulative inflation. The reconciliation checks still balance because every line is scaled the same way.
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                            type="button"
                            onClick={() => onNavigate(index - 1)}
                            disabled={atStart}
                            aria-label="Previous year"
                            title="Previous year"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            onClick={() => onNavigate(index + 1)}
                            disabled={atEnd}
                            aria-label="Next year"
                            title="Next year"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            title="Close"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors ml-1"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    {audit.sections.map(section => (
                        <Fragment key={section.key}>
                            {section.key === ACCOUNT_GROUP_START && (
                                <div className="pt-4 border-t border-slate-200">
                                    <h3 className="text-lg font-bold text-slate-500 uppercase tracking-widest">
                                        Account balances
                                    </h3>
                                </div>
                            )}
                            <SectionBlock section={section} hasSpouse={hasSpouse} scale={scale} />
                        </Fragment>
                    ))}
                </div>
            </div>
        </div>
    );
}
