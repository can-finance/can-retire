import React from 'react';
import { HelpTooltip } from '../ui/HelpTooltip';

export type PageId = 'dashboard' | 'cpp-calculator' | 'how-it-works';

// Single source for the "re-run setup" button's label, shared with the copy
// in OnboardingIntro/OnboardingClosing so the two never drift out of sync.
export const EDIT_PLAN_LABEL = 'Edit My Plan';

interface AppLayoutProps {
    children: React.ReactNode;
    currentPage: PageId;
    onNavigate: (page: PageId) => void;
    /** Re-launch the guided setup overlay. */
    onLaunchOnboarding: () => void;
}

export function CrapLogo() {
    return (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            {/* Background rounded square */}
            <rect width="32" height="32" rx="8" fill="#0f172a" />
            {/* Stylised upward growth line / mountain silhouette */}
            <polyline
                points="4,24 10,16 16,19 22,10 28,12"
                stroke="#38bdf8"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
            {/* Filled area under the line for depth */}
            <polygon
                points="4,24 10,16 16,19 22,10 28,12 28,26 4,26"
                fill="#38bdf8"
                fillOpacity="0.15"
            />
            {/* Rising arrow tip */}
            <polyline
                points="24,8 28,12 24,13"
                stroke="#38bdf8"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
        </svg>
    );
}

export function AppLayout({ children, currentPage, onNavigate, onLaunchOnboarding }: AppLayoutProps) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 font-sans text-slate-900">
            <header className="lg:sticky lg:top-0 z-50 w-full border-b border-white/50 bg-white/60 backdrop-blur-xl">
                <div className="container mx-auto flex min-h-16 items-center justify-between px-4 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <CrapLogo />
                        <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-slate-900">
                            Canadian Retirement Asset Planning <span className="text-brand-500">tool</span>
                        </h1>
                    </div>

                    <div className="hidden xl:flex items-center gap-2 whitespace-nowrap text-[10px] font-medium text-slate-400 bg-slate-50 px-2 py-1 rounded-full border border-slate-100">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                        Runs Entirely in Your Browser • Your Data Never Leaves Your Device
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <nav className="flex items-center gap-1 bg-slate-100/50 p-1 rounded-xl">
                            <button
                                onClick={() => onNavigate('dashboard')}
                                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${currentPage === 'dashboard'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-900'
                                    }`}
                            >
                                Dashboard
                            </button>
                            <button
                                onClick={() => onNavigate('cpp-calculator')}
                                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${currentPage === 'cpp-calculator'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-900'
                                    }`}
                            >
                                CPP Calculator
                            </button>
                            <button
                                onClick={() => onNavigate('how-it-works')}
                                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${currentPage === 'how-it-works'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-900'
                                    }`}
                            >
                                How does this work?
                            </button>
                        </nav>
                        {/* Setup is an action (opens the guided-setup overlay), not a page —
                            styled distinctly from the segmented nav pill and never "active". */}
                        <HelpTooltip text="Re-run the guided setup. Your current numbers are pre-filled — nothing changes until you save the plan.">
                            <button
                                onClick={onLaunchOnboarding}
                                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 hover:border-brand-300 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                {EDIT_PLAN_LABEL}
                            </button>
                        </HelpTooltip>
                    </div>
                </div>
            </header>
            <main className="container mx-auto px-4 py-8">
                {children}
            </main>
            <footer className="border-t border-slate-200/70 mt-4">
                <div className="container mx-auto px-4 py-6 text-center space-y-1.5">
                    <p className="text-sm text-slate-400">
                        For planning and educational purposes only — not financial, tax, or investment advice.
                        Projections are estimates based on simplified assumptions.{' '}
                        <button
                            onClick={() => {
                                onNavigate('how-it-works');
                                // Scroll after the page has rendered
                                setTimeout(() => {
                                    document.getElementById('full-disclaimer')?.scrollIntoView({ behavior: 'smooth' });
                                }, 100);
                            }}
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-600 transition-colors"
                        >
                            Full disclaimer
                        </button>
                    </p>
                    <p className="text-sm text-slate-400">
                        Calculations use 2025 federal and provincial tax rules.
                    </p>
                    <p className="text-sm text-slate-400">
                        Questions or feedback?{' '}
                        <a
                            href="mailto:info@craptool.ca"
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-600 transition-colors"
                        >
                            info@craptool.ca
                        </a>
                    </p>
                    <p className="text-sm text-slate-400">
                        &copy; {new Date().getFullYear()} Canadian Retirement Asset Planning tool · Version {__APP_VERSION__} ·{' '}
                        <a
                            href="https://github.com/can-finance/can-retire"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-600 transition-colors"
                        >
                            Source on GitHub
                        </a>
                        {' '}·{' '}
                        <a
                            href="https://github.com/can-finance/can-retire/blob/main/CHANGELOG.md"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-600 transition-colors"
                        >
                            Changelog
                        </a>
                        {' '}·{' '}
                        <a
                            href="/cpp-calculator/"
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-600 transition-colors"
                        >
                            CPP Calculator
                        </a>
                    </p>
                </div>
            </footer>
        </div>
    );
}
