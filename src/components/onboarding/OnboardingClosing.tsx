import { SectionCard } from '../ui/SectionCard';

interface OnboardingClosingProps {
    /** Commit the draft and go to the dashboard. */
    onFinish: () => void;
    /** Commit, then open How It Works scrolled to the privacy section. */
    onPrivacy: () => void;
}

export function OnboardingClosing({ onFinish, onPrivacy }: OnboardingClosingProps) {
    return (
        <div className="space-y-6">
            <div className="text-center space-y-2">
                <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">You're set.</h1>
            </div>

            <SectionCard accent="emerald" className="space-y-4">
                <div className="space-y-1.5">
                    <h2 className="text-sm font-bold text-slate-900">Your plan is saved on this device</h2>
                    <p className="text-sm text-slate-600">
                        Your numbers are saved in this browser's local storage, on this device only — nothing is sent to
                        any server. They'll be here next time you visit. Clearing your browser data will remove them.
                    </p>
                </div>

                <div className="space-y-1.5 pt-3 border-t border-emerald-200/50">
                    <h2 className="text-sm font-bold text-slate-900">Sharing your plan</h2>
                    <p className="text-sm text-slate-600">
                        The <span className="font-semibold">Share</span> button (in the Scenarios panel) encodes your whole
                        scenario into a link. The numbers live inside the link itself, so anyone you send it to can see them.
                    </p>
                </div>

                <div className="pt-3 border-t border-emerald-200/50">
                    <button
                        onClick={onPrivacy}
                        className="text-sm font-medium text-brand-600 hover:text-brand-700 underline decoration-dotted underline-offset-2 transition-colors"
                    >
                        More on privacy and how the math works →
                    </button>
                </div>
            </SectionCard>

            <div className="space-y-3">
                <button
                    onClick={onFinish}
                    className="w-full bg-brand-600 text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors"
                >
                    Go to my dashboard
                </button>
                <p className="text-xs text-slate-400 text-center">
                    You can re-run this setup anytime from Scenarios → Guided setup.
                </p>
            </div>
        </div>
    );
}
