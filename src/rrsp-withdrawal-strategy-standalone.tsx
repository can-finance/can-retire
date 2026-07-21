import React from 'react';
import ReactDOM from 'react-dom/client';
import { StandaloneRrspWithdrawalStrategyPage } from './rrsp-withdrawal-strategy-page';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './index.css';

/**
 * Client entry for /rrsp-withdrawal-strategy/ — a crawlable SEO landing page with
 * its own URL and meta tags. Mounts the shared StandaloneRrspWithdrawalStrategyPage
 * component (also used by the build-time prerender). createRoot().render() replaces
 * the prerendered static markup in #root on mount — we intentionally do NOT hydrate,
 * mirroring how-it-works, to keep server/client markup from having to match exactly.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <StandaloneRrspWithdrawalStrategyPage />
        </ErrorBoundary>
    </React.StrictMode>,
);
