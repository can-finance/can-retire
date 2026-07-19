import React from 'react';
import { ONBOARDING_KEY, SIM_KEY } from '../../utils/onboarding';
import { PLANS_STORAGE_KEY, ACTIVE_PLAN_STORAGE_KEY } from '../../hooks/usePlans';

interface ErrorBoundaryState {
    hasError: boolean;
}

const STORAGE_KEYS = [SIM_KEY, PLANS_STORAGE_KEY, ACTIVE_PLAN_STORAGE_KEY, ONBOARDING_KEY];

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('Unhandled render error', error, info);
    }

    handleReset = () => {
        STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
        window.location.href = window.location.pathname;
    };

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
                <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-4">
                    <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
                    <p className="text-sm text-slate-600">
                        The app hit an unexpected error. This can happen if saved or shared data
                        is corrupted. Reloading usually fixes it; if not, reset the saved data.
                    </p>
                    <div className="flex justify-center gap-3">
                        <button
                            onClick={() => window.location.reload()}
                            className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
                        >
                            Reload
                        </button>
                        <button
                            onClick={this.handleReset}
                            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                        >
                            Reset saved data &amp; reload
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
