import { SectionCard } from '../ui/SectionCard';
import { EDIT_PLAN_LABEL } from '../layout/AppLayout';

interface OnboardingIntroProps {
    isRelaunch: boolean;
    onSimple: () => void;
    onDetailed: () => void;
    onSkip: () => void;
}

export function OnboardingIntro({ isRelaunch, onSimple, onDetailed, onSkip }: OnboardingIntroProps) {
    return (
        <div className="space-y-6">
            <div className="text-center space-y-3">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                    Plan your Canadian retirement in a few minutes.
                </h1>
                <p className="text-slate-600 max-w-xl mx-auto">
                    This tool projects your accounts, taxes, CPP and OAS year by year so you can compare
                    retirement strategies. Everything runs in your browser — your numbers never leave your device.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                    onClick={onSimple}
                    className="text-left rounded-2xl border-2 border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition-all p-5 group"
                >
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-slate-900">Quick start</h2>
                        <span className="text-xs font-medium text-slate-400">~2 min</span>
                    </div>
                    <p className="text-sm text-slate-500 mt-2">
                        A handful of questions. We'll use sensible defaults for everything else — you
                        can edit any value later.
                    </p>
                    <span className="inline-block mt-4 text-sm font-medium text-brand-600 group-hover:text-brand-700">
                        Start →
                    </span>
                </button>

                <button
                    onClick={onDetailed}
                    className="text-left rounded-2xl border-2 border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition-all p-5 group"
                >
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-slate-900">Full setup</h2>
                        <span className="text-xs font-medium text-slate-400">~10 min</span>
                    </div>
                    <p className="text-sm text-slate-500 mt-2">
                        Step through every option. Sensible defaults are pre-filled — change what you like.
                    </p>
                    <span className="inline-block mt-4 text-sm font-medium text-brand-600 group-hover:text-brand-700">
                        Start →
                    </span>
                </button>
            </div>

            <SectionCard accent="none" padding="p-4" className="bg-slate-50/70">
                <p className="text-xs text-slate-400 text-center">
                    Rough estimates for planning — not financial advice.
                </p>
            </SectionCard>

            <div className="text-center">
                <button
                    onClick={onSkip}
                    className="text-sm text-slate-700 hover:text-slate-900 underline decoration-dotted underline-offset-2 transition-colors"
                >
                    {isRelaunch ? 'Cancel — keep my current numbers' : 'Skip — explore with sample numbers instead'}
                </button>
                <p className="text-xs text-slate-400 mt-2">
                    You can run this setup again anytime from the {EDIT_PLAN_LABEL} button in the top menu.
                </p>
            </div>
        </div>
    );
}
