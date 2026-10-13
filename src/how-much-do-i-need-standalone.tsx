import React from 'react';
import ReactDOM from 'react-dom/client';
import { StandaloneHowMuchDoINeedPage } from './how-much-do-i-need-page';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './index.css';

/**
 * Client entry for /how-much-do-i-need-to-retire/ — a crawlable SEO landing page
 * with its own URL and meta tags. Mounts the shared StandaloneHowMuchDoINeedPage
 * component (also used by the build-time prerender). createRoot().render()
 * replaces the prerendered static markup in #root on mount — we intentionally
 * do NOT hydrate, mirroring how-it-works and rrsp-withdrawal-strategy, to keep
 * server/client markup from having to match exactly.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <StandaloneHowMuchDoINeedPage />
        </ErrorBoundary>
    </React.StrictMode>,
);
