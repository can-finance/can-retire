import React from 'react';

export function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 font-sans text-slate-900">
            <header className="sticky top-0 z-50 w-full border-b border-white/50 bg-white/60 backdrop-blur-xl">
                <div className="container mx-auto flex h-16 items-center px-4">
                    <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                            C
                        </div>
                        <h1 className="text-lg font-bold tracking-tight text-slate-900">
                            Canadian Retirement Asset Planning <span className="text-brand-500">tool</span>
                        </h1>
                    </div>
                </div>
            </header>
            <main className="container mx-auto px-4 py-8">
                {children}
            </main>
        </div>
    );
}
