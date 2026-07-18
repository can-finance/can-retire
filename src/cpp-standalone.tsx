import React from 'react';
import ReactDOM from 'react-dom/client';
import { CppCalculator } from './components/pages/CppCalculator';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AppLayout } from './components/layout/AppLayout';
import './index.css';

/**
 * Standalone entry for /cpp-calculator/ — a crawlable page with its own URL and
 * meta tags. Mounts the same CppCalculator component as the dashboard links to;
 * "Apply to plan" works across pages via localStorage (same origin). Uses the
 * shared AppLayout so header, nav, and footer stay identical to the dashboard
 * — it just omits onLaunchOnboarding (no onboarding overlay lives here).
 */
function StandaloneCppPage() {
    return (
        <AppLayout activePage="cpp-calculator">
            <CppCalculator />
        </AppLayout>
    );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <StandaloneCppPage />
        </ErrorBoundary>
    </React.StrictMode>,
);
