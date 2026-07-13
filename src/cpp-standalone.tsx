import React from 'react';
import ReactDOM from 'react-dom/client';
import { CppCalculator } from './components/pages/CppCalculator';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { CrapLogo } from './components/layout/AppLayout';
import './index.css';

/**
 * Standalone entry for /cpp-calculator/ — a crawlable page with its own URL and
 * meta tags. Mounts the same CppCalculator component as the SPA's hash route;
 * "Apply to plan" works across pages via localStorage (same origin).
 */
function StandaloneCppPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 font-sans text-slate-900">
            <header className="w-full border-b border-white/50 bg-white/60 backdrop-blur-xl">
                <div className="container mx-auto flex h-16 items-center justify-between px-4">
                    <a href="/" className="flex items-center gap-2.5">
                        <CrapLogo />
                        <span className="text-xl font-bold tracking-tight text-slate-900">
                            Canadian Retirement Asset Planning <span className="text-brand-500">tool</span>
                        </span>
                    </a>
                    <a
                        href="/"
                        className="px-4 py-1.5 text-sm font-medium rounded-lg bg-slate-100/50 text-slate-500 hover:text-slate-900 transition-all"
                    >
                        Open the full retirement planner →
                    </a>
                </div>
            </header>
            <main className="container mx-auto px-4 py-8">
                <CppCalculator />
            </main>
            <footer className="border-t border-slate-200/70 mt-4">
                <div className="container mx-auto px-4 py-6 text-center space-y-1.5">
                    <p className="text-sm text-slate-400">
                        For planning and educational purposes only — not financial, tax, or investment advice.
                        Part of the free{' '}
                        <a href="/" className="underline decoration-dotted underline-offset-2 hover:text-slate-600 transition-colors">
                            Canadian Retirement Asset Planning tool
                        </a>.
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
                </div>
            </footer>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <StandaloneCppPage />
        </ErrorBoundary>
    </React.StrictMode>,
);
