import { useState, type ReactNode } from 'react';
import type { Person, SimulationInputs } from '../../engine/types';
import { CrapLogo } from '../layout/AppLayout';
import { commitOnboardingInputs, hasSavedPlan, markOnboardingDone } from '../../utils/onboarding';
import { createDefaultPerson } from '../../utils/inputSanitizer';
import { OnboardingIntro } from './OnboardingIntro';
import { OnboardingClosing } from './OnboardingClosing';
import { SimplePathStep } from './SimplePathStep';
import { seedToSimpleAnswers, mergeSimpleAnswers, type SimpleAnswers } from './simplePathMapping';
import { buildDetailedSteps } from './detailedSteps';

interface OnboardingFlowProps {
    seed: SimulationInputs;
    onDone: () => void;
    /** Open How It Works scrolled to #privacy. When absent, falls back to onDone. */
    onOpenPrivacy?: () => void;
}

type Screen = 'intro' | 'simple' | 'detailed' | 'closing';

const SIMPLE_STEP_COUNT = 2; // S1 + S2

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

    // Stash the spouse across a toggle-off in the detailed path so toggling back
    // on restores the previously present (seeded or edited) spouse rather than a
    // fresh default. Mirrors the quick path's non-destructive spouse merge.
    const [spouseStash, setSpouseStash] = useState<Person | undefined>(seed.spouse);
    const toggleSpouse = (on: boolean) => {
        if (on) {
            setDraft((cur) => ({ ...cur, spouse: spouseStash ?? createDefaultPerson(true) }));
        } else {
            if (draft.spouse) setSpouseStash(draft.spouse);
            setDraft((cur) => ({ ...cur, spouse: undefined }));
        }
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

    const finish = () => {
        commitOnboardingInputs(finalInputs());
        onDone();
    };

    const openPrivacy = () => {
        // The user completed setup — persist their work, then hand off to the
        // privacy page (App turns onboarding off + navigates + scrolls).
        commitOnboardingInputs(finalInputs());
        if (onOpenPrivacy) onOpenPrivacy();
        else onDone();
    };

    const skip = () => {
        // Write nothing — just mark done and close.
        markOnboardingDone();
        onDone();
    };

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

    const goNext = () => {
        const last = lastContentIndex();
        if (safeStepIndex < last) setStepIndex(safeStepIndex + 1);
        else setScreen('closing');
    };

    const goBack = () => {
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
                onSkip={skip}
            />
        );
    } else if (screen === 'simple') {
        content = (
            <SimplePathStep
                step={safeStepIndex === 0 ? 0 : 1}
                answers={answers}
                onChange={(partial) => setAnswers((a) => ({ ...a, ...partial }))}
            />
        );
    } else if (screen === 'detailed') {
        const stepDef = detailedSteps[safeStepIndex];
        content = stepDef ? (
            <SectionForStep title={stepDef.title} blurb={stepDef.blurb}>
                {stepDef.render(draft, setDraft)}
            </SectionForStep>
        ) : null;
    } else {
        content = <OnboardingClosing onFinish={finish} onPrivacy={openPrivacy} />;
    }

    const showFooter = screen === 'simple' || screen === 'detailed';

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 font-sans text-slate-900 flex flex-col">
            <header className="w-full border-b border-white/50 bg-white/60 backdrop-blur-xl">
                <div className="container mx-auto flex h-16 items-center justify-between px-4">
                    <div className="flex items-center gap-2.5">
                        <CrapLogo />
                        <span className="text-lg font-bold tracking-tight text-slate-900 hidden sm:inline">
                            Retirement setup
                        </span>
                    </div>
                    {screen !== 'closing' && (
                        <button
                            onClick={skip}
                            className="text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            {isRelaunch ? 'Cancel — keep my current numbers' : 'Skip setup'}
                        </button>
                    )}
                </div>
            </header>

            <main className="flex-1 w-full px-4 py-8 sm:py-12">
                <div className="mx-auto max-w-2xl w-full">
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

                    {content}

                    {showFooter && (
                        <div className="flex items-center justify-between gap-3 mt-6">
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
                                {safeStepIndex >= lastContentIndex() ? 'Review' : 'Next'}
                            </button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

function SectionForStep({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
    return (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 border-l-4 border-l-brand-400 p-6 space-y-5">
            <div>
                <h2 className="text-xl font-bold text-slate-900">{title}</h2>
                <p className="text-sm text-slate-500 mt-1">{blurb}</p>
            </div>
            {children}
        </section>
    );
}
