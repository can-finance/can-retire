import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Person, SimulationInputs } from '../../engine/types';
import { BrandLockup } from '../layout/AppLayout';
import { SectionCard } from '../ui/SectionCard';
import { Dialog, dialogSecondaryBtn, dialogDestructiveBtn } from '../ui/Dialog';
import { ValidationBanner } from '../ui/ValidationBanner';
import { commitOnboardingInputs, hasSavedPlan, markOnboardingDone } from '../../utils/onboarding';
import { createDefaultPerson } from '../../utils/inputSanitizer';
import { OnboardingIntro } from './OnboardingIntro';
import { OnboardingClosing } from './OnboardingClosing';
import { SimplePathStep, SIMPLE_STEP_COUNT } from './SimplePathStep';
import {
    seedToSimpleAnswers,
    mergeSimpleAnswers,
    simpleAnswersErrors,
    type SimpleAnswers,
} from './simplePathMapping';
import { buildDetailedSteps } from './detailedSteps';

interface OnboardingFlowProps {
    seed: SimulationInputs;
    /** `committed` is true iff Save has written the draft to storage this session. */
    onDone: (committed: boolean) => void;
    /** Open How It Works scrolled to #privacy. When absent, falls back to onDone. */
    onOpenPrivacy?: (committed: boolean) => void;
}

type Screen = 'intro' | 'simple' | 'detailed' | 'closing';

export function OnboardingFlow({ seed, onDone, onOpenPrivacy }: OnboardingFlowProps) {
    const [screen, setScreen] = useState<Screen>('intro');
    const [stepIndex, setStepIndex] = useState(0);
    // Which path led to the shared closing screen — decides what we commit.
    const [path, setPath] = useState<'simple' | 'detailed'>('detailed');

    // Re-launch iff a saved plan currently exists — read once at wizard open (not
    // captured at app mount), so a first-run user who finishes/skips then reopens
    // Guided setup is correctly treated as a re-launch ("keep my current numbers").
    const [isRelaunch] = useState(() => hasSavedPlan());

    // The draft is the single source of truth at every path boundary. Both paths
    // read from and merge back into it.
    const [draft, setDraft] = useState<SimulationInputs>(seed);
    // Quick path works off a compact answer set, derived from the draft on entry
    // and merged back into the draft on exit/commit.
    const [answers, setAnswers] = useState<SimpleAnswers>(() => seedToSimpleAnswers(seed));

    // True once Save has committed the draft at least once this session. The
    // closing screen is pure confirmation after that — its buttons never commit.
    // Sticky once set: a Back-then-Skip after a Save must still report "data was
    // written" for close purposes (App only remounts Dashboard — bumping its
    // epoch — when the close is committed).
    const [hasCommitted, setHasCommitted] = useState(false);

    // True once the user has actually entered something in either path. Gates the
    // discard confirmation — an untouched wizard has nothing worth protecting, so
    // Escape/Skip stay instant there.
    const [dirty, setDirty] = useState(false);
    const [confirmDiscard, setConfirmDiscard] = useState(false);

    // Set when Next/Save was pressed but validation refused. Purely for the
    // "fix the highlighted items" nudge — the banner itself renders off the
    // error set, not off this.
    const [blocked, setBlocked] = useState(false);

    // Lock document scroll while the overlay is mounted — `inert` on the
    // background tree blocks its pointer/focus but not wheel/touch scroll-chaining,
    // so without this the scrim (and, worse, opaque steps) would scroll the
    // dashboard behind them. Restored to whatever it was on unmount so the
    // dashboard reappears at its original scroll position.
    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, []);

    // Move focus into the dialog on open. `preventScroll` avoids a redundant
    // jump-to-top (the overlay is already `fixed inset-0`); guarded since older
    // engines can throw on the options-object form of `.focus()`.
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        try {
            rootRef.current?.focus({ preventScroll: true });
        } catch {
            rootRef.current?.focus();
        }
    }, []);

    // Stash the spouse across a toggle-off in the detailed path so toggling back
    // on restores the previously present (seeded or edited) spouse rather than a
    // fresh default. Mirrors the quick path's non-destructive spouse merge.
    const [spouseStash, setSpouseStash] = useState<Person | undefined>(seed.spouse);
    const toggleSpouse = (on: boolean) => {
        setDirty(true);
        if (on) {
            setDraft((cur) => ({ ...cur, spouse: spouseStash ?? createDefaultPerson(true) }));
        } else {
            if (draft.spouse) setSpouseStash(draft.spouse);
            setDraft((cur) => ({ ...cur, spouse: undefined }));
        }
    };

    // Every edit routes through these so `dirty` can't fall out of sync with what
    // the user has actually typed.
    const editDraft: typeof setDraft = (update) => {
        setDirty(true);
        setDraft(update);
    };
    const editAnswers = (partial: Partial<SimpleAnswers>) => {
        setDirty(true);
        setAnswers((a) => ({ ...a, ...partial }));
    };

    // Cheap to rebuild each render; buildDetailedSteps only reads `draft` to shape
    // the list, and each step's render receives the live draft + setter.
    const detailedSteps = buildDetailedSteps(draft, toggleSpouse);

    // Spouse-toggle splicing can shrink the list under the cursor — derive a safe
    // index at render (never store an out-of-range one) so navigation stays honest.
    const safeStepIndex =
        screen === 'detailed'
            ? Math.min(stepIndex, Math.max(0, detailedSteps.length - 1))
            : stepIndex;

    const finalInputs = (): SimulationInputs =>
        path === 'simple' ? mergeSimpleAnswers(draft, answers) : draft;

    // Closing-screen buttons are pure confirmation — Save (below, in goNext) already
    // committed the draft before this screen ever shows.
    const finish = () => {
        onDone(hasCommitted);
    };

    const openPrivacy = () => {
        // The draft is already committed (Save, before the closing screen showed) —
        // just hand off to the privacy page (App turns onboarding off + navigates + scrolls).
        if (onOpenPrivacy) onOpenPrivacy(hasCommitted);
        else onDone(hasCommitted);
    };

    // Wrapped in useCallback (rather than a plain function redefined each
    // render) so the Escape-key effect below can depend on it without that
    // dependency changing on every render — its identity only changes when
    // one of its actual inputs (onDone, hasCommitted) does.
    const skip = useCallback(() => {
        // Write nothing new — but if a Save already fired earlier this session
        // (Back from the closing screen, then Skip), data WAS written, so report
        // that via `hasCommitted` rather than unconditionally false.
        markOnboardingDone();
        onDone(hasCommitted);
    }, [onDone, hasCommitted]);

    // Skip/cancel, guarded. Discarding an untouched wizard costs nothing, so that
    // stays instant; once the user has actually entered something, throwing away
    // a Full setup (up to twelve steps) to one stray keypress is too cheap, so we
    // confirm first. Already-committed drafts need no guard — the data is saved.
    const requestSkip = useCallback(() => {
        if (!dirty || hasCommitted) {
            skip();
            return;
        }
        setConfirmDiscard(true);
    }, [dirty, hasCommitted, skip]);

    // Escape mirrors the header's skip/cancel button. The closing screen hides
    // that button (Save already committed, or there's nothing left to skip), so
    // Escape does nothing there rather than guessing which action was meant.
    // Note: this always fires, even mid-edit in a text field — a FinancialInput
    // commits on blur/Enter, so an in-flight keystroke can be lost. The draft is
    // never the persisted plan until Save runs, and the confirmation above now
    // catches the case where that draft holds real work.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (screen === 'closing') return;
            // While the confirmation is up it owns Escape — otherwise dismissing
            // it would immediately re-open it.
            if (confirmDiscard) return;
            requestSkip();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [screen, confirmDiscard, requestSkip]);

    // --- navigation ----------------------------------------------------------

    const startSimple = () => {
        // Re-derive the quick answers from the (possibly Full-setup-modified) draft
        // so entries carry across path switches.
        setAnswers(seedToSimpleAnswers(draft));
        setPath('simple');
        setScreen('simple');
        setStepIndex(0);
    };
    const startDetailed = () => { setPath('detailed'); setScreen('detailed'); setStepIndex(0); };

    const lastContentIndex = () =>
        path === 'simple' ? SIMPLE_STEP_COUNT - 1 : detailedSteps.length - 1;

    // --- validation ----------------------------------------------------------
    // One error set per step, used for BOTH the banner and the Next/Save gate, so
    // the wizard can never block on something it didn't show — or warn about
    // something that doesn't block. Previously the banners lived inside individual
    // field groups while the gate didn't exist at all, so several steps (including
    // every step that owns the Save button) committed in silence.

    const quickErrors = (): string[] => {
        const { person, spouse } = simpleAnswersErrors(answers);
        return [...person, ...spouse];
    };

    /** Every field the quick validator checks lives on quick step 0. */
    const errorsAtStep = (index: number): string[] =>
        path === 'simple'
            ? (index === 0 ? quickErrors() : [])
            : (detailedSteps[index]?.errors(draft) ?? []);

    /**
     * First step still holding an inconsistency, or -1 when the whole draft is
     * clean. Save consults this rather than just the current step, so values that
     * arrived with the seed — a relaunch on an already-invalid saved plan — can't
     * slip through steps the user never visited.
     */
    const firstInvalidStep = (): number => {
        if (path === 'simple') return quickErrors().length > 0 ? 0 : -1;
        return detailedSteps.findIndex((s) => s.errors(draft).length > 0);
    };

    const currentStepErrors = errorsAtStep(safeStepIndex);
    const isLastContentStep = safeStepIndex >= lastContentIndex();
    const pendingInvalidStep = firstInvalidStep();

    // The commit step shows whatever will block Save, even when it belongs to an
    // earlier step; every other step shows only its own.
    const bannerErrors =
        currentStepErrors.length > 0
            ? currentStepErrors
            : isLastContentStep && pendingInvalidStep >= 0
              ? errorsAtStep(pendingInvalidStep)
              : [];

    const goNext = () => {
        // Never carry a broken value forward — it gets fixed here, with the
        // offending field on screen, instead of stranding the user on a later
        // step with no way to reach it.
        if (currentStepErrors.length > 0) {
            setBlocked(true);
            return;
        }
        if (!isLastContentStep) {
            setBlocked(false);
            setStepIndex(safeStepIndex + 1);
            return;
        }
        // Last content step's button is "Save". Re-check the whole draft first and
        // jump to the offending step, so a seeded inconsistency can't be committed
        // and the user lands where they can actually fix it.
        if (pendingInvalidStep >= 0) {
            setBlocked(true);
            setStepIndex(pendingInvalidStep);
            return;
        }
        // Commit now (both paths), so the closing screen that follows is purely a
        // confirmation. Re-entering this step (Back, then Save again) simply
        // re-commits; that's fine.
        setBlocked(false);
        commitOnboardingInputs(finalInputs());
        setHasCommitted(true);
        setScreen('closing');
    };

    const goBack = () => {
        setBlocked(false);
        if (screen === 'closing') {
            setScreen(path === 'simple' ? 'simple' : 'detailed');
            setStepIndex(lastContentIndex());
            return;
        }
        if (safeStepIndex > 0) {
            setStepIndex(safeStepIndex - 1);
            return;
        }
        // At the first step — back to the intro / path picker. Leaving the quick
        // path folds its entries back into the draft so Full setup sees them.
        if (screen === 'simple') {
            setDraft((d) => mergeSimpleAnswers(d, answers));
        }
        setScreen('intro');
        setStepIndex(0);
    };

    // --- progress ------------------------------------------------------------

    const totalSteps = (path === 'simple' ? SIMPLE_STEP_COUNT : detailedSteps.length) + 1; // + closing
    const currentStep = screen === 'closing' ? totalSteps - 1 : safeStepIndex;
    const showProgress = screen !== 'intro';

    // --- content -------------------------------------------------------------

    let content: ReactNode = null;
    if (screen === 'intro') {
        content = (
            <OnboardingIntro
                isRelaunch={isRelaunch}
                onSimple={startSimple}
                onDetailed={startDetailed}
                onSkip={requestSkip}
            />
        );
    } else if (screen === 'simple') {
        content = (
            <SimplePathStep
                step={safeStepIndex === 0 ? 0 : 1}
                answers={answers}
                onChange={editAnswers}
            />
        );
    } else if (screen === 'detailed') {
        const stepDef = detailedSteps[safeStepIndex];
        content = stepDef ? (
            <SectionForStep title={stepDef.title} blurb={stepDef.blurb}>
                {stepDef.render(draft, editDraft)}
            </SectionForStep>
        ) : null;
    } else {
        content = <OnboardingClosing onFinish={finish} onPrivacy={openPrivacy} />;
    }

    const showFooter = screen === 'simple' || screen === 'detailed';

    // The intro is a scrim: a semi-transparent dim over the live sample dashboard
    // (App keeps the app tree mounted behind this overlay) so the user sees the
    // tool before committing to setup. Every other screen is a full, opaque
    // takeover — partial drafts must not render misleading projections behind it.
    // z-[200] sits above the sticky header (z-50) and tooltips (z-[100]). Clicking
    // the scrim does nothing (no dismiss handler) — the user must choose or Skip.
    const isIntro = screen === 'intro';
    const rootBg = isIntro
        ? 'bg-slate-900/40'
        : 'bg-gradient-to-br from-slate-50 to-slate-100';

    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-modal="true"
            aria-label="Guided Setup"
            tabIndex={-1}
            className={`fixed inset-0 z-[200] overflow-y-auto overscroll-contain outline-none ${rootBg} font-sans text-slate-900 flex flex-col`}
        >
            <header className="w-full border-b border-white/50 bg-white/60 backdrop-blur-xl">
                <div className="container mx-auto flex h-16 items-center justify-between px-4">
                    <BrandLockup>
                        <span className="text-lg font-bold tracking-tight text-slate-900 hidden sm:inline">
                            Guided Setup
                        </span>
                    </BrandLockup>
                    {screen !== 'closing' && (
                        <button
                            onClick={requestSkip}
                            className="text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
                        >
                            {isRelaunch ? 'Cancel — keep my current numbers' : 'Skip setup'}
                        </button>
                    )}
                </div>
            </header>

            <main className="flex-1 w-full px-4 py-8 sm:py-12">
                <div
                    className={`mx-auto max-w-2xl w-full ${
                        isIntro
                            ? 'bg-white/95 rounded-3xl shadow-2xl ring-1 ring-black/5 p-6 sm:p-8'
                            : ''
                    }`}
                >
                    {showProgress && (
                        <div className="flex items-center justify-center gap-1.5 mb-6" aria-hidden="true">
                            {Array.from({ length: totalSteps }).map((_, i) => (
                                <span
                                    key={i}
                                    className={`h-1.5 rounded-full transition-all ${
                                        i === currentStep
                                            ? 'w-6 bg-brand-500'
                                            : i < currentStep
                                              ? 'w-1.5 bg-brand-400'
                                              : 'w-1.5 bg-slate-200'
                                    }`}
                                />
                            ))}
                        </div>
                    )}

                    {/* One banner per step, driven by the same errors that gate
                        Next/Save. Sits above the step body so it's the first thing
                        read, and is present on EVERY step — including the one that
                        commits. */}
                    {showFooter && bannerErrors.length > 0 && (
                        <div className="mb-4">
                            <ValidationBanner errors={bannerErrors} />
                        </div>
                    )}

                    {content}

                    {showFooter && (
                        <div className="mt-6 space-y-2">
                            {blocked && bannerErrors.length > 0 && (
                                <p className="text-xs font-medium text-amber-700 text-right">
                                    Fix the {bannerErrors.length === 1 ? 'item' : 'items'} above to continue.
                                </p>
                            )}
                            <div className="flex items-center justify-between gap-3">
                                <button
                                    onClick={goBack}
                                    className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-200/60 transition-colors"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={goNext}
                                    className="px-6 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors"
                                >
                                    {isLastContentStep ? 'Save' : 'Next'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Nested inside the z-[200] overlay, so the Dialog's own z-[150]
                resolves within this stacking context and lands on top of the
                wizard rather than behind it. */}
            <Dialog
                open={confirmDiscard}
                onClose={() => setConfirmDiscard(false)}
                title="Discard your setup?"
                maxWidth="max-w-sm"
                footer={
                    <>
                        <button type="button" data-autofocus onClick={() => setConfirmDiscard(false)} className={dialogSecondaryBtn}>
                            Keep editing
                        </button>
                        <button
                            type="button"
                            onClick={() => { setConfirmDiscard(false); skip(); }}
                            className={dialogDestructiveBtn}
                        >
                            Discard
                        </button>
                    </>
                }
            >
                <p>
                    What you've entered here hasn't been saved.{' '}
                    {isRelaunch
                        ? 'Your plan will keep its current numbers.'
                        : 'The dashboard will open with sample numbers instead.'}{' '}
                    You can run Guided Setup again at any time.
                </p>
            </Dialog>
        </div>
    );
}

function SectionForStep({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
    return (
        <SectionCard className="space-y-5">
            <div>
                <h2 className="text-xl font-bold text-slate-900">{title}</h2>
                <p className="text-sm text-slate-500 mt-1">{blurb}</p>
            </div>
            {children}
        </SectionCard>
    );
}
