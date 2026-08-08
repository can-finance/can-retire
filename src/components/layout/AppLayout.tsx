import React, { useState } from 'react';
import { HelpTooltip } from '../ui/HelpTooltip';
import { Dialog, dialogSecondaryBtn, dialogDestructiveBtn } from '../ui/Dialog';
import { clearAllAppData } from '../../utils/clearAllData';

export type PageId = 'dashboard' | 'cpp-calculator' | 'how-it-works' | 'rrsp-withdrawal-strategy';

// Single source for the nav pill order/labels/targets. The three pages are now
// real MPA routes, so each item is a plain <a href> to the page's path — the
// active-page highlight is derived from AppLayout's `activePage` prop rather
// than in-SPA routing state.
const NAV_ITEMS: { id: PageId; label: string; href: string }[] = [
    { id: 'dashboard', label: 'Dashboard', href: '/' },
    { id: 'cpp-calculator', label: 'CPP Calculator', href: '/cpp-calculator/' },
    { id: 'rrsp-withdrawal-strategy', label: 'RRSP Withdrawal Strategy', href: '/rrsp-withdrawal-strategy/' },
    { id: 'how-it-works', label: 'How does this work?', href: '/how-it-works/' },
];

// Single source for the "re-run setup" button's label, shared with the copy
// in OnboardingIntro/OnboardingClosing so the two never drift out of sync.
export const EDIT_PLAN_LABEL = 'Guided Setup';

interface AppLayoutProps {
    children: React.ReactNode;
    /** Which nav item to highlight as the current page. */
    activePage: PageId;
    /**
     * Re-launch the guided setup overlay in place. Only the dashboard SPA
     * passes this — the standalone MPA pages omit it, so the "Guided Setup"
     * control renders as a plain link to `/?setup=1` instead, which navigates
     * to the dashboard and opens the overlay there (see the `setupRequested`
     * capture in App.tsx). Either way the control itself is always rendered,
     * in the same position, so the header doesn't shift between pages.
     */
    onLaunchOnboarding?: () => void;
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

// Shared logo+title lockup: CrapLogo plus whatever title content the caller
// supplies. AppLayout's header and OnboardingFlow's overlay header show
// different text at different sizes, so only the logo + flex wrapper are
// truly common — title markup is passed in as children.
export function BrandLockup({
    children,
    className = 'flex items-center gap-2.5',
    href,
}: {
    children: React.ReactNode;
    className?: string;
    href?: string;
}) {
    const content = (
        <>
            <CrapLogo />
            {children}
        </>
    );

    if (href) {
        return (
            <a href={href} className={`${className} hover:opacity-80 transition-opacity`}>
                {content}
            </a>
        );
    }

    return (
        <div className={className}>
            {content}
        </div>
    );
}

export function AppLayout({ children, activePage, onLaunchOnboarding }: AppLayoutProps) {
    // AppLayout is shared by the dashboard SPA and the standalone MPA pages
    // (/cpp-calculator/, /how-it-works/, /rrsp-withdrawal-strategy/), so this
    // control — and the wipe it triggers — must work from any of them.
    const [confirmClear, setConfirmClear] = useState(false);

    const handleConfirmClear = () => {
        clearAllAppData();
        setConfirmClear(false);
        // A full document load — not a client-side state reset — is what
        // guarantees every hook, cache, and React tree is rebuilt from scratch,
        // and that App.tsx re-evaluates isOnboardingEligible() at mount, which
        // with all keys absent yields the true new-visitor experience.
        // Navigating to '/' explicitly (rather than location.reload()) also
        // drops any #start= share hash or ?setup= query that would otherwise
        // re-import a scenario or re-open onboarding, and correctly returns the
        // user to the dashboard when triggered from one of the MPA pages.
        window.location.assign('/');
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 font-sans text-slate-900">
            <header className="lg:sticky lg:top-0 z-50 w-full border-b border-white/50 bg-white/60 backdrop-blur-xl">
                <div className="container mx-auto flex min-h-16 items-center justify-between px-4 py-2">
                    <BrandLockup className="flex min-w-0 items-center gap-2.5" href="/">
                        <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-slate-900">
                            Canadian Retirement Asset Planning <span className="text-brand-500">tool</span>
                        </h1>
                    </BrandLockup>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <nav className="flex items-center gap-5">
                            {NAV_ITEMS.map(({ id, label, href }) => (
                                <a
                                    key={id}
                                    href={href}
                                    aria-current={activePage === id ? 'page' : undefined}
                                    className={`whitespace-nowrap text-sm font-medium transition-colors ${activePage === id
                                        ? 'text-slate-900 font-semibold underline decoration-brand-500 decoration-2 underline-offset-[6px]'
                                        : 'text-slate-500 hover:text-slate-900'
                                        }`}
                                >
                                    {label}
                                </a>
                            ))}
                        </nav>
                        {/* Setup is an action (opens the guided-setup overlay), not a page —
                            styled distinctly from the text nav links and never "active".
                            Always rendered, in the same spot, so the header doesn't shift
                            between pages. The dashboard SPA passes onLaunchOnboarding and
                            opens the overlay in place; the standalone MPA pages have no
                            overlay of their own, so they link to /?setup=1, which navigates
                            to the dashboard and opens the overlay there. */}
                        <HelpTooltip text="Re-run the guided setup. Your current numbers are pre-filled — nothing changes until you save the plan.">
                            {onLaunchOnboarding ? (
                                <button
                                    onClick={onLaunchOnboarding}
                                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 hover:border-brand-300 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    {EDIT_PLAN_LABEL}
                                </button>
                            ) : (
                                <a
                                    href="/?setup=1"
                                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 hover:border-brand-300 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    {EDIT_PLAN_LABEL}
                                </a>
                            )}
                        </HelpTooltip>
                    </div>
                </div>
            </header>
            <main className="container mx-auto px-4 py-8">
                {children}
            </main>
            <footer className="border-t border-slate-200/70 mt-4">
                <div className="container mx-auto px-4 py-6 text-center space-y-1.5">
                    {/* Privacy badge — lived in the header until the nav outgrew the
                        space (and `hidden xl:` meant most visitors never saw it).
                        Here it shows at every viewport width, on every page. The
                        "Clear all data" control sits immediately to its right —
                        wrap-friendly on narrow screens — as a quiet utility link,
                        not a primary action competing with the pill. */}
                    <div className="flex items-center justify-center gap-2 flex-wrap mb-2">
                        <div className="inline-flex items-center gap-2 text-2xs font-medium text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                            Runs entirely in your browser • Your data never leaves your device
                        </div>
                        <button
                            type="button"
                            onClick={() => setConfirmClear(true)}
                            className="text-2xs text-slate-500 underline decoration-dotted underline-offset-2 hover:text-rose-500 transition-colors"
                        >
                            Clear all data
                        </button>
                    </div>
                    <p className="text-xs text-slate-500">
                        For planning and educational purposes only — not financial, tax, or investment advice.
                        Projections are estimates based on simplified assumptions.{' '}
                        <a
                            href="/how-it-works/#full-disclaimer"
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-600 transition-colors"
                        >
                            Full disclaimer
                        </a>
                    </p>
                    <p className="text-xs text-slate-500">
                        Calculations use 2026 federal and provincial tax rules.
                    </p>
                    <p className="text-xs text-slate-500">
                        Questions or feedback?{' '}
                        <a
                            href="mailto:info@craptool.ca"
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-600 transition-colors"
                        >
                            info@craptool.ca
                        </a>
                    </p>
                    <p className="text-xs text-slate-500">
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
                        {' '}·{' '}
                        <a
                            href="/rrsp-withdrawal-strategy/"
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-600 transition-colors"
                        >
                            RRSP Withdrawal Strategy
                        </a>
                    </p>
                </div>
            </footer>

            <Dialog
                open={confirmClear}
                onClose={() => setConfirmClear(false)}
                title="Clear all data?"
                maxWidth="max-w-sm"
                footer={
                    <>
                        <button type="button" data-autofocus onClick={() => setConfirmClear(false)} className={dialogSecondaryBtn}>
                            Cancel
                        </button>
                        <button type="button" onClick={handleConfirmClear} className={dialogDestructiveBtn}>
                            Clear everything
                        </button>
                    </>
                }
            >
                <p>
                    This permanently deletes every saved plan and all entered figures from this browser, and
                    returns the app to the guided setup. This can't be undone.
                </p>
            </Dialog>
        </div>
    );
}
