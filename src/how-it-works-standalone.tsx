import React from 'react';
import ReactDOM from 'react-dom/client';
import { HowItWorks } from './components/pages/HowItWorks';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AppLayout } from './components/layout/AppLayout';
import './index.css';

/**
 * Standalone entry for /how-it-works/ — a crawlable page with its own URL and
 * meta tags. Mounts the same HowItWorks component as the dashboard links to.
 * Uses the shared AppLayout so header, nav, and footer stay identical to the
 * dashboard — it just omits onLaunchOnboarding (no onboarding overlay here).
 */
function StandaloneHowItWorksPage() {
    return (
        <AppLayout activePage="how-it-works">
            <HowItWorks />
        </AppLayout>
    );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <StandaloneHowItWorksPage />
        </ErrorBoundary>
    </React.StrictMode>,
);
