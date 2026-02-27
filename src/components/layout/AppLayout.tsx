import React from 'react';

interface AppLayoutProps {
    children: React.ReactNode;
    currentPage: 'dashboard' | 'how-it-works';
    onNavigate: (page: 'dashboard' | 'how-it-works') => void;
}

function CrapLogo() {
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

export function AppLayout({ children, currentPage, onNavigate }: AppLayoutProps) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 font-sans text-slate-900">
            <header className="lg:sticky lg:top-0 z-50 w-full border-b border-white/50 bg-white/60 backdrop-blur-xl">
                <div className="container mx-auto flex h-16 items-center justify-between px-4">
                    <div className="flex items-center gap-2.5">
                        <CrapLogo />
                        <h1 className="text-xl font-bold tracking-tight text-slate-900">
                            Canadian Retirement Asset Planning <span className="text-brand-500">tool</span>
                        </h1>
                    </div>

                    <div className="hidden md:flex items-center gap-2 text-[10px] font-medium text-slate-400 bg-slate-50 px-2 py-1 rounded-full border border-slate-100">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                        Local Browser Execution Only • No Data Sent to Server
                    </div>

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
                            onClick={() => onNavigate('how-it-works')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${currentPage === 'how-it-works'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-900'
                                }`}
                        >
                            How does this work?
                        </button>
                    </nav>
                </div>
            </header>
            <main className="container mx-auto px-4 py-8">
                {children}
            </main>
        </div>
    );
}
